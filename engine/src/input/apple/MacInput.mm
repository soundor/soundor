#include "input/apple/MacInput.h"

#include "input/KeyCodes.h"
#include "input/apple/Translation.h"
#include "platform/apple/RuntimeClass.h"

#import <AppKit/AppKit.h>
#import <CoreGraphics/CoreGraphics.h>

#include <algorithm>
#include <map>
#include <string>
#include <utility>

#if ! __has_feature(objc_arc)
    #error "MacInput.mm requires ARC"
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::apple
{
    namespace
    {
        const char ownerKey = 0;

        std::string utf8(NSString* text)
        {
            return text != nil ? std::string(text.UTF8String) : std::string();
        }

        NSString* plainText(id value)
        {
            return [value isKindOfClass:[NSAttributedString class]] ? [value string] : value;
        }

        class MacInput final : public PlatformInput
        {
        public:
            explicit MacInput(NSView* parent) : host(parent)
            {
                view = [[viewClass() alloc] initWithFrame:NSZeroRect];
                objc_setAssociatedObject(view, &ownerKey, [NSValue valueWithPointer:this],
                                         OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                view.accessibilityElement = NO;
                tracking = [[NSTrackingArea alloc] initWithRect:NSZeroRect
                                                        options:NSTrackingMouseEnteredAndExited | NSTrackingMouseMoved
                                                                | NSTrackingActiveAlways | NSTrackingInVisibleRect
                                                          owner:view
                                                       userInfo:nil];
                [view addTrackingArea:tracking];
                [parent addSubview:view positioned:NSWindowAbove relativeTo:nil];
                observeWindow();
            }

            ~MacInput() override
            {
                // Clear before any AppKit calls: retained views and input contexts
                // can still receive responder/text callbacks during or after detach.
                objc_setAssociatedObject(view, &ownerKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
                removeObservers();
                [context discardMarkedText];
                [context deactivate];
                yieldFocus();
                [view removeTrackingArea:tracking];
                [view removeFromSuperview];
            }

            MacInput(const MacInput&) = delete;
            MacInput& operator=(const MacInput&) = delete;

            int fileDescriptor() const override { return -1; }

            void read(std::vector<Event>& events) override
            {
                if (observedWindow != view.window)
                    observeWindow();
                updateFocus();
                if (view.window == nil || view.hiddenOrHasHiddenAncestor)
                    endInput();
                events.insert(events.end(), std::make_move_iterator(pending.begin()),
                              std::make_move_iterator(pending.end()));
                pending.clear();
            }

            void cancel(std::vector<Event>& events) override
            {
                // Queued input belongs to the state being cancelled, not its successor.
                pending.clear();
                endInput();
                events.insert(events.end(), std::make_move_iterator(pending.begin()),
                              std::make_move_iterator(pending.end()));
                pending.clear();
            }

            void setGeometry(const ViewGeometry& next) override
            {
                geometry = next;
                NSView* parent = host;
                const CGFloat width = next.width > 0 ? next.width * scale() : parent.bounds.size.width - next.x;
                const CGFloat height = next.height > 0 ? next.height * scale() : parent.bounds.size.height - next.y;
                const CGFloat y =
                    parent.flipped ? parent.bounds.origin.y + next.y : NSMaxY(parent.bounds) - next.y - height;
                view.frame = NSMakeRect(parent.bounds.origin.x + next.x, y, std::max<CGFloat>(0, width),
                                        std::max<CGFloat>(0, height));
            }

            void setSuspended(bool next, std::vector<Event>& events) override
            {
                if (next == suspended)
                    return;
                suspended = next;
                if (next)
                {
                    restoreFocus = ownsFocus();
                    cancel(events);
                    yieldFocus();
                }
                view.hidden = next;
                if (! next && restoreFocus
                    && (view.window.firstResponder == host || view.window.firstResponder == view.window))
                    requestFocus();
            }

            void setTextInputFocused(bool next) override
            {
                if (textFocused == next)
                    return;
                textFocused = next;
                if (next && focused())
                    [inputContext() activate];
                else if (! next)
                {
                    discardComposition();
                    [context deactivate];
                }
            }

            void requestFocus() override
            {
                if (! suspended && ! view.hiddenOrHasHiddenAncestor)
                    [view.window makeFirstResponder:view];
                updateFocus();
            }

            bool focused() const override { return ! suspended && ownsFocus() && view.window.keyWindow; }
            unsigned buttons() const override
            {
                return controlClick && (held & buttonMask(0)) != 0 ? (held & ~buttonMask(0)) | buttonMask(1) : held;
            }

            std::optional<ui::Point> pointerOnScreen() const override
            {
                // CoreGraphics desktop coordinates, in screen points, including
                // displays above/left of the primary display. Warp uses the same space.
                CGEventRef event = CGEventCreate(nullptr);
                if (event == nullptr)
                    return std::nullopt;
                const CGPoint point = CGEventGetLocation(event);
                CFRelease(event);
                return ui::Point { static_cast<float>(point.x), static_cast<float>(point.y) };
            }

            void warpPointer(ui::Point point) override { CGWarpMouseCursorPosition(CGPointMake(point.x, point.y)); }

            static MacInput* owner(id object)
            {
                NSValue* value = objc_getAssociatedObject(object, &ownerKey);
                return static_cast<MacInput*>(value.pointerValue);
            }

        private:
            float scale() const { return geometry.scale > 0 ? geometry.scale : 1; }
            bool ownsFocus() const { return view.window != nil && view.window.firstResponder == view; }

            void yieldFocus()
            {
                if (ownsFocus() && ! [view.window makeFirstResponder:host])
                    [view.window makeFirstResponder:nil];
            }

            void removeObservers()
            {
                for (id observer in observers)
                    [[NSNotificationCenter defaultCenter] removeObserver:observer];
                [observers removeAllObjects];
            }

            void observeWindow()
            {
                removeObservers();
                observers = [NSMutableArray array];
                NSWindow* window = view.window;
                observedWindow = window;
                if (window == nil)
                {
                    endInput();
                    return;
                }
                __weak NSView* weakView = view;
                for (NSNotificationName name in @[
                         NSWindowDidBecomeKeyNotification, NSWindowDidResignKeyNotification,
                         NSWindowWillCloseNotification, NSWindowDidMiniaturizeNotification
                     ])
                {
                    id observer = [[NSNotificationCenter defaultCenter]
                        addObserverForName:name
                                    object:window
                                     queue:nil
                                usingBlock:^(NSNotification* notification) {
                                  if (auto* input = owner(weakView))
                                  {
                                      if ([notification.name isEqualToString:NSWindowWillCloseNotification] ||
                                          [notification.name isEqualToString:NSWindowDidMiniaturizeNotification])
                                          input->endInput();
                                      else
                                          input->updateFocus();
                                  }
                                }];
                    [observers addObject:observer];
                }
                updateFocus();
            }

            void updateFocus()
            {
                const bool next = focused();
                if (next == hasFocus)
                    return;
                if (! next)
                    endInput();
                hasFocus = next;
                if (next && textFocused)
                    [inputContext() activate];
                pending.emplace_back(FocusChange { next });
            }

            bool canReplace(NSRange range) const
            {
                if (range.location == NSNotFound
                    || (range.location <= marked.length && range.length <= marked.length - range.location))
                    return true;
#ifndef NDEBUG
                NSLog(@"Soundor input: document-range text replacement is unavailable");
#endif
                return false;
            }

            void discardComposition()
            {
                marked = @"";
                selection = NSMakeRange(0, 0);
                [context discardMarkedText];
            }

            void endInput()
            {
                if (held != 0)
                {
                    pending.emplace_back(ui::PointerInput {
                        .phase = ui::PointerInput::Phase::Cancel, .position = last, .screen = std::nullopt });
                    held = 0;
                    controlClick = false;
                }
                for (auto& [code, name] : heldKeys)
                    pending.emplace_back(
                        KeyEvent { .key = { .down = false, .key = name, .code = std::string(codeOfMacKeyCode(code)) },
                                   .typed = {} });
                heldKeys.clear();
                scrolling = false;
                discardComposition();
                [context deactivate];
            }

            ui::Point position(NSEvent* event) const
            {
                const NSPoint point = [view convertPoint:event.locationInWindow fromView:nil];
                return { static_cast<float>(point.x) / scale(), static_cast<float>(point.y) / scale() };
            }

            void pointer(NSEvent* event)
            {
                if (suspended)
                    return;
                const auto type = event.type;
                const bool down = type == NSEventTypeLeftMouseDown || type == NSEventTypeRightMouseDown
                                  || type == NSEventTypeOtherMouseDown;
                const bool up = type == NSEventTypeLeftMouseUp || type == NSEventTypeRightMouseUp
                                || type == NSEventTypeOtherMouseUp;
                const unsigned before = held;
                // Left/right responder selectors already identify the button.
                // NSEvent's public mouse-event factory leaves buttonNumber at zero.
                const unsigned button = type == NSEventTypeRightMouseDown || type == NSEventTypeRightMouseUp ? 1U
                                        : type == NSEventTypeLeftMouseDown || type == NSEventTypeLeftMouseUp
                                            ? 0U
                                            : static_cast<unsigned>(event.buttonNumber);
                if ((down || up) && buttonMask(button) == 0)
                    return;
                if (down)
                {
                    requestFocus();
                    if (button == 0)
                        controlClick = (event.modifierFlags & NSEventModifierFlagControl) != 0;
                    held |= buttonMask(button);
                }
                else if (up)
                {
                    if ((held & buttonMask(button)) == 0)
                        return;
                    held &= ~buttonMask(button);
                }
                ui::PointerInput input;
                input.position = last = position(event);
                // AppKit's screen is y-up; Soundor's is y-down from the top
                // of the primary display, in editor units (Retina adds no factor).
                const NSPoint screen = [view.window convertPointToScreen:event.locationInWindow];
                const CGFloat top = NSScreen.screens.firstObject.frame.size.height;
                input.screen =
                    ui::Point { static_cast<float>(screen.x) / scale(), static_cast<float>(top - screen.y) / scale() };
                input.modifiers = modifiersOf(event.modifierFlags);
                input.buttons = buttons();
                input.pressure = held != 0 ? 0.5F : 0;
                if (down && before == 0)
                {
                    input.phase = ui::PointerInput::Phase::Down;
                    input.clicks = std::max(1, static_cast<int>(event.clickCount));
                }
                else if (up && held == 0)
                    input.phase = ui::PointerInput::Phase::Up;
                else if (type == NSEventTypeMouseExited)
                    input.phase = ui::PointerInput::Phase::Leave;
                if (down || up)
                    input.button = buttonOf(button == 0 && controlClick ? 1U : button);
                if (up && button == 0)
                    controlClick = false;
                pending.emplace_back(std::move(input));
            }

            void scroll(NSEvent* event)
            {
                if (suspended)
                    return;
                const NSEventPhase phase = event.phase;
                const NSEventPhase momentum = event.momentumPhase;
                const bool discrete = phase == NSEventPhaseNone && momentum == NSEventPhaseNone;
                if (! scrolling || (phase & NSEventPhaseBegan) != 0 || discrete)
                    scrollAt = position(event);
                scrolling = ! discrete;
                auto input = wheelInput(event.scrollingDeltaX, event.scrollingDeltaY, event.hasPreciseScrollingDeltas,
                                        scale(), scrollAt, modifiersOf(event.modifierFlags));
                // Zero-delta phase boundaries carry no WheelInput, but still
                // delimit targeting. AppKit supplies momentum; never synthesize it.
                if (input.deltaX != 0 || input.deltaY != 0)
                    pending.emplace_back(input);
                if ((phase & NSEventPhaseCancelled) != 0
                    || (momentum & (NSEventPhaseEnded | NSEventPhaseCancelled)) != 0)
                    scrolling = false;
            }

            static std::string typedCharacters(NSEvent* event)
            {
                if ((event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl)) != 0
                    || event.characters.length == 0)
                    return {};
                const unichar first = [event.characters characterAtIndex:0];
                if (first < 32 || first == 127 || (first >= 0xF700 && first <= 0xF8FF))
                    return {};
                return utf8(event.characters);
            }

            void emitKey(NSEvent* event, bool down)
            {
                const unsigned code = event.keyCode;
                const auto known = heldKeys.find(code);
                if (! down)
                {
                    if (known == heldKeys.end())
                        return;
                    pending.emplace_back(KeyEvent { .key = { .down = false,
                                                             .key = known->second,
                                                             .code = std::string(codeOfMacKeyCode(code)),
                                                             .modifiers = modifiersOf(event.modifierFlags) },
                                                    .typed = {} });
                    heldKeys.erase(known);
                    return;
                }
                std::string name = keyName(code, utf8(event.characters), utf8(event.charactersIgnoringModifiers));
                const bool repeat = known != heldKeys.end() || event.isARepeat;
                if (known == heldKeys.end())
                    heldKeys.emplace(code, name);
                pending.emplace_back(KeyEvent { .key = { .down = true,
                                                         .key = std::move(name),
                                                         .code = std::string(codeOfMacKeyCode(code)),
                                                         .repeat = repeat,
                                                         .modifiers = modifiersOf(event.modifierFlags) },
                                                .typed = ! textFocused ? typedCharacters(event) : std::string() });
            }

            void key(NSEvent* event)
            {
                if (suspended)
                    return;
                updateFocus();
                if (event.type == NSEventTypeKeyUp)
                {
                    emitKey(event, false);
                    return;
                }
                // The context owns keys while composing; doCommandBySelector:
                // returns editing/navigation commands to the physical-key path.
                if (textFocused
                    && (event.modifierFlags & (NSEventModifierFlagCommand | NSEventModifierFlagControl)) == 0)
                {
                    handlingKey = event;
                    commandSent = false;
                    committed = nil;
                    const bool wasMarked = marked.length != 0;
                    const BOOL handled = [inputContext() handleEvent:event];
                    // A normal character: key first, then text, allowing preventDefault.
                    if (! commandSent && ! wasMarked && marked.length == 0)
                    {
                        emitKey(event, true);
                        std::get<KeyEvent>(pending.back()).typed = committed.length != 0 ? utf8(committed)
                                                                   : ! handled           ? typedCharacters(event)
                                                                                         : std::string();
                    }
                    else if (committed.length != 0)
                        pending.emplace_back(ui::TextInput { utf8(committed) });
                    else if (! handled && ! commandSent)
                        emitKey(event, true);
                    handlingKey = nil;
                    committed = nil;
                }
                else
                    emitKey(event, true);
            }

            NSTextInputContext* inputContext()
            {
                if (! textFocused || suspended)
                    return nil;
                if (context == nil)
                    context = [[NSTextInputContext alloc] initWithClient:static_cast<id<NSTextInputClient>>(view)];
                return context;
            }

            void flags(NSEvent* event)
            {
                if (suspended)
                    return;
                const unsigned code = event.keyCode;
                const std::string name = keyName(code, {}, {});
                ui::Modifiers own = 0;
                if (name == "Shift")
                    own = ui::Modifier::Shift;
                if (name == "Control")
                    own = ui::Modifier::Control;
                if (name == "Alt")
                    own = ui::Modifier::Alt;
                if (name == "Meta")
                    own = ui::Modifier::Meta;
                const bool active = code == 57   ? (event.modifierFlags & NSEventModifierFlagCapsLock) != 0
                                    : code == 63 ? (event.modifierFlags & NSEventModifierFlagFunction) != 0
                                                 : (modifiersOf(event.modifierFlags) & own) != 0;
                const bool down = active && ! heldKeys.contains(code);
                if (down)
                    heldKeys.emplace(code, name);
                else if (heldKeys.erase(code) == 0)
                    return;
                pending.emplace_back(KeyEvent { .key = { .down = down,
                                                         .key = name,
                                                         .code = std::string(codeOfMacKeyCode(code)),
                                                         .modifiers = modifiersOf(event.modifierFlags) },
                                                .typed = {} });
            }

            static Class viewClass();

            __weak NSWindow* observedWindow;
            __weak NSView* host;
            NSView* view = nil;
            NSTrackingArea* tracking = nil;
            NSMutableArray* observers = nil;
            NSTextInputContext* context = nil;
            ViewGeometry geometry;
            std::vector<Event> pending;
            std::map<unsigned, std::string> heldKeys;
            ui::Point last;
            ui::Point scrollAt;
            unsigned held = 0;
            bool controlClick = false;
            bool suspended = false;
            bool restoreFocus = false;
            bool hasFocus = false;
            bool textFocused = false;
            bool scrolling = false;
            NSString* marked = @"";
            NSRange selection = NSMakeRange(0, 0);
            NSEvent* handlingKey = nil;
            NSString* committed = nil;
            bool commandSent = false;
        };

        Class MacInput::viewClass()
        {
            static Class registered = []
            {
                std::vector<platform::apple::Method> methods;
                const auto add = [&](SEL selector, IMP implementation)
                {
                    Method method = class_getInstanceMethod([NSView class], selector);
                    const char* encoding =
                        method != nullptr
                            ? method_getTypeEncoding(method)
                            : protocol_getMethodDescription(@protocol(NSTextInputClient), selector, YES, YES).types;
                    methods.push_back({ selector, implementation, encoding });
                };
                add(@selector(isFlipped), reinterpret_cast<IMP>(+[](id, SEL) -> BOOL { return YES; }));
                add(@selector(acceptsFirstResponder), reinterpret_cast<IMP>(+[](id self, SEL) -> BOOL
                                                                            {
                                                                                auto* input = owner(self);
                                                                                return input != nullptr
                                                                                       && ! input->suspended;
                                                                            }));
                add(@selector(acceptsFirstMouse:),
                    reinterpret_cast<IMP>(+[](id self, SEL, NSEvent*) -> BOOL { return owner(self) != nullptr; }));
                add(@selector(resignFirstResponder),
                    reinterpret_cast<IMP>(+[](id self, SEL) -> BOOL
                                          {
                                              if (auto* input = owner(self))
                                              {
                                                  input->endInput();
                                                  if (std::exchange(input->hasFocus, false))
                                                      input->pending.emplace_back(FocusChange { false });
                                              }
                                              return YES;
                                          }));
                // NSView's default becomeFirstResponder accepts; focus is sampled
                // in read() after NSWindow has installed its new first responder.
                for (SEL selector : {
                         @selector(mouseDown:), @selector(mouseUp:), @selector(mouseMoved:), @selector(mouseDragged:),
                             @selector(rightMouseDown:), @selector(rightMouseUp:), @selector(rightMouseDragged:),
                             @selector(otherMouseDown:), @selector(otherMouseUp:), @selector(otherMouseDragged:),
                             @selector(mouseEntered:), @selector(mouseExited:)
                     })
                    add(selector, reinterpret_cast<IMP>(+[](id self, SEL, NSEvent* event)
                                                        {
                                                            if (auto* input = owner(self))
                                                                input->pointer(event);
                                                        }));
                add(@selector(scrollWheel:), reinterpret_cast<IMP>(+[](id self, SEL, NSEvent* event)
                                                                   {
                                                                       if (auto* input = owner(self))
                                                                           input->scroll(event);
                                                                   }));
                for (SEL selector : { @selector(keyDown:), @selector(keyUp:) })
                    add(selector, reinterpret_cast<IMP>(+[](id self, SEL, NSEvent* event)
                                                        {
                                                            if (auto* input = owner(self))
                                                                input->key(event);
                                                        }));
                add(@selector(flagsChanged:), reinterpret_cast<IMP>(+[](id self, SEL, NSEvent* event)
                                                                    {
                                                                        if (auto* input = owner(self))
                                                                            input->flags(event);
                                                                    }));
                add(@selector(performKeyEquivalent:),
                    reinterpret_cast<IMP>(+[](id self, SEL, NSEvent* event) -> BOOL
                                          {
                                              auto* input = owner(self);
                                              if (input == nullptr || input->suspended || ! input->focused()
                                                  || event.window != input->view.window || ! input->textFocused)
                                                  return NO;
                                              // Reserve text editing shortcuts for Soundor; leave host menu
                                              // equivalents (Quit, Hide, window switching...) to AppKit.
                                              NSString* name = event.charactersIgnoringModifiers.lowercaseString;
                                              if ((event.modifierFlags & NSEventModifierFlagCommand) == 0
                                                  || name.length != 1 ||
                                                  [@"acvxzy" rangeOfString:name].location == NSNotFound)
                                                  return NO;
                                              input->key(event);
                                              return YES;
                                          }));
                add(@selector(inputContext), reinterpret_cast<IMP>(+[](id self, SEL) -> NSTextInputContext*
                                                                   {
                                                                       auto* input = owner(self);
                                                                       return input != nullptr ? input->inputContext()
                                                                                               : nil;
                                                                   }));
                add(@selector(hasMarkedText), reinterpret_cast<IMP>(+[](id self, SEL) -> BOOL
                                                                    {
                                                                        auto* input = owner(self);
                                                                        return input != nullptr
                                                                               && input->marked.length != 0;
                                                                    }));
                add(@selector(markedRange), reinterpret_cast<IMP>(+[](id self, SEL) -> NSRange
                                                                  {
                                                                      auto* input = owner(self);
                                                                      return input != nullptr
                                                                                     && input->marked.length != 0
                                                                                 ? NSMakeRange(0, input->marked.length)
                                                                                 : NSMakeRange(NSNotFound, 0);
                                                                  }));
                add(@selector(selectedRange), reinterpret_cast<IMP>(+[](id self, SEL) -> NSRange
                                                                    {
                                                                        auto* input = owner(self);
                                                                        return input != nullptr
                                                                                       && input->marked.length != 0
                                                                                   ? input->selection
                                                                                   : NSMakeRange(NSNotFound, 0);
                                                                    }));
                add(@selector(validAttributesForMarkedText),
                    reinterpret_cast<IMP>(+[](id, SEL) -> NSArray* { return @[]; }));
                add(@selector(setMarkedText:selectedRange:replacementRange:),
                    reinterpret_cast<IMP>(
                        +[](id self, SEL, id value, NSRange selected, NSRange replacement)
                        {
                            if (auto* input = owner(self);
                                input != nullptr && input->textFocused && ! input->suspended && input->focused())
                            {
                                NSString* text = plainText(value);
                                if (! input->canReplace(replacement))
                                    return;
                                const NSUInteger offset = replacement.location != NSNotFound ? replacement.location : 0;
                                if (replacement.location != NSNotFound)
                                    input->marked = [input->marked stringByReplacingCharactersInRange:replacement
                                                                                           withString:text];
                                else
                                    input->marked = [text copy];
                                const NSUInteger start = std::min(offset + selected.location, input->marked.length);
                                input->selection =
                                    NSMakeRange(start, std::min(selected.length, input->marked.length - start));
                            }
                        }));
                add(@selector(unmarkText), reinterpret_cast<IMP>(+[](id self, SEL)
                                                                 {
                                                                     if (auto* input = owner(self))
                                                                     {
                                                                         // Unmark accepts the current preedit;
                                                                         // discardComposition() clears it before asking
                                                                         // the context to cancel instead.
                                                                         if (input->textFocused && ! input->suspended
                                                                             && input->focused()
                                                                             && input->marked.length != 0)
                                                                             input->pending.emplace_back(
                                                                                 ui::TextInput { utf8(input->marked) });
                                                                         input->marked = @"";
                                                                         input->selection = NSMakeRange(0, 0);
                                                                     }
                                                                 }));
                add(@selector(insertText:replacementRange:),
                    reinterpret_cast<IMP>(+[](id self, SEL, id value, NSRange replacement)
                                          {
                                              if (auto* input = owner(self); input != nullptr && input->textFocused
                                                                             && ! input->suspended && input->focused())
                                              {
                                                  NSString* text = plainText(value);
                                                  if (! input->canReplace(replacement))
                                                      return;
                                                  if (replacement.location != NSNotFound)
                                                      text =
                                                          [input->marked stringByReplacingCharactersInRange:replacement
                                                                                                 withString:text];
                                                  input->marked = @"";
                                                  input->selection = NSMakeRange(0, 0);
                                                  if (input->handlingKey != nil)
                                                      input->committed =
                                                          [(input->committed != nil ? input->committed : @"")
                                                              stringByAppendingString:text];
                                                  else if (text.length != 0)
                                                      input->pending.emplace_back(ui::TextInput { utf8(text) });
                                              }
                                          }));
                add(@selector(doCommandBySelector:),
                    reinterpret_cast<IMP>(+[](id self, SEL, SEL)
                                          {
                                              if (auto* input = owner(self);
                                                  input != nullptr && input->handlingKey != nil && ! input->commandSent)
                                              {
                                                  input->emitKey(input->handlingKey, true);
                                                  input->commandSent = true;
                                              }
                                          }));
                add(@selector(attributedSubstringForProposedRange:actualRange:),
                    reinterpret_cast<IMP>(+[](id self, SEL, NSRange range, NSRangePointer actual) -> NSAttributedString*
                                          {
                                              auto* input = owner(self);
                                              if (input == nullptr || range.location == NSNotFound
                                                  || range.location >= input->marked.length)
                                              {
                                                  if (actual != nullptr)
                                                      *actual = NSMakeRange(NSNotFound, 0);
                                                  return nil;
                                              }
                                              range.length =
                                                  std::min(range.length, input->marked.length - range.location);
                                              if (actual != nullptr)
                                                  *actual = range;
                                              return [[NSAttributedString alloc]
                                                  initWithString:[input->marked substringWithRange:range]];
                                          }));
                add(@selector(characterIndexForPoint:),
                    reinterpret_cast<IMP>(+[](id, SEL, NSPoint) -> NSUInteger { return NSNotFound; }));
                add(@selector(firstRectForCharacterRange:actualRange:),
                    reinterpret_cast<IMP>(+[](id self, SEL, NSRange, NSRangePointer actual) -> NSRect
                                          {
                                              if (actual != nullptr)
                                                  *actual = NSMakeRange(NSNotFound, 0);
                                              if (auto* input = owner(self))
                                              {
                                                  // No caret rectangle in PlatformInput yet: candidates
                                                  // anchor at the editor's lower edge, never the DAW's origin.
                                                  const NSRect rect = [input->view convertRect:input->view.bounds
                                                                                        toView:nil];
                                                  return [input->view.window convertRectToScreen:rect];
                                              }
                                              return NSZeroRect;
                                          }));
                return platform::apple::makeRuntimeClass("SoundorInputView", [NSView class], methods,
                                                         @protocol(NSTextInputClient));
            }();
            return registered;
        }
    } // namespace

    std::unique_ptr<PlatformInput> createInput(const PlatformOptions& options, std::string* failure)
    {
        if (options.view.handle == nullptr || ! NSThread.isMainThread)
        {
            if (failure != nullptr)
                *failure = "macOS input needs a native NSView on the main thread";
            return nullptr;
        }
        return std::make_unique<MacInput>((__bridge NSView*)options.view.handle);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::apple
