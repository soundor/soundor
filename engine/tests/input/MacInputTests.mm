#include "input/apple/MacInput.h"
#include "platform/apple/RuntimeClass.h"

#import <AppKit/AppKit.h>
#include <doctest/doctest.h>

#include <algorithm>
#include <memory>
#include <vector>

using namespace soundor;

namespace
{
    struct Fixture
    {
        Fixture()
        {
            [NSApplication sharedApplication];
            window = [[NSWindow alloc] initWithContentRect:NSMakeRect(100, 100, 400, 300)
                                                 styleMask:NSWindowStyleMaskTitled
                                                   backing:NSBackingStoreBuffered
                                                     defer:NO];
            window.releasedWhenClosed = NO;
            parent = window.contentView;
            input = input::createPlatformInput({ .view = { (__bridge void*)parent } });
            REQUIRE(input != nullptr);
            input->setGeometry({ .x = 20, .y = 30, .scale = 2, .width = 100, .height = 80 });
            native = parent.subviews.lastObject;
            REQUIRE(native != nil);
        }

        ~Fixture()
        {
            input.reset();
            [window close];
        }
        Fixture(const Fixture&) = delete;
        Fixture& operator=(const Fixture&) = delete;

        NSEvent* mouse(NSEventType type, float x = 10, float y = 20)
        {
            const NSPoint point = [native convertPoint:NSMakePoint(x * 2, y * 2) toView:nil];
            if (type == NSEventTypeMouseEntered || type == NSEventTypeMouseExited)
                return [NSEvent enterExitEventWithType:type
                                              location:point
                                         modifierFlags:NSEventModifierFlagShift
                                             timestamp:1
                                          windowNumber:window.windowNumber
                                               context:nil
                                           eventNumber:0
                                        trackingNumber:0
                                              userData:nullptr];
            return [NSEvent mouseEventWithType:type
                                      location:point
                                 modifierFlags:NSEventModifierFlagShift
                                     timestamp:1
                                  windowNumber:window.windowNumber
                                       context:nil
                                   eventNumber:0
                                    clickCount:2
                                      pressure:0.5];
        }

        NSEvent* key(NSEventType type, NSString* characters, unsigned short code, bool repeat = false,
                     NSEventModifierFlags modifiers = 0)
        {
            return [NSEvent keyEventWithType:type
                                    location:NSZeroPoint
                               modifierFlags:modifiers
                                   timestamp:1
                                windowNumber:window.windowNumber
                                     context:nil
                                  characters:characters
                 charactersIgnoringModifiers:characters
                                   isARepeat:repeat
                                     keyCode:code];
        }

        std::vector<input::Event> read()
        {
            std::vector<input::Event> result;
            input->read(result);
            std::erase_if(result, [](const auto& event) { return std::holds_alternative<input::FocusChange>(event); });
            return result;
        }

        NSWindow* window = nil;
        NSView* parent = nil;
        NSView* native = nil;
        std::unique_ptr<input::PlatformInput> input;
    };

