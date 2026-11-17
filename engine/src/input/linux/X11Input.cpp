#include "input/linux/X11Input.h"

#include "input/ClickCounter.h"
#include "input/linux/Keys.h"
#include "input/linux/Scroll.h"
#include "input/linux/Xlib.h"

#include <algorithm>
#include <array>
#include <bit>
#include <cmath>
#include <cstdint>
#include <cstdlib>
#include <initializer_list>
#include <optional>
#include <span>
#include <string>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
{
    namespace
    {
        const Xlib& xlib()
        {
            static const Xlib functions;
            return functions;
        }

        std::string xkbKeysymText(std::uint32_t keysym)
        {
            std::array<char, 16> buffer {};
            // The length written, its terminating NUL included; 0 for none.
            const int written = xlib().xkb_keysym_to_utf8(keysym, buffer.data(), buffer.size());
            return written > 1 ? std::string(buffer.data(), static_cast<std::size_t>(written - 1)) : std::string();
        }

        // The X errors of one connection. Xlib's error handler is the
        // process's (and by default exits it), so errors on this connection
        // are taken by an extension hook on the display instead, which finds
        // this through the display's extension list: no process-wide state.
        struct ErrorLog
        {
            int count = 0;
            int lastCode = 0;
        };

        int keepPrivate(XExtData* /*data*/)
        {
            return 0; // the ErrorLog belongs to the input, not to Xlib
        }

        int logError(Display* display, xError* error, XExtCodes* codes, int* returned)
        {
            const Xlib& x = xlib();
            *returned = 0;
            if (x.XFindOnExtensionList == nullptr || x.XEHeadOfExtensionList == nullptr)
                return 1;
            XEDataObject object {};
            object.display = display;
            if (XExtData* data = x.XFindOnExtensionList(x.XEHeadOfExtensionList(object), codes->extension))
            {
                auto* log = reinterpret_cast<ErrorLog*>(data->private_data);
                ++log->count;
                log->lastCode = error->errorCode;
            }
            return 1; // handled: the process's handler never sees it
        }

        bool isSet(const unsigned char* mask, int length, int bit) noexcept
        {
            return bit / 8 < length && (mask[bit / 8] & (1U << (static_cast<unsigned>(bit) % 8))) != 0;
        }

        // MouseEvent.buttons of an XInput 2 button state: 1 primary (X's
        // button 1), 2 secondary (3), 4 middle (2).
        unsigned buttonsOf(const XIButtonState& state) noexcept
        {
            return (isSet(state.mask, state.mask_len, 1) ? 1U : 0U) | (isSet(state.mask, state.mask_len, 3) ? 2U : 0U)
                   | (isSet(state.mask, state.mask_len, 2) ? 4U : 0U);
        }

        // A core event's state for an XInput 2 event: the effective modifiers
        // and keyboard group (layout), where XKB keeps it (bits 13-14).
        unsigned coreState(const XIModifierState& mods, const XIGroupState& group) noexcept
        {
            return static_cast<unsigned>(mods.effective) | ((static_cast<unsigned>(group.effective) & 3U) << 13U);
        }

        class X11Input final : public PlatformInput
        {
        public:
            X11Input(const Xlib& api, Display* connection, Window window, const PlatformOptions& options)
                : x(api), display(connection), view(window), clicks(options.doubleClickTime)
            {
            }

            ~X11Input() override
            {
                if (waitingForInputMethod)
                    x.XUnregisterIMInstantiateCallback(display, nullptr, nullptr, nullptr, &X11Input::inputMethodReady,
                                                       reinterpret_cast<XPointer>(this));
                if (context != nullptr)
                    x.XDestroyIC(context);
                if (method != nullptr)
                    x.XCloseIM(method);
                if (pointerWindow != 0 && ! broken)
                    x.XDestroyWindow(display, pointerWindow);
                // Releases every selection, the input context and an implicit
                // grab with the connection, even if the view is already gone.
                x.XCloseDisplay(display);
            }

            X11Input(const X11Input&) = delete;
            X11Input& operator=(const X11Input&) = delete;

            bool start(std::string& failure)
            {
                logErrors();
                if (x.XSetIOErrorExitHandler != nullptr)
                    x.XSetIOErrorExitHandler(display, &X11Input::connectionLost, this);
                int event = 0;
                int error = 0;
                if (x.XQueryExtension(display, "XInputExtension", &opcode, &event, &error) == 0)
                    return fail(failure, "the X server has no XInput extension");
                int major = 2;
                int minor = 2;
                if (x.XIQueryVersion(display, &major, &minor) != Success || major < 2)
                    return fail(failure, "the X server has no XInput 2");
                Window parent = 0;
                Window* children = nullptr;
                unsigned count = 0;
                if (x.XQueryTree(display, view, &root, &parent, &children, &count) == 0)
                    return fail(failure, "the view's X11 window is gone");
                if (children != nullptr)
                    x.XFree(children);
                Window top = 0;
                int left = 0;
                int above = 0;
                unsigned border = 0;
                unsigned depth = 0;
                if (x.XGetGeometry(display, view, &top, &left, &above, &viewWidth, &viewHeight, &border, &depth) == 0)
                    return fail(failure, "the view's X11 window is gone");

                // The pointer over the editor: a window of this connection's,
                // input only, over the editor's area of the view (setGeometry()),
                // whose events X gives this connection, and no further. The
                // view's other parts (a framework's own controls, as a
                // Standalone's) keep their input.
                pointerWindow = x.XCreateWindow(display, view, 0, 0, 1, 1, 0, 0, InputOnly, nullptr, 0, nullptr);
                std::array<unsigned char, XIMaskLen(XI_LASTEVENT)> pointerEvents {};
                for (const int type : { XI_Motion, XI_ButtonPress, XI_ButtonRelease, XI_Enter, XI_Leave })
                    XISetMask(pointerEvents.data(), type);
                XIEventMask pointer { XIAllMasterDevices, static_cast<int>(pointerEvents.size()),
                                      pointerEvents.data() };
                x.XISelectEvents(display, pointerWindow, &pointer, 1);
                layOutPointerWindow();
                x.XMapRaised(display, pointerWindow);
                selectViewEvents();
                // Core keys too: only those sent to the view (an XEmbed
                // embedder forwards keys so) and an input method's arrive as
                // core events, the device's own coming as XInput 2. And the
                // view's own changes: resized, the pointer's window follows;
                // hidden or destroyed, it loses its press.
                x.XSelectInput(display, view, coreEvents);
                x.XSync(display, False);
                if (errors.count != 0)
                    return fail(failure, "could not select the view's XInput 2 events (X error "
                                             + std::to_string(errors.lastCode) + ")");

                int xkbOpcode = 0;
                int xkbEvent = 0;
                int xkbError = 0;
                int xkbMajor = XkbMajorVersion;
                int xkbMinor = XkbMinorVersion;
                xkb = x.XkbQueryExtension(display, &xkbOpcode, &xkbEvent, &xkbError, &xkbMajor, &xkbMinor) != 0;
                smoothScrolling = major > 2 || minor >= 1;
                if (smoothScrolling)
                    queryScrollDevices(XIAllDevices);
                openInputMethod();
                hasFocus = queryFocus();
                errors.count = 0;
                return ! broken;
            }

            [[nodiscard]] int fileDescriptor() const override { return broken ? -1 : x.XConnectionNumber(display); }

            void read(std::vector<Event>& events) override
            {
                out = &events;
                while (! broken && x.XPending(display) > 0)
                {
                    XEvent event {};
                    x.XNextEvent(display, &event);
                    // The input method talks over this connection: it takes
                    // its own events, and keys it composes from.
                    if (x.XFilterEvent(&event, None) != 0)
                        continue;
                    handle(event);
                }
                flushScroll();
                out = nullptr;
            }

            void cancel(std::vector<Event>& events) override
            {
                out = &events;
                flushScroll();
                cancelPointer();
                releaseKeys();
                out = nullptr;
            }

            void setGeometry(const ViewGeometry& next) override
            {
                geometry = next;
                if (! (geometry.scale > 0))
                    geometry.scale = 1;
                layOutPointerWindow();
            }

            void setSuspended(bool suspend, std::vector<Event>& events) override
            {
                if (suspend == suspended || broken)
                    return;
                suspended = suspend;
                out = &events;
                flushScroll();
                if (suspended)
                {
                    cancelPointer();
                    releaseKeys();
                    x.XUnmapWindow(display, pointerWindow);
                }
                else
                    x.XMapRaised(display, pointerWindow);
                out = nullptr;
                selectViewEvents();
                updateComposition();
                // Done before what the user does next: input after this is
                // the framework's (or again this view's).
                x.XSync(display, False);
            }

            void setTextInputFocused(bool focused) override
            {
                textFocused = focused;
                updateComposition();
            }

            [[nodiscard]] bool focused() const override { return hasFocus; }
            [[nodiscard]] unsigned buttons() const override { return held; }
            [[nodiscard]] std::optional<ui::Point> pointerOnScreen() const override { return onScreen; }

            void warpPointer(ui::Point to) override
            {
                if (broken)
                    return;
                x.XIWarpPointer(display, pointerDevice, None, root, 0, 0, 0, 0, to.x, to.y);
                x.XFlush(display);
                onScreen = to;
            }

        private:
            // The view's focus, and its keys unless suspended, from every
            // master device: keys go to the window with the focus, the view,
            // whatever the pointer is over (suspended, they are core events
            // again: the framework's). Device changes from all (scroll axes
            // come and go with them).
            void selectViewEvents()
            {
                std::array<unsigned char, XIMaskLen(XI_LASTEVENT)> viewEvents {};
                XISetMask(viewEvents.data(), XI_FocusIn);
                XISetMask(viewEvents.data(), XI_FocusOut);
                if (! suspended)
                {
                    XISetMask(viewEvents.data(), XI_KeyPress);
                    XISetMask(viewEvents.data(), XI_KeyRelease);
                }
                std::array<unsigned char, XIMaskLen(XI_LASTEVENT)> deviceEvents {};
                XISetMask(deviceEvents.data(), XI_HierarchyChanged);
                XISetMask(deviceEvents.data(), XI_DeviceChanged);
                std::array<XIEventMask, 2> masks { {
                    { XIAllMasterDevices, static_cast<int>(viewEvents.size()), viewEvents.data() },
                    { XIAllDevices, static_cast<int>(deviceEvents.size()), deviceEvents.data() },
                } };
                x.XISelectEvents(display, view, masks.data(), static_cast<int>(masks.size()));
            }

            static bool fail(std::string& failure, std::string why)
            {
                failure = std::move(why);
                return false;
            }

            void logErrors()
            {
                XExtCodes* codes = x.XAddExtension(display);
                if (codes == nullptr)
                    return;
                // Xlib frees the entry when the display closes (Xfree), and
                // its private data with keepPrivate(): nothing.
                auto* data = static_cast<XExtData*>(std::calloc(1, sizeof(XExtData)));
                if (data == nullptr)
                    return;
                data->number = codes->extension;
                data->free_private = &keepPrivate;
                data->private_data = reinterpret_cast<XPointer>(&errors);
                XEDataObject object {};
                object.display = display;
                x.XAddToExtensionList(x.XEHeadOfExtensionList(object), data);
                x.XESetError(display, codes->extension, &logError);
            }

            static void connectionLost(Display* /*display*/, void* self)
            {
                // libX11 would exit the process; the view stops reading.
                static_cast<X11Input*>(self)->broken = true;
            }

            void emit(Event event)
            {
                if (out != nullptr)
                    out->push_back(std::move(event));
            }

            // ── Events ─────────────────────────────────────────────────────

            void handle(XEvent& event)
            {
                if (event.type == GenericEvent && event.xcookie.extension == opcode)
                {
                    if (x.XGetEventData(display, &event.xcookie) == 0)
                        return;
                    generic(event.xcookie);
                    x.XFreeEventData(display, &event.xcookie);
                    return;
                }
                switch (event.type)
                {
                    case KeyPress:
                    case KeyRelease:
                        // Sent to the view, or an input method's: the
                        // device's own keys arrive as XInput 2 events (and,
                        // suspended, are the framework's).
                        if (event.xkey.window == view && ! suspended)
                            key(event.xkey, false);
                        break;
                    case UnmapNotify:
                        // Unviewable, the view's press ends without a release
                        // (X ends its grab, and tells it nothing).
                        if (event.xunmap.window == view)
                        {
                            flushScroll();
                            cancelPointer();
                        }
                        break;
                    case ConfigureNotify:
                        if (event.xconfigure.window == view)
                        {
                            viewWidth = static_cast<unsigned>(std::max(1, event.xconfigure.width));
                            viewHeight = static_cast<unsigned>(std::max(1, event.xconfigure.height));
                            layOutPointerWindow();
                        }
                        break;
                    case DestroyNotify:
                        if (event.xdestroywindow.window == view)
                        {
                            flushScroll();
                            cancelPointer();
                            releaseKeys();
                        }
                        break;
                    case MappingNotify:
                        // A keyboard layout changed (XKB's changes come so too).
                        x.XRefreshKeyboardMapping(&event.xmapping);
                        break;
                    default:
                        break;
                }
            }

            void generic(XGenericEventCookie& cookie)
            {
                switch (cookie.evtype)
                {
                    case XI_Motion:
                        motion(*static_cast<const XIDeviceEvent*>(cookie.data));
                        break;
                    case XI_ButtonPress:
                    case XI_ButtonRelease:
                        button(*static_cast<const XIDeviceEvent*>(cookie.data), cookie.evtype == XI_ButtonPress);
                        break;
                    case XI_Enter:
                    case XI_Leave:
                        crossing(*static_cast<const XIEnterEvent*>(cookie.data), cookie.evtype == XI_Enter);
                        break;
                    case XI_FocusIn:
                    case XI_FocusOut:
                        focusEvent(*static_cast<const XIFocusInEvent*>(cookie.data), cookie.evtype == XI_FocusIn);
                        break;
                    case XI_KeyPress:
                    case XI_KeyRelease:
                        deviceKey(*static_cast<const XIDeviceEvent*>(cookie.data), cookie.evtype == XI_KeyPress);
                        break;
                    case XI_HierarchyChanged:
                        // Devices came, went, or moved between masters.
                        if (smoothScrolling)
                            queryScrollDevices(XIAllDevices);
                        break;
                    case XI_DeviceChanged:
                    {
                        // A device's classes changed, or a master's events now
                        // come from another of its slaves: its axes, as they are.
                        const auto& changed = *static_cast<const XIDeviceChangedEvent*>(cookie.data);
                        if (smoothScrolling)
                            defineScroll(changed.reason == XISlaveSwitch ? changed.sourceid : changed.deviceid,
                                         changed.classes, changed.num_classes);
                        break;
                    }
                    default:
                        break;
                }
            }

            // ── Pointer ────────────────────────────────────────────────────

            // Puts the pointer's window over the editor's area of the view
            // (the view's edges where its size is not given), when it moved.
            void layOutPointerWindow()
            {
                if (pointerWindow == 0 || broken)
                    return;
                const auto left = static_cast<int>(std::lround(geometry.x));
                const auto top = static_cast<int>(std::lround(geometry.y));
                const auto right = geometry.width > 0
                                       ? static_cast<int>(std::lround(geometry.x + geometry.width * geometry.scale))
                                       : static_cast<int>(viewWidth);
                const auto bottom = geometry.height > 0
                                        ? static_cast<int>(std::lround(geometry.y + geometry.height * geometry.scale))
                                        : static_cast<int>(viewHeight);
                const int width = std::clamp(right - left, 1, 32767);
                const int height = std::clamp(bottom - top, 1, 32767);
                if (left == area.x && top == area.y && width == area.width && height == area.height)
                    return;
                area = { left, top, width, height };
                x.XMoveResizeWindow(display, pointerWindow, left, top, static_cast<unsigned>(width),
                                    static_cast<unsigned>(height));
                // Before the input that comes next: it lands where it now is.
                x.XSync(display, False);
            }

            // A position in the pointer's window (physical pixels) in the
            // editor's logical pixels.
            [[nodiscard]] ui::Point inEditor(double wx, double wy) const noexcept
            {
                return { (static_cast<float>(wx) + static_cast<float>(area.x) - geometry.x) / geometry.scale,
                         (static_cast<float>(wy) + static_cast<float>(area.y) - geometry.y) / geometry.scale };
            }

            template <typename XEventType>
            ui::PointerInput pointerInput(ui::PointerInput::Phase phase, const XEventType& event)
            {
                onScreen = ui::Point { static_cast<float>(event.root_x), static_cast<float>(event.root_y) };
                pointerDevice = event.deviceid;
                ui::PointerInput input;
                input.phase = phase;
                input.position = inEditor(event.event_x, event.event_y);
                input.screen = ui::Point { onScreen->x / geometry.scale, onScreen->y / geometry.scale };
                input.pointerId = 1; // the mouse, as on the Web
                input.type = ui::PointerType::Mouse;
                input.modifiers = modifiersOf(coreState(event.mods, event.group));
                input.buttons = held;
                input.pressure = held != 0 ? 0.5F : 0.0F;
                return input;
            }

            // Buttons held that the device no longer holds were released
            // where this connection could not see it (another client took
            // the pointer): that press is over.
            template <typename XEventType>
            void reconcile(const XEventType& event)
            {
                if ((held & ~buttonsOf(event.buttons)) != 0)
                    cancelPointer();
            }

            void cancelPointer()
            {
                if (held == 0)
                    return;
                held = 0;
                clicks.reset();
                ui::PointerInput input;
                input.phase = ui::PointerInput::Phase::Cancel;
                input.position = last;
                emit(input);
            }

            void motion(const XIDeviceEvent& event)
            {
                // Suspended, what is still queued (the window's leaving) is not read.
                if (event.event != pointerWindow || suspended)
                    return;
                const ui::Modifiers modifiers = modifiersOf(coreState(event.mods, event.group));
                // One value for each valuator the mask sets.
                const std::span<const unsigned char> mask { event.valuators.mask, static_cast<std::size_t>(std::max(
                                                                                      0, event.valuators.mask_len)) };
                std::size_t values = 0;
                for (const unsigned char byte : mask)
                    values += static_cast<std::size_t>(std::popcount(static_cast<unsigned>(byte)));
                const Scroll scrolled = scroll.motion(event.sourceid, mask, { event.valuators.values, values });
                if (! scrolled.empty())
                    addScroll(scrolled, inEditor(event.event_x, event.event_y), modifiers);
                reconcile(event);
                // Scrolling alone leaves the pointer where it is: no move.
                const ui::Point at { static_cast<float>(event.event_x), static_cast<float>(event.event_y) };
                if (moved && moved->x == at.x && moved->y == at.y)
                    return;
                moved = at;
                flushScroll();
                ui::PointerInput input = pointerInput(ui::PointerInput::Phase::Move, event);
                if (held != 0 && input.screen)
                    clicks.move(*input.screen);
                last = input.position;
                emit(input);
            }

            void button(const XIDeviceEvent& event, bool press)
            {
                if (event.event != pointerWindow || suspended)
                    return;
                if (const auto notch = wheelButton(event.detail))
                {
                    // XInput 2.1 emulates these for older clients from the
                    // scroll axes, which have scrolled already: only a wheel
                    // without such axes is scrolled by its buttons.
                    if (press && (event.flags & XIPointerEmulated) == 0)
                        addScroll(*notch, inEditor(event.event_x, event.event_y),
                                  modifiersOf(coreState(event.mods, event.group)));
                    return;
                }
                int pressed = 0;
                unsigned bit = 0;
                switch (event.detail)
                {
                    case 1:
                        pressed = 0;
                        bit = 1;
                        break;
                    case 2:
                        pressed = 1;
                        bit = 4;
                        break;
                    case 3:
                        pressed = 2;
                        bit = 2;
                        break;
                    default:
                        return; // back, forward and others: not reported
                }
                flushScroll();
                reconcile(event);
                if (press)
                {
                    if ((held & bit) != 0)
                        return;
                    // The first button pressed is the press; others join it
                    // as a move (chorded buttons, as Web pointer events have it).
                    const bool first = held == 0;
                    held |= bit;
                    ui::PointerInput input =
                        pointerInput(first ? ui::PointerInput::Phase::Down : ui::PointerInput::Phase::Move, event);
                    input.button = pressed;
                    if (first)
                        input.clicks = clicks.press(pressed, input.screen.value_or(input.position),
                                                    static_cast<std::uint32_t>(event.time));
                    last = input.position;
                    emit(input);
                    return;
                }
                if ((held & bit) == 0)
                    return;
                held &= ~bit;
                ui::PointerInput input =
                    pointerInput(held == 0 ? ui::PointerInput::Phase::Up : ui::PointerInput::Phase::Move, event);
                input.button = pressed;
                last = input.position;
                emit(input);
            }

            void crossing(const XIEnterEvent& event, bool enter)
            {
                // Into or out of a window inside the editor's (none takes input).
                if (event.event != pointerWindow || event.detail == XINotifyInferior || suspended)
                    return;
                flushScroll();
                if (enter)
                {
                    // What a device scrolled while the pointer was elsewhere
                    // went elsewhere: its values as they are now.
                    if (smoothScrolling)
                        queryScrollDevices(event.sourceid);
                    reconcile(event);
                    moved = ui::Point { static_cast<float>(event.event_x), static_cast<float>(event.event_y) };
                    ui::PointerInput input = pointerInput(ui::PointerInput::Phase::Move, event);
                    last = input.position;
                    emit(input);
                    return;
                }
                moved.reset();
                // Pressed and a grab began (another client took the pointer:
                // a host's menu) or ended (the view was hidden): the press is
                // over. A release outside the view comes before its ungrab.
                if (held != 0 && (event.mode == XINotifyGrab || event.mode == XINotifyUngrab))
                {
                    cancelPointer();
                    return;
                }
                ui::PointerInput input = pointerInput(ui::PointerInput::Phase::Leave, event);
                last = input.position;
                emit(input);
            }

            // ── Scrolling ──────────────────────────────────────────────────

            void queryScrollDevices(int device)
            {
                int count = 0;
                XIDeviceInfo* devices = x.XIQueryDevice(display, device, &count);
                if (device == XIAllDevices)
                    scroll.clear();
                if (devices == nullptr)
                {
                    scroll.forget(device);
                    return;
                }
                for (int i = 0; i < count; ++i)
                    defineScroll(devices[i].deviceid, devices[i].classes, devices[i].num_classes);
                x.XIFreeDeviceInfo(devices);
            }

            void defineScroll(int device, XIAnyClassInfo** classes, int count)
            {
                std::vector<ScrollAxis> axes;
                const std::span<XIAnyClassInfo*> all { classes, static_cast<std::size_t>(std::max(0, count)) };
                for (const XIAnyClassInfo* info : all)
                    if (info->type == XIScrollClass)
                    {
                        const auto* axis = reinterpret_cast<const XIScrollClassInfo*>(info);
                        axes.push_back({ .valuator = axis->number,
                                         .horizontal = axis->scroll_type == XIScrollTypeHorizontal,
                                         .increment = axis->increment,
                                         .value = std::nullopt });
                    }
                for (const XIAnyClassInfo* info : all)
                    if (info->type == XIValuatorClass)
                    {
                        const auto* valuator = reinterpret_cast<const XIValuatorClassInfo*>(info);
                        for (ScrollAxis& axis : axes)
                            if (axis.valuator == valuator->number)
                                axis.value = valuator->value;
                    }
                scroll.define(device, std::move(axes));
            }

            // Scrolling at one place, with the same modifiers, adds up until
            // something else happens: one wheel event for what was read.
            void addScroll(Scroll notches, ui::Point at, ui::Modifiers modifiers)
            {
                if (scrolling && (scrollAt.x != at.x || scrollAt.y != at.y || scrollModifiers != modifiers))
                    flushScroll();
                scrolling = true;
                pendingScroll += notches;
                scrollAt = at;
                scrollModifiers = modifiers;
            }

            void flushScroll()
            {
                if (! scrolling)
                    return;
                scrolling = false;
                const Scroll notches = std::exchange(pendingScroll, {});
                if (! notches.empty())
                    emit(wheelInput(notches, scrollAt, scrollModifiers));
            }

            // ── Focus ──────────────────────────────────────────────────────

            // Whether the view or a window in it has the keyboard focus.
            bool queryFocus()
            {
                Window focus = None;
                int revert = 0;
                x.XGetInputFocus(display, &focus, &revert);
                for (int depth = 0; depth < 64 && focus != None && focus != PointerRoot; ++depth)
                {
                    if (focus == view)
                        return true;
                    Window top = 0;
                    Window parent = 0;
                    Window* children = nullptr;
                    unsigned count = 0;
                    if (x.XQueryTree(display, focus, &top, &parent, &children, &count) == 0)
                        return false;
                    if (children != nullptr)
                        x.XFree(children);
                    if (focus == top)
                        return false;
                    focus = parent;
                }
                return false;
            }

            void focusEvent(const XIFocusInEvent& event, bool in)
            {
                if (event.event != view)
                    return;
                // Another client grabbing the keyboard takes its keys while
                // the focus stays: lost until the grab ends.
                if (! in && event.mode == XINotifyGrab)
                    keyboardGrabbed = true;
                else if (in && event.mode == XINotifyUngrab)
                    keyboardGrabbed = false;
                setFocus(! keyboardGrabbed && queryFocus());
            }

            void setFocus(bool focused)
            {
                if (focused == hasFocus)
                    return;
                flushScroll();
                if (! focused)
                    releaseKeys();
                hasFocus = focused;
                updateComposition();
                emit(FocusChange { .focused = focused });
            }

            // ── Keys and text ──────────────────────────────────────────────

            void deviceKey(const XIDeviceEvent& event, bool press)
            {
                if (event.event != view || suspended)
                    return;
                // As the core event it replaces, for the input method and Xlib.
                XEvent core {};
                XKeyEvent& key = core.xkey;
                key.type = press ? KeyPress : KeyRelease;
                key.serial = event.serial;
                key.send_event = False;
                key.display = display;
                key.window = view;
                key.root = event.root;
                key.subwindow = event.child;
                key.time = event.time;
                key.x = static_cast<int>(event.event_x);
                key.y = static_cast<int>(event.event_y);
                key.x_root = static_cast<int>(event.root_x);
                key.y_root = static_cast<int>(event.root_y);
                key.state = coreState(event.mods, event.group);
                key.keycode = static_cast<unsigned>(event.detail);
                key.same_screen = True;
                // Composing: the input method takes the key, and gives back
                // what it does not use (as a core event) or what it composed.
                if (composing && x.XFilterEvent(&core, None) != 0)
                    return;
                this->key(key, (event.flags & XIKeyRepeat) != 0);
            }

            // The keysym the key is, as named: its level and layout, but not
            // Control's (Control+Shift+A is "A"), as browsers name it.
            KeySym keysymOf(const XKeyEvent& event, unsigned state)
            {
                KeySym keysym = NoSymbol;
                if (xkb)
                {
                    unsigned consumed = 0;
                    if (x.XkbLookupKeySym(display, static_cast<KeyCode>(event.keycode), state, &consumed, &keysym) == 0)
                        return NoSymbol;
                    return keysym;
                }
                XKeyEvent copy = event;
                copy.state = state;
                std::array<char, 8> ignored {};
                x.XLookupString(&copy, ignored.data(), static_cast<int>(ignored.size()), &keysym, nullptr);
                return keysym;
            }

            // What a press types: the input method's text, or the keysym's.
            std::string textOf(XKeyEvent& event)
            {
                KeySym keysym = NoSymbol;
                if (context != nullptr)
                {
                    std::array<char, 64> buffer {};
                    Status status = 0;
                    int length = x.Xutf8LookupString(context, &event, buffer.data(), static_cast<int>(buffer.size()),
                                                     &keysym, &status);
                    if (status == XBufferOverflow && length > 0)
                    {
                        std::string text(static_cast<std::size_t>(length), '\0');
                        length = x.Xutf8LookupString(context, &event, text.data(), length, &keysym, &status);
                        text.resize(static_cast<std::size_t>(std::max(0, length)));
                        return status == XLookupChars || status == XLookupBoth ? text : std::string();
                    }
                    if (status == XLookupChars || status == XLookupBoth)
                        return { buffer.data(), static_cast<std::size_t>(std::max(0, length)) };
                    return {};
                }
                keysym = keysymOf(event, event.state);
                return keysymText()(static_cast<std::uint32_t>(keysym));
            }

            [[nodiscard]] KeysymText keysymText() const noexcept
            {
                return x.xkb_keysym_to_utf8 != nullptr ? &xkbKeysymText : &basicKeysymText;
            }

            void key(XKeyEvent& event, bool /*autoRepeat*/)
            {
                flushScroll();
                const ui::Modifiers modifiers = modifiersOf(event.state);
                const auto heldKey = std::ranges::find_if(heldKeys, [&](const HeldKey& known)
                                                          { return known.keycode == event.keycode; });
                if (event.type == KeyRelease)
                {
                    // Only keys whose press was reported go up: one the
                    // input method took stays its own.
                    if (heldKey == heldKeys.end())
                        return;
                    ui::KeyInput input { .down = false,
                                         .key = heldKey->name,
                                         .repeat = false,
                                         .modifiers =
                                             static_cast<ui::Modifiers>(modifiers & ~modifierOfKey(heldKey->name)) };
                    heldKeys.erase(heldKey);
                    emit(KeyEvent { .key = std::move(input), .typed = {} });
                    return;
                }
                std::string text = textOf(event);
                // Keycode 0: what an input method composed, committed.
                if (event.keycode == 0)
                {
                    if (! text.empty())
                        emit(ui::TextInput { std::move(text) });
                    return;
                }
                std::string name = keyName(
                    static_cast<std::uint32_t>(keysymOf(event, event.state & ~static_cast<unsigned>(ControlMask))),
                    keysymText());
                std::string typed = typedText(std::move(text), modifiers);
                if (name.empty())
                {
                    if (! typed.empty())
                        emit(ui::TextInput { std::move(typed) });
                    return;
                }
                // Held already: the keyboard repeats it (XInput 2 says so
                // too; a core event cannot).
                const bool repeat = heldKey != heldKeys.end();
                if (! repeat)
                    heldKeys.push_back({ .keycode = event.keycode, .name = name });
                const ui::Modifiers own = modifierOfKey(name);
                emit(KeyEvent { .key = { .down = true,
                                         .key = std::move(name),
                                         .repeat = repeat,
                                         .modifiers = static_cast<ui::Modifiers>(modifiers | own) },
                                .typed = std::move(typed) });
            }

            void releaseKeys()
            {
                for (HeldKey& released : std::exchange(heldKeys, {}))
                    emit(KeyEvent {
                        .key = { .down = false, .key = std::move(released.name), .repeat = false, .modifiers = 0 },
                        .typed = {} });
            }

            // ── Input method ───────────────────────────────────────────────

            void openInputMethod()
            {
                if (x.XSupportsLocale() == 0)
                    return;
                // The user's input method (XMODIFIERS, as GTK and Qt read it),
                // unless something in this process chose one already.
                const char* current = x.XSetLocaleModifiers(nullptr);
                if (current == nullptr || *current == '\0')
                    x.XSetLocaleModifiers("");
                method = x.XOpenIM(display, nullptr, nullptr, nullptr);
                if (method == nullptr)
                {
                    waitForInputMethod();
                    return;
                }
                destroyed = XIMCallback { reinterpret_cast<XPointer>(this), &X11Input::inputMethodGone };
                x.XSetIMValues(method, XNDestroyCallback, &destroyed, nullptr);
                // The input method shows what is being composed itself
                // (Soundor has no composition events to show it with).
                XIMStyles* styles = nullptr;
                XIMStyle style = 0;
                if (x.XGetIMValues(method, XNQueryInputStyle, &styles, nullptr) == nullptr && styles != nullptr)
                {
                    const std::span<XIMStyle> offered { styles->supported_styles, styles->count_styles };
                    for (const XIMStyle candidate : offered)
                        if (candidate == (XIMPreeditNothing | XIMStatusNothing))
                            style = candidate;
                    if (style == 0)
                        for (const XIMStyle candidate : offered)
                            if (candidate == (XIMPreeditNone | XIMStatusNone))
                                style = candidate;
                    x.XFree(styles);
                }
                if (style != 0)
                    context =
                        x.XCreateIC(method, XNInputStyle, style, XNClientWindow, view, XNFocusWindow, view, nullptr);
                if (context == nullptr)
                {
                    x.XCloseIM(method);
                    method = nullptr;
                    return;
                }
                long filtered = 0;
                x.XGetICValues(context, XNFilterEvents, &filtered, nullptr);
                coreEvents |= filtered;
                x.XSelectInput(display, view, coreEvents);
                x.XUnsetICFocus(context);
                composing = false;
                updateComposition();
            }

            void waitForInputMethod()
            {
                waitingForInputMethod =
                    x.XRegisterIMInstantiateCallback(display, nullptr, nullptr, nullptr, &X11Input::inputMethodReady,
                                                     reinterpret_cast<XPointer>(this))
                    != 0;
            }

            // An input method (server) started: use it.
            static void inputMethodReady(Display* /*display*/, XPointer self, XPointer /*data*/)
            {
                auto* input = reinterpret_cast<X11Input*>(self);
                input->x.XUnregisterIMInstantiateCallback(input->display, nullptr, nullptr, nullptr,
                                                          &X11Input::inputMethodReady, self);
                input->waitingForInputMethod = false;
                input->openInputMethod();
            }

            // The input method went away (its server stopped), with its
            // context: keys are keys until another comes.
            static void inputMethodGone(XIM /*method*/, XPointer self, XPointer /*data*/)
            {
                auto* input = reinterpret_cast<X11Input*>(self);
                input->method = nullptr;
                input->context = nullptr;
                input->composing = false;
                input->waitForInputMethod();
            }

            // Composes while the view has the focus and its focused node takes
            // text; elsewhere keys stay keys, a dead key included.
            void updateComposition()
            {
                const bool wanted = context != nullptr && hasFocus && textFocused && ! suspended;
                if (wanted == composing || broken)
                    return;
                if (wanted)
                    x.XSetICFocus(context);
                else
                    x.XUnsetICFocus(context);
                composing = wanted;
                x.XFlush(display);
            }

            struct HeldKey
            {
                unsigned keycode = 0;
                std::string name;
            };

            struct Area
            {
                int x = 0;
                int y = 0;
                int width = 0;
                int height = 0;
            };

            const Xlib& x;
            Display* display;
            Window view;
            Window root = 0;
            // The window over the editor's area that takes its pointer input.
            Window pointerWindow = 0;
            Area area;
            unsigned viewWidth = 1;
            unsigned viewHeight = 1;
            int opcode = 0;
            long coreEvents = KeyPressMask | KeyReleaseMask | StructureNotifyMask;
            ErrorLog errors;
            bool broken = false;
            bool xkb = false;
            bool smoothScrolling = false;
            std::vector<Event>* out = nullptr;
            ViewGeometry geometry;

            // The pointer.
            unsigned held = 0;
            int pointerDevice = 2; // the virtual core pointer until one moves
            ui::Point last;
            std::optional<ui::Point> moved;    // where it last moved, in the view
            std::optional<ui::Point> onScreen; // in physical pixels
            ClickCounter clicks;

            // Scrolling.
            ScrollDevices scroll;
            bool scrolling = false;
            Scroll pendingScroll;
            ui::Point scrollAt;
            ui::Modifiers scrollModifiers = 0;

            // Keys, focus and text.
            std::vector<HeldKey> heldKeys;
            bool hasFocus = false;
            bool keyboardGrabbed = false;
            bool suspended = false;
            bool textFocused = false;
            XIM method = nullptr;
            XIC context = nullptr;
            XIMCallback destroyed {};
            bool composing = false;
            bool waitingForInputMethod = false;
        };
    } // namespace

    std::unique_ptr<PlatformInput> createInput(const PlatformOptions& options, std::string* failure)
    {
        std::string why;
        const auto fail = [&](std::string reason) -> std::unique_ptr<PlatformInput>
        {
            if (failure != nullptr)
                *failure = std::move(reason);
            return nullptr;
        };
        if (options.view.handle == nullptr)
            return fail("no X11 window to read input in");
        const Xlib& x = xlib();
        if (! x.available)
            return fail("native input needs libX11.so.6 and libXi.so.6");
        Display* display = x.XOpenDisplay(nullptr);
        if (display == nullptr)
            return fail("no X11 display");
        const auto view = static_cast<Window>(reinterpret_cast<std::uintptr_t>(options.view.handle));
        auto input = std::make_unique<X11Input>(x, display, view, options);
        if (! input->start(why))
            return fail(why.empty() ? "the X11 connection was lost" : why);
        return input;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
