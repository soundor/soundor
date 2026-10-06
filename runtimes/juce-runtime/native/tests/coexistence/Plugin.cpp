// A stand-in for one Soundor plugin binary in the coexistence test: the whole
// runtime under its own ABI namespace, a UI that draws a color of its own and
// counts clicks, behind a small C entry point table.

#include <soundor/a11y/Platform.h>
#include <soundor/runtime/RuntimeHost.h>

#include <cstdint>
#include <memory>
#include <string>
#include <vector>

#if defined(_WIN32)
    #define SOUNDOR_COEXIST_EXPORT extern "C" __declspec(dllexport)
#else
    #define SOUNDOR_COEXIST_EXPORT extern "C" __attribute__((visibility("default")))
#endif

namespace
{
    constexpr int size = 64;

    struct Instance
    {
        Instance()
        {
            host.surface().setSize({ size, size });
            const std::string ui = std::string("const COLOR = '") + SOUNDOR_COEXIST_COLOR + "';\n" + R"(
                import { root, createView } from 'soundor:ui';
                globalThis.count = 0;
                const box = createView({ width: 64, height: 64, backgroundColor: COLOR });
                box.addEventListener('click', () => { globalThis.count += 1; });
                root.appendChild(box);
            )";
            ok = host.context().evaluateModule(ui, "/coexist.js").ok();
        }

        soundor::RuntimeHost host { {} };
        // Each plugin's own platform accessibility (AccessKit on Linux and
        // Windows), side by side in one process.
        std::unique_ptr<soundor::a11y::PlatformAccessibility> accessibility =
            soundor::a11y::createPlatformAccessibility({ {}, SOUNDOR_COEXIST_COLOR });
        std::vector<std::uint32_t> pixels = std::vector<std::uint32_t>(std::size_t { size } * size);
        bool ok = false;
    };

    soundor::ui::PointerInput press(soundor::ui::PointerInput::Phase phase, unsigned buttons)
    {
        soundor::ui::PointerInput input;
        input.phase = phase;
        input.position = { 10, 10 };
        input.button = 0;
        input.buttons = buttons;
        return input;
    }
} // namespace

SOUNDOR_COEXIST_EXPORT void* soundor_coexist_create()
{
    auto* instance = new Instance();
    if (instance->ok)
        return instance;
    delete instance;
    return nullptr;
}

// Clicks the instance's view; returns its click count.
SOUNDOR_COEXIST_EXPORT int soundor_coexist_click(void* handle)
{
    auto& instance = *static_cast<Instance*>(handle);
    instance.host.surface().pointer(press(soundor::ui::PointerInput::Phase::Down, 1));
    instance.host.surface().pointer(press(soundor::ui::PointerInput::Phase::Up, 0));
    instance.host.tick();
    if (instance.accessibility != nullptr)
        instance.accessibility->tick(instance.host);
    auto count = instance.host.context().evaluateScript("count");
    return count ? static_cast<int>(count.value().asNumber()) : -1;
}

// Renders the instance; returns the pixel in the middle (0xAARRGGBB).
SOUNDOR_COEXIST_EXPORT std::uint32_t soundor_coexist_pixel(void* handle)
{
    auto& instance = *static_cast<Instance*>(handle);
    instance.host.tick();
    instance.host.render({ instance.pixels.data(), size, size, std::size_t { size } * 4 });
    return instance.pixels[(std::size_t { size } * size / 2) + (size / 2)];
}

SOUNDOR_COEXIST_EXPORT void soundor_coexist_destroy(void* handle)
{
    delete static_cast<Instance*>(handle);
}
