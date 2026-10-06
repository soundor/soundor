// Soundor's macOS bridge, through what VoiceOver uses: the NSAccessibility
// protocol of the elements it puts in the view.

#include "../web/WebTestSupport.h"
#include "a11y/apple/MacPlatform.h"

#include <soundor/a11y/Platform.h>

#import <AppKit/AppKit.h>
#include <objc/runtime.h>

#include <memory>
#include <string>

using namespace soundor;
using test::WebFixture;

namespace
{
    RuntimeHost::Options approximateText()
    {
        RuntimeHost::Options options;
        options.textEngine = ui::approximateTextEngine();
        return options;
    }

    std::string text(id value)
    {
        return [value isKindOfClass:[NSString class]] ? std::string([static_cast<NSString*>(value) UTF8String]) : "";
    }

    struct MacFixture : WebFixture
    {
        MacFixture() : WebFixture(approximateText())
        {
            host.surface().setSize({ 200, 100 });
            a11y::detail::forceMacAccessibility(true);
            view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 200, 100)];
            platform = a11y::createPlatformAccessibility({ { (__bridge void*)view, nullptr }, "Test" });
            REQUIRE(platform != nullptr);
            platform->setGeometry({ 0, 0, 1, {} });
        }

        ~MacFixture()
        {
            platform.reset();
            a11y::detail::forceMacAccessibility(false);
        }

        MacFixture(const MacFixture&) = delete;
        MacFixture& operator=(const MacFixture&) = delete;

        void build(const std::string& body)
        {
            run("import { root, overlayRoot, createView, createText, createTextInput, pressable } from 'soundor:ui';\n"
                + body);
            tick();
        }

        void tick()
        {
            host.tick();
            platform->tick(host);
        }

        NSArray* top() const
        {
            auto* container = (__bridge NSAccessibilityElement*)platform->accessibilityContainer();
            return [container accessibilityChildren];
        }

        // The element labelled `label` (or, for text, reading it), at any depth.
        NSAccessibilityElement* find(const std::string& label) const { return find(top(), label); }

        static NSAccessibilityElement* find(NSArray* elements, const std::string& label)
        {
            for (NSAccessibilityElement* element in elements)
            {
                if (text([element accessibilityLabel]) == label
                    || ([[element accessibilityRole] isEqualToString:NSAccessibilityStaticTextRole]
                        && text([element accessibilityValue]) == label))
                    return element;
                if (NSAccessibilityElement* found = find([element accessibilityChildren], label))
                    return found;
            }
            return nil;
        }

        NSView* view = nil;
        std::unique_ptr<a11y::PlatformAccessibility> platform;
    };

    constexpr const char* controls = R"(
        globalThis.log = [];
        globalThis.gain = -3.5;
        globalThis.knob = createView({ width: 30, height: 40, marginLeft: 10, marginTop: 20 });
        globalThis.describe = () => {
            knob.accessibility = {
                role: 'adjustable', label: 'Gain', hint: 'Drag', value: { min: -60, max: 12, now: gain, text: gain + ' dB' },
                actions: [{ name: 'increment' }, { name: 'decrement' }, { name: 'reset', label: 'Reset gain' }],
            };
        };
        describe();
        knob.addEventListener('accessibilityaction', (event) => {
            log.push(event.actionName);
            if (event.actionName === 'increment') gain += 0.5;
            if (event.actionName === 'decrement') gain -= 0.5;
            describe();
            event.preventDefault();
        });
        root.appendChild(knob);

        const button = createView();
        button.accessibility = { role: 'button', actions: [{ name: 'activate' }] };
        button.appendChild(createText('Reset'));
        pressable(button, { onPress: () => log.push('press') });
        root.appendChild(button);

        const sync = createView();
        sync.accessibility = { role: 'checkbox', label: 'Sync', state: { checked: true } };
        root.appendChild(sync);
        const bypass = createView();
        bypass.accessibility = { role: 'switch', label: 'Bypass', state: { checked: false, disabled: true } };
        root.appendChild(bypass);

        root.appendChild(createText('Plain text'));
        globalThis.input = createTextInput({ value: 'Init', placeholder: 'Preset name' });
        input.accessibility = { label: 'Preset' };
        root.appendChild(input);
    )";
} // namespace

