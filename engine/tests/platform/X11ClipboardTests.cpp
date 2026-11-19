#include "../web/WebTestSupport.h"

#include <soundor/platform/Clipboard.h>

#include <X11/Xatom.h>
#include <X11/Xlib.h>

#include <chrono>
#include <memory>
#include <string>
#include <thread>

using namespace soundor;
using namespace std::chrono_literals;

namespace
{
    struct XFreeData
    {
        void operator()(unsigned char* data) const { XFree(data); }
    };

    // A separate X11 connection acts as another toolkit, with its event
    // callbacks running on the very same UI thread as the plugin.
    struct Peer
    {
        const std::unique_ptr<Display, decltype(&XCloseDisplay)> display { XOpenDisplay(nullptr), XCloseDisplay };
        Window window = None;
        Atom clipboard = None;
        Atom utf8 = None;
        Atom property = None;
        Atom incremental = None;

        Peer()
        {
            if (display == nullptr)
                return;
            auto* x = display.get();
            window = XCreateSimpleWindow(x, DefaultRootWindow(x), 0, 0, 1, 1, 0, 0, 0);
            XSelectInput(x, window, PropertyChangeMask);
            clipboard = XInternAtom(x, "CLIPBOARD", False);
            utf8 = XInternAtom(x, "UTF8_STRING", False);
            property = XInternAtom(x, "SOUNDOR_TEST_PASTE", False);
            incremental = XInternAtom(x, "INCR", False);
        }

        bool next(int type, XEvent& event) const
        {
            const auto deadline = std::chrono::steady_clock::now() + 300ms;
            do
            {
                if (XCheckTypedEvent(display.get(), type, &event) != False)
                    return true;
                std::this_thread::sleep_for(1ms);
            } while (std::chrono::steady_clock::now() < deadline);
            return false;
        }

        [[nodiscard]] std::string receive() const
        {
            auto* x = display.get();
            Atom type = None;
            int format = 0;
            unsigned long count = 0;
            unsigned long bytesLeft = 0;
            unsigned char* data = nullptr;
            CHECK(XGetWindowProperty(x, window, property, 0, 65536, True, AnyPropertyType, &type, &format, &count,
                                     &bytesLeft, &data)
                  == Success);
            std::unique_ptr<unsigned char, XFreeData> storage(data);
            CHECK(bytesLeft == 0);
            if (type == incremental)
            {
                CHECK(format == 32);
                std::string text;
                XEvent event {};
                while (next(PropertyNotify, event))
                {
                    if (event.xproperty.atom != property || event.xproperty.state != PropertyNewValue)
                        continue;
                    CHECK(XGetWindowProperty(x, window, property, 0, 65536, True, AnyPropertyType, &type, &format,
                                             &count, &bytesLeft, &data)
                          == Success);
                    storage.reset(data);
                    if (type == None)
                        continue; // A notification from before the INCR handshake.
                    CHECK(type == utf8);
                    CHECK(format == 8);
                    CHECK(bytesLeft == 0);
                    if (count == 0)
                        return text;
                    text.append(reinterpret_cast<const char*>(data), count);
                }
                FAIL("The clipboard did not complete the incremental transfer");
            }
            CHECK(type == utf8);
            CHECK(format == 8);
            return data == nullptr ? std::string {} : std::string(reinterpret_cast<const char*>(data), count);
        }

        void send(const XSelectionRequestEvent& request, const std::string& text) const
        {
            auto* x = display.get();
            CHECK(request.selection == clipboard);
            CHECK(request.target == utf8);
            XChangeProperty(x, request.requestor, request.property, utf8, 8, PropModeReplace,
                            reinterpret_cast<const unsigned char*>(text.data()), static_cast<int>(text.size()));
            XEvent event {};
            event.xselection.type = SelectionNotify;
            event.xselection.requestor = request.requestor;
            event.xselection.selection = request.selection;
            event.xselection.target = request.target;
            event.xselection.property = request.property;
            event.xselection.time = request.time;
            XSendEvent(x, request.requestor, False, NoEventMask, &event);
            XFlush(x);
        }
    };

    constexpr const char* module = "import { root, createTextInput, clipboard } from 'soundor:ui';\n";

    RuntimeHost::Options clipboardOptions()
    {
        RuntimeHost::Options options;
        options.clipboard = platform::systemClipboard();
        REQUIRE(options.clipboard != nullptr);
        return options;
    }
} // namespace

TEST_SUITE("X11 clipboard")
{
    TEST_CASE("desktop applications can paste UTF-8 after the plugin editor closes")
    {
        Peer peer;
        if (peer.display == nullptr)
            return;
        {
            test::WebFixture fixture(clipboardOptions());
            // Larger than a single transfer, with multibyte text across chunks.
            fixture.run(std::string(module)
                        + "clipboard.writeText('café 🎚'.repeat(16000)).then(() => { globalThis.copied = true; });");
            REQUIRE(fixture.tickUntil("globalThis.copied === true"));
        }

        XConvertSelection(peer.display.get(), peer.clipboard, peer.utf8, peer.property, peer.window, CurrentTime);
        XFlush(peer.display.get());
        XEvent event {};
        REQUIRE(peer.next(SelectionNotify, event));
        REQUIRE(event.xselection.property == peer.property);
        const std::string copied = peer.receive();
        std::string expected;
        for (int i = 0; i < 16000; ++i)
            expected += "café 🎚";
        CHECK(copied == expected);
    }

    TEST_CASE("a host on the plugin's UI thread can serve a paste")
    {
        Peer peer;
        if (peer.display == nullptr)
            return;
        XSetSelectionOwner(peer.display.get(), peer.clipboard, peer.window, CurrentTime);
        REQUIRE(XGetSelectionOwner(peer.display.get(), peer.clipboard) == peer.window);
        test::WebFixture fixture(clipboardOptions());
        fixture.run(std::string(module) + R"(
            globalThis.input = createTextInput();
            root.appendChild(input);
            input.focus();
        )");
        CHECK(fixture.host.surface().key(
            { .down = true, .key = "v", .repeat = false, .modifiers = ui::Modifier::Control }));
        XEvent event {};
        REQUIRE(peer.next(SelectionRequest, event));
        peer.send(event.xselectionrequest, "café\n🎚");
        CHECK(fixture.tickUntil("input.value === 'café 🎚'"));
    }
}
