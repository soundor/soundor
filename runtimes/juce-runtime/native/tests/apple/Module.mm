// One Soundor plugin binary with the macOS accessibility bridge, for the
// Apple coexistence test (AppleHost.mm): a view, a button, and entry points
// to look at the bridge from outside.

#include "a11y/apple/MacPlatform.h"

#include <soundor/a11y/Platform.h>
#include <soundor/runtime/RuntimeHost.h>

#import <AppKit/AppKit.h>
#include <objc/runtime.h>

#include <memory>
#include <string>

#define SOUNDOR_MODULE_EXPORT extern "C" __attribute__((visibility("default")))

namespace
{
    struct Instance
    {
        Instance()
        {
            host.surface().setSize({ 64, 64 });
            ok = host.context()
                     .evaluateModule(R"(
                        import { root, createView, createText, pressable } from 'soundor:ui';
                        globalThis.presses = 0;
                        const button = createView({ width: 64, height: 64 });
                        button.accessibility = { role: 'button', actions: [{ name: 'activate' }] };
                        button.appendChild(createText('Press'));
                        pressable(button, { onPress: () => { globalThis.presses += 1; } });
                        root.appendChild(button);
                     )",
                                     "/module.js")
                     .ok();
            view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 64, 64)];
            accessibility = soundor::a11y::createPlatformAccessibility({ { (__bridge void*)view, nullptr }, "M" });
            tick();
        }

        void tick()
        {
            host.tick();
            accessibility->tick(host);
        }

        NSAccessibilityElement* button() const
        {
            auto* container = (__bridge NSAccessibilityElement*)accessibility->accessibilityContainer();
            NSArray* children = [container accessibilityChildren];
            return [children count] > 0 ? children[0] : nil;
        }

        soundor::RuntimeHost host { {} };
        NSView* view = nil;
        std::unique_ptr<soundor::a11y::PlatformAccessibility> accessibility;
        bool ok = false;
    };

    std::string className;
} // namespace

SOUNDOR_MODULE_EXPORT void* soundor_apple_create()
{
    soundor::a11y::detail::forceMacAccessibility(true);
    auto* instance = new Instance();
    if (instance->ok && instance->button() != nil)
        return instance;
    delete instance;
    return nullptr;
}

// The Objective-C class of the instance's elements.
SOUNDOR_MODULE_EXPORT const char* soundor_apple_class(void* handle)
{
    className = object_getClassName(static_cast<Instance*>(handle)->button());
    return className.c_str();
}

// Presses the button as VoiceOver does; returns the presses plugin code saw.
SOUNDOR_MODULE_EXPORT int soundor_apple_press(void* handle)
{
    auto& instance = *static_cast<Instance*>(handle);
    if (! [instance.button() accessibilityPerformPress])
        return -1;
    instance.tick();
    auto presses = instance.host.context().evaluateScript("presses");
    return presses ? static_cast<int>(presses.value().asNumber()) : -1;
}

// The button element, retained for the caller (as VoiceOver would keep it).
SOUNDOR_MODULE_EXPORT void* soundor_apple_retain_element(void* handle)
{
    return (__bridge_retained void*)static_cast<Instance*>(handle)->button();
}

SOUNDOR_MODULE_EXPORT void soundor_apple_destroy(void* handle)
{
    delete static_cast<Instance*>(handle);
}