TEST_SUITE("a11y macOS bridge")
{
    TEST_CASE("presents roles, labels, values and states as VoiceOver reads them")
    {
        MacFixture f;
        f.build(controls);
        CHECK([f.top() count] == 6);

        NSAccessibilityElement* knob = f.find("Gain");
        REQUIRE(knob != nil);
        CHECK([[knob accessibilityRole] isEqualToString:NSAccessibilitySliderRole]);
        CHECK([[knob accessibilityValue] doubleValue] == -3.5);
        CHECK(text([knob accessibilityValueDescription]) == "-3.5 dB");
        CHECK([[knob accessibilityMinValue] doubleValue] == -60);
        CHECK([[knob accessibilityMaxValue] doubleValue] == 12);
        CHECK(text([knob accessibilityHelp]) == "Drag");
        CHECK([knob isAccessibilityElement]);

        NSAccessibilityElement* button = f.find("Reset");
        REQUIRE(button != nil);
        CHECK([[button accessibilityRole] isEqualToString:NSAccessibilityButtonRole]);
        CHECK([[button accessibilityChildren] count] == 0); // its text is its label

        NSAccessibilityElement* sync = f.find("Sync");
        CHECK([[sync accessibilityRole] isEqualToString:NSAccessibilityCheckBoxRole]);
        CHECK([[sync accessibilityValue] intValue] == 1);
        NSAccessibilityElement* bypass = f.find("Bypass");
        CHECK([[bypass accessibilitySubrole] isEqualToString:NSAccessibilitySwitchSubrole]);
        CHECK([[bypass accessibilityValue] intValue] == 0);
        CHECK_FALSE([bypass isAccessibilityEnabled]);

        NSAccessibilityElement* plain = f.find("Plain text");
        CHECK([[plain accessibilityRole] isEqualToString:NSAccessibilityStaticTextRole]);

        NSAccessibilityElement* input = f.find("Preset");
        CHECK([[input accessibilityRole] isEqualToString:NSAccessibilityTextFieldRole]);
        CHECK(text([input accessibilityValue]) == "Init");
        CHECK(text([input accessibilityPlaceholderValue]) == "Preset name");
    }

    TEST_CASE("its elements are of one class made at runtime, under a name of this binary")
    {
        MacFixture f;
        f.build(controls);
        NSAccessibilityElement* knob = f.find("Gain");
        const std::string name = object_getClassName(knob);
        CHECK(name == a11y::detail::macElementClassName());
        CHECK(name.rfind(std::string("SoundorAXElement_") + "v0_", 0) == 0);
        CHECK(name.size() > std::string("SoundorAXElement_v0_").size() + 16);
        CHECK(class_getSuperclass(object_getClass(knob)) == [NSAccessibilityElement class]);
        // No class under the bare name.
        CHECK(objc_getClass("SoundorAXElement") == nil);
        // The container is the system's own class.
        CHECK([(__bridge id)f.platform->accessibilityContainer() class] == [NSAccessibilityElement class]);
    }

    TEST_CASE("VoiceOver's actions reach plugin code on the next tick, if the element offers them")
    {
        MacFixture f;
        f.build(controls);
        NSAccessibilityElement* knob = f.find("Gain");
        NSAccessibilityElement* button = f.find("Reset");
        CHECK([knob isAccessibilitySelectorAllowed:@selector(accessibilityPerformIncrement)]);
        CHECK_FALSE([knob isAccessibilitySelectorAllowed:@selector(accessibilityPerformPress)]);
        CHECK([button isAccessibilitySelectorAllowed:@selector(accessibilityPerformPress)]);
        CHECK([knob isAccessibilitySelectorAllowed:@selector(accessibilityLabel)]);

        CHECK([knob accessibilityPerformIncrement]);
        CHECK([button accessibilityPerformPress]);
        CHECK_FALSE([knob accessibilityPerformPress]);
        CHECK(f.eval("log.length").asNumber() == 0);
        f.tick();
        CHECK(f.eval("log.join(' ')").asString() == "increment press");

        // The change comes back on the following tick.
        f.tick();
        CHECK([[knob accessibilityValue] doubleValue] == -3);
        CHECK(text([knob accessibilityValueDescription]) == "-3 dB");

        // Custom actions, by their label.
        NSArray<NSAccessibilityCustomAction*>* custom = [knob accessibilityCustomActions];
        REQUIRE([custom count] == 1);
        CHECK(text([custom[0] name]) == "Reset gain");
        CHECK([custom[0] handler]());
        f.tick();
        CHECK(f.eval("log.at(-1)").asString() == "reset");
    }

    TEST_CASE("setting a text input's value asks plugin code to")
    {
        MacFixture f;
        f.build(controls);
        NSAccessibilityElement* input = f.find("Preset");
        [input setAccessibilityValue:@"Lead"];
        // Not shown until the input has it.
        CHECK(text([input accessibilityValue]) == "Init");
        f.tick();
        CHECK(f.eval("input.value").asString() == "Lead");
        f.tick();
        CHECK(text([input accessibilityValue]) == "Lead");
    }

    TEST_CASE("elements that have gone, or whose bridge has, do nothing")
    {
        MacFixture f;
        f.build(controls);
        NSAccessibilityElement* knob = f.find("Gain");
        f.run("knob.remove();");
        f.tick();
        CHECK(f.find("Gain") == nil);
        // Queued, but refused: the node is gone.
        [knob accessibilityPerformIncrement];
        f.tick();
        CHECK(f.eval("log.length").asNumber() == 0);

        // Kept by VoiceOver after the bridge is destroyed: refused.
        NSAccessibilityElement* button = f.find("Reset");
        NSAccessibilityCustomAction* reset = [f.find("Sync") accessibilityCustomActions].firstObject;
        f.platform.reset();
        CHECK_FALSE([button accessibilityPerformPress]);
        CHECK(reset == nil);
    }

    TEST_CASE("only the active modal is presented")
    {
        MacFixture f;
        f.build(R"(
            root.appendChild(createText('Background'));
            const dialog = createView();
            dialog.accessibility = { modal: true, label: 'Settings' };
            dialog.appendChild(createText('Inside'));
            overlayRoot.appendChild(dialog);
            globalThis.dialog = dialog;
        )");
        REQUIRE([f.top() count] == 1);
        NSAccessibilityElement* dialog = f.top()[0];
        CHECK([[dialog accessibilitySubrole] isEqualToString:NSAccessibilityDialogSubrole]);
        CHECK([dialog isAccessibilityModal]);
        CHECK(f.find("Background") == nil);
        CHECK(f.find("Inside") != nil);
        f.run("dialog.remove();");
        f.tick();
        CHECK(f.find("Background") != nil);
    }

    TEST_CASE("nothing is presented while no assistive technology is on")
    {
        MacFixture f;
        a11y::detail::forceMacAccessibility(false);
        f.build(controls);
        // A machine running the tests with VoiceOver on would present it.
        if (! f.platform->active())
            CHECK([f.top() count] == 0);
        a11y::detail::forceMacAccessibility(true);
        f.tick();
        CHECK([f.top() count] == 6);
    }

    TEST_CASE("frames are on the screen, wherever the window is")
    {
        MacFixture f;
        NSWindow* window = [[NSWindow alloc] initWithContentRect:NSMakeRect(100, 100, 200, 100)
                                                       styleMask:NSWindowStyleMaskBorderless
                                                         backing:NSBackingStoreBuffered
                                                           defer:YES];
        [window setReleasedWhenClosed:NO];
        [window setContentView:f.view];
        f.build(controls);
        // (10, 20, 30, 40) in the view, which is not flipped: 40 up from its bottom.
        CHECK(NSEqualRects([f.find("Gain") accessibilityFrame], NSMakeRect(110, 140, 30, 40)));
        [window setFrameOrigin:NSMakePoint(300, 200)];
        f.tick();
        const NSRect content = [window contentRectForFrameRect:[window frame]];
        CHECK(NSEqualRects([f.find("Gain") accessibilityFrame],
                           NSMakeRect(content.origin.x + 10, content.origin.y + 40, 30, 40)));
        [window setContentView:[[NSView alloc] init]];
    }
}