    // Real NSEvent has no public initializer for fractional scroll phases.
    // A plain NSObject with those accessors avoids NSEvent class-cluster
    // allocation while exercising the actual input view's NSResponder path.
    const char scrollDataKey = 0;
    NSEvent* scroll(double x, double y, NSEventPhase phase, NSEventPhase momentum = NSEventPhaseNone)
    {
        static Class eventClass = []
        {
            std::vector<platform::apple::Method> methods;
            const auto add = [&](SEL selector, IMP implementation)
            {
                methods.push_back({ selector, implementation,
                                    method_getTypeEncoding(class_getInstanceMethod([NSEvent class], selector)) });
            };
            add(@selector(scrollingDeltaX), reinterpret_cast<IMP>(+[](id self, SEL) -> CGFloat {
                    return [objc_getAssociatedObject(self, &scrollDataKey)[@"x"] doubleValue];
                }));
            add(@selector(scrollingDeltaY), reinterpret_cast<IMP>(+[](id self, SEL) -> CGFloat {
                    return [objc_getAssociatedObject(self, &scrollDataKey)[@"y"] doubleValue];
                }));
            add(@selector(phase), reinterpret_cast<IMP>(+[](id self, SEL) -> NSEventPhase
                                                        {
                                                            return static_cast<NSEventPhase>([objc_getAssociatedObject(
                                                                self, &scrollDataKey)[@"phase"] unsignedIntegerValue]);
                                                        }));
            add(@selector(momentumPhase),
                reinterpret_cast<IMP>(+[](id self, SEL) -> NSEventPhase
                                      {
                                          return static_cast<NSEventPhase>([objc_getAssociatedObject(
                                              self, &scrollDataKey)[@"momentum"] unsignedIntegerValue]);
                                      }));
            add(@selector(hasPreciseScrollingDeltas), reinterpret_cast<IMP>(+[](id, SEL) -> BOOL { return YES; }));
            add(@selector(modifierFlags), reinterpret_cast<IMP>(+[](id, SEL) -> NSEventModifierFlags { return 0; }));
            add(@selector(locationInWindow),
                reinterpret_cast<IMP>(+[](id, SEL) -> NSPoint { return NSMakePoint(30, 250); }));
            return platform::apple::makeRuntimeClass("SoundorTestScroll", [NSObject class], methods);
        }();
        NSEvent* event = [[eventClass alloc] init];
        objc_setAssociatedObject(
            event, &scrollDataKey,
            @{@"x" : @(x),
              @"y" : @(y),
              @"phase" : @(phase),
              @"momentum" : @(momentum)},
            OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        return event;
    }
} // namespace

TEST_SUITE("native input: AppKit")
{
    TEST_CASE("a transparent input view covers only the editor, in points on either view orientation")
    {
        Fixture f;
        CHECK(f.input->fileDescriptor() == -1);
        CHECK(f.native.flipped);
        CHECK_FALSE(f.native.isOpaque);
        CHECK_FALSE(f.native.isAccessibilityElement);
        CHECK(f.native.frame.origin.x == 20);
        CHECK(f.native.frame.origin.y == 110);
        CHECK(f.native.frame.size.width == 200);
        CHECK(f.native.frame.size.height == 160);
        CHECK([f.parent hitTest:NSMakePoint(30, 250)] == f.native);
        CHECK([f.parent hitTest:NSMakePoint(5, 5)] == f.parent);
        auto nested = input::createPlatformInput({ .view = { (__bridge void*)f.native } });
        REQUIRE(nested != nullptr);
        nested->setGeometry({ .x = 5, .y = 6, .scale = 1, .width = 20, .height = 30 });
        CHECK(f.native.subviews.lastObject.frame.origin.y == 6);
        CHECK(f.native.subviews.lastObject.frame.origin.x == 5);
    }

    TEST_CASE("AppKit movement, entry, dragging, button chording and exit keep their order")
    {
        Fixture f;
        [f.native mouseEntered:f.mouse(NSEventTypeMouseEntered)];
        [f.native mouseDown:f.mouse(NSEventTypeLeftMouseDown)];
        [f.native mouseDragged:f.mouse(NSEventTypeLeftMouseDragged, -4, 90)];
        [f.native rightMouseDown:f.mouse(NSEventTypeRightMouseDown)];
        [f.native mouseUp:f.mouse(NSEventTypeLeftMouseUp)];
        [f.native rightMouseUp:f.mouse(NSEventTypeRightMouseUp)];
        [f.native mouseExited:f.mouse(NSEventTypeMouseExited)];
        const auto events = f.read();
        REQUIRE(events.size() == 7);
        CHECK(std::get<ui::PointerInput>(events[0]).phase == ui::PointerInput::Phase::Move);
        const auto& down = std::get<ui::PointerInput>(events[1]);
        CHECK(down.phase == ui::PointerInput::Phase::Down);
        CHECK(down.clicks == 2);
        CHECK(down.buttons == 1);
        CHECK(down.position.x == 10);
        CHECK(down.position.y == 20);
        CHECK(down.modifiers == ui::Modifier::Shift);
        const auto& drag = std::get<ui::PointerInput>(events[2]);
        CHECK(drag.position.x == -4);
        CHECK(drag.position.y == 90);
        CHECK(drag.phase == ui::PointerInput::Phase::Move);
        CHECK(std::get<ui::PointerInput>(events[3]).buttons == 3);
        CHECK(std::get<ui::PointerInput>(events[4]).buttons == 2);
        CHECK(std::get<ui::PointerInput>(events[4]).phase == ui::PointerInput::Phase::Move);
        CHECK(std::get<ui::PointerInput>(events[5]).phase == ui::PointerInput::Phase::Up);
        CHECK(std::get<ui::PointerInput>(events[6]).phase == ui::PointerInput::Phase::Leave);
        CHECK(f.input->buttons() == 0);
    }

    TEST_CASE("scroll phases and AppKit momentum preserve fractional axes and ordering")
    {
        Fixture f;
        [f.native scrollWheel:scroll(0.125, -0.375, NSEventPhaseBegan)];
        [f.native mouseMoved:f.mouse(NSEventTypeMouseMoved)];
        [f.native scrollWheel:scroll(0, 0, NSEventPhaseEnded)];
        [f.native scrollWheel:scroll(0.0625, -0.125, NSEventPhaseNone, NSEventPhaseBegan)];
        [f.native scrollWheel:scroll(0, 0, NSEventPhaseNone, NSEventPhaseEnded)];
        const auto events = f.read();
        REQUIRE(events.size() == 3);
        const auto& start = std::get<ui::WheelInput>(events[0]);
        CHECK(start.deltaX == doctest::Approx(-0.0625));
        CHECK(start.deltaY == doctest::Approx(0.1875));
        CHECK(std::holds_alternative<ui::PointerInput>(events[1]));
        const auto& momentum = std::get<ui::WheelInput>(events[2]);
        CHECK(momentum.deltaX == doctest::Approx(-0.03125));
        CHECK(momentum.deltaY == doctest::Approx(0.0625));
        CHECK(momentum.position.x == start.position.x);
        CHECK(f.read().empty()); // no synthetic momentum
    }

    TEST_CASE("physical releases keep the press identity across layouts and modifiers; repeats stay downs")
    {
        Fixture f;
        [f.native keyDown:f.key(NSEventTypeKeyDown, @"a", 0)];
        [f.native keyDown:f.key(NSEventTypeKeyDown, @"a", 0, true)];
        [f.native keyUp:f.key(NSEventTypeKeyUp, @"A", 0)];
        const auto events = f.read();
        REQUIRE(events.size() == 3);
        CHECK_FALSE(std::get<input::KeyEvent>(events[0]).key.repeat);
        CHECK(std::get<input::KeyEvent>(events[1]).key.repeat);
        CHECK_FALSE(std::get<input::KeyEvent>(events[2]).key.down);
        CHECK(std::get<input::KeyEvent>(events[2]).key.key == "a");
    }

    TEST_CASE("left and right modifier keys retain independent identities")
    {
        Fixture f;
        [f.native flagsChanged:f.key(NSEventTypeFlagsChanged, @"", 56, false, NSEventModifierFlagShift)];
        [f.native flagsChanged:f.key(NSEventTypeFlagsChanged, @"", 60, false, NSEventModifierFlagShift)];
        [f.native flagsChanged:f.key(NSEventTypeFlagsChanged, @"", 56, false, NSEventModifierFlagShift)];
        [f.native flagsChanged:f.key(NSEventTypeFlagsChanged, @"", 60)];
        const auto events = f.read();
        REQUIRE(events.size() == 4);
        CHECK(std::get<input::KeyEvent>(events[0]).key.down);
        CHECK(std::get<input::KeyEvent>(events[1]).key.down);
        CHECK_FALSE(std::get<input::KeyEvent>(events[2]).key.down);
        CHECK(std::get<input::KeyEvent>(events[2]).key.modifiers == ui::Modifier::Shift);
        CHECK_FALSE(std::get<input::KeyEvent>(events[3]).key.down);
        CHECK(std::get<input::KeyEvent>(events[3]).key.modifiers == 0);
    }

    TEST_CASE("marked text stays in the input client until a Unicode commit")
    {
        Fixture f;
        [f.window makeKeyWindow];
        f.input->requestFocus();
        f.input->setTextInputFocused(true);
        id<NSTextInputClient> client = static_cast<id<NSTextInputClient>>(f.native);
        [client setMarkedText:@"に" selectedRange:NSMakeRange(1, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
        CHECK([client hasMarkedText]);
        CHECK(f.read().empty());
        [client setMarkedText:@"日本語" selectedRange:NSMakeRange(3, 0) replacementRange:NSMakeRange(NSNotFound, 0)];
        CHECK([client markedRange].length == 3);
        [client insertText:@"日本語" replacementRange:NSMakeRange(NSNotFound, 0)];
        CHECK_FALSE([client hasMarkedText]);
        const auto events = f.read();
        REQUIRE(events.size() == 1);
        CHECK(std::get<ui::TextInput>(events[0]).text == "日本語");
        [f.window makeFirstResponder:nil];
        f.read();
        [client insertText:@"late commit after blur" replacementRange:NSMakeRange(NSNotFound, 0)];
        CHECK(f.read().empty());
        f.input->requestFocus();
        f.read();
        // The shared API exposes committed text, not document replacement.
        [client insertText:@"replacement" replacementRange:NSMakeRange(0, 1)];
        CHECK(f.read().empty());
        f.input->setTextInputFocused(false);
        [client insertText:@"ignored" replacementRange:NSMakeRange(NSNotFound, 0)];
        CHECK(f.read().empty());
    }

    TEST_CASE("suspension cancels held input once, bypasses hit testing and resumes")
    {
        Fixture f;
        [f.native mouseDown:f.mouse(NSEventTypeLeftMouseDown)];
        [f.native keyDown:f.key(NSEventTypeKeyDown, @"a", 0)];
        f.read();
        std::vector<input::Event> ended;
        f.input->setSuspended(true, ended);
        REQUIRE(ended.size() >= 2);
        CHECK(std::get<ui::PointerInput>(ended[0]).phase == ui::PointerInput::Phase::Cancel);
        CHECK_FALSE(std::get<input::KeyEvent>(ended[1]).key.down);
        CHECK(f.native.hidden);
        CHECK([f.parent hitTest:NSMakePoint(30, 250)] == f.parent);
        ended.clear();
        f.input->setSuspended(true, ended);
        CHECK(ended.empty());
        [f.native mouseDown:f.mouse(NSEventTypeLeftMouseDown)];
        [f.native keyDown:f.key(NSEventTypeKeyDown, @"b", 11)];
        CHECK(f.read().empty());
        f.input->setSuspended(false, ended);
        [f.native mouseDown:f.mouse(NSEventTypeLeftMouseDown)];
        const auto events = f.read();
        REQUIRE(events.size() == 1);
        CHECK(std::get<ui::PointerInput>(events[0]).phase == ui::PointerInput::Phase::Down);
    }

    TEST_CASE("native focus loss releases keys and captured pointer before notifying the surface")
    {
        Fixture f;
        [f.window makeKeyWindow];
        f.input->requestFocus();
        std::vector<input::Event> events;
        f.input->read(events);
        REQUIRE(f.input->focused());
        REQUIRE(f.window.firstResponder == f.native);
        [f.native mouseDown:f.mouse(NSEventTypeLeftMouseDown)];
        [f.native keyDown:f.key(NSEventTypeKeyDown, @"a", 0)];
        f.read();
        [f.window makeFirstResponder:nil];
        events.clear();
        f.input->read(events);
        REQUIRE(events.size() == 3);
        CHECK(std::get<ui::PointerInput>(events[0]).phase == ui::PointerInput::Phase::Cancel);
        CHECK_FALSE(std::get<input::KeyEvent>(events[1]).key.down);
        CHECK_FALSE(std::get<input::FocusChange>(events[2]).focused);
        CHECK_FALSE(f.input->focused());
        events.clear();
        f.input->cancel(events);
        CHECK(events.empty());
        f.input->requestFocus();
        CHECK(f.input->focused());
    }

    TEST_CASE("teardown releases the child view when nobody else retains it")
    {
        Fixture f;
        __weak NSView* weakView = f.native;
        @autoreleasepool
        {
            f.input.reset();
            f.native = nil;
        }
        CHECK(weakView == nil);
    }

    TEST_CASE(
        "two editors share one class but keep their queues independent; retained callbacks are inert after destruction")
    {
        Fixture first;
        Fixture second;
        CHECK(object_getClass(first.native) == object_getClass(second.native));
        CHECK(std::string(object_getClassName(first.native)).starts_with("SoundorInputView_"));
        [first.native keyDown:first.key(NSEventTypeKeyDown, @"a", 0)];
        CHECK(second.read().empty());
        REQUIRE(first.read().size() == 1);
        NSView* retained = first.native;
        first.input->setTextInputFocused(true);
        NSTextInputContext* retainedContext = retained.inputContext;
        first.input.reset();
        CHECK(retained.superview == nil);
        CHECK(retained.trackingAreas.count == 0);
        CHECK_FALSE(retained.acceptsFirstResponder);
        CHECK(retained.inputContext == nil);
        [retained keyDown:first.key(NSEventTypeKeyDown, @"a", 0)];
        [static_cast<id<NSTextInputClient>>(retained) insertText:@"late" replacementRange:NSMakeRange(NSNotFound, 0)];
        [retainedContext discardMarkedText];
        CHECK(second.read().empty());
        first.input = input::createPlatformInput({ .view = { (__bridge void*)first.parent } });
        REQUIRE(first.input != nullptr);
        CHECK(object_getClass(first.parent.subviews.lastObject) == object_getClass(retained));
    }
}
