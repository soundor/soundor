#include "support/Modules.h"

#include <soundor/backend/JuceDebugBridge.h>
#include <soundor/render/Compositor.h>

#include <juce_core/juce_core.h>

#include <chrono>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

using namespace soundor;

namespace
{
    struct RasterOutput final : render::RasterTarget
    {
        render::RasterSurface pixels;
        Pixels acquire(int width, int height) override
        {
            const bool changed = pixels.resize(width, height);
            return { pixels.bitmap(), ! changed };
        }
        void present(const render::Region&) override {}
    };

    // The application's own JavaScript: a "reset" button whose listeners
    // count what reaches them through soundor:ui's normal dispatch.
    constexpr const char* application = R"(
        import { root, createView } from 'soundor:ui';
        globalThis.events = 0;
        globalThis.clicks = 0;
        globalThis.cancels = 0;
        const reset = createView({ position: 'absolute', left: 60, top: 0, width: 40, height: 30 });
        reset.debugId = 'reset';
        reset.accessibility = { role: 'button', label: 'Reset' };
        reset.focusable = true;
        for (const type of ['pointerdown', 'pointerup'])
            reset.addEventListener(type, () => { globalThis.events++; });
        reset.addEventListener('pointercancel', () => { globalThis.cancels++; });
        reset.addEventListener('click', () => { globalThis.events++; globalThis.clicks++; });
        root.appendChild(reset);
    )";
    double counter(RuntimeHost& host, const char* name)
    {
        const auto value = host.context().evaluateScript(std::string("globalThis.") + name);
        return value.ok() ? value.value().asNumber() : -1;
    }
} // namespace
// A real headless native engine, solely for protocol integration tests. The
// picker's pointer input is generated locally here; Soundor Driver's comes
// over the wire, through the engine's input dispatch to the application.
int main()
{
    std::cout << "START native target" << std::endl;
    const auto makeHost = []
    {
        auto host = std::make_unique<RuntimeHost>(RuntimeHost::Options {});
        auto& surface = host->surface();
        surface.setSize({ 120, 100 });
        const auto control = surface.createNode(ui::NodeType::View);
        ui::Style style;
        style.width = ui::Length::points(40);
        style.height = ui::Length::points(30);
        surface.setStyle(control, style);
        surface.insertChild(surface.root().id(), control);
        a11y::Properties properties;
        properties.role = a11y::Role::Adjustable;
        properties.label = "Gain";
        properties.value.now = 0.5;
        surface.setAccessibility(control, properties);
        const auto canvas = surface.createNode(ui::NodeType::Canvas);
        surface.setCanvasSize(canvas, 20, 20);
        surface.insertChild(control, canvas);
        ui::AnimationDescription animation;
        animation.properties = ui::propertyBit(ui::AnimatedProperty::Opacity);
        animation.from = ui::Presentation {};
        animation.to[ui::AnimatedProperty::Opacity] = 0.5f;
        animation.timing.duration = 1000;
        animation.timing.iterations = std::numeric_limits<double>::infinity();
        surface.animations().animate(control, animation);
        if (! host->context().evaluateModule(test::module(application), "/application.js").ok())
            throw std::runtime_error("The application did not start");
        return host;
    };
    auto host = makeHost();
    RasterOutput output;
    render::RasterCompositor compositor(output);
    auto bridge = std::make_unique<backend::JuceDebugBridge>(
        juce::SystemStats::getEnvironmentVariable("SOUNDOR_DEVTOOLS_SESSION", {}).toStdString(), "Native Bridge Test",
        [](js::LogLevel, std::string_view message) { std::cerr << message << std::endl; });
    std::cout << "READY native target" << std::endl;
    unsigned generation = 1;
    ui::NodeId lastHighlight = ui::noNode;
    bool picked = false;
    double clicks = 0;
    double cancels = 0;
    const auto started = std::chrono::steady_clock::now();
    while (std::chrono::steady_clock::now() - started < std::chrono::seconds(20))
    {
        if (generation == 1 && std::chrono::steady_clock::now() - started > std::chrono::seconds(4))
        {
            host.reset();
            host = makeHost();
            generation = 2;
            clicks = 0;
            cancels = 0;
        }
        host->tick();
        bridge->tick(*host, generation);
        if (bridge->picking() && ! picked)
        {
            // On the application's button: the picker must keep it all.
            bridge->pointer(*host, { .phase = ui::PointerInput::Phase::Move, .position = { 70, 10 } });
            bridge->pointer(
                *host, { .phase = ui::PointerInput::Phase::Down, .position = { 70, 10 }, .button = 0, .buttons = 1 });
            bridge->pointer(*host, { .phase = ui::PointerInput::Phase::Up, .position = { 70, 10 }, .button = 0 });
            picked = true;
            std::cout << "PICKED applicationEvents=" << counter(*host, "events") << std::endl;
        }
        if (const auto now = counter(*host, "clicks"); now != clicks)
        {
            clicks = now;
            std::cout << "CLICKED generation=" << generation << " clicks=" << clicks << std::endl;
        }
        if (const auto now = counter(*host, "cancels"); now != cancels)
        {
            cancels = now;
            std::cout << "CANCELLED generation=" << generation << " cancels=" << cancels << std::endl;
        }
        const auto highlight = host->surface().debugHighlight();
        if (highlight != lastHighlight)
        {
            std::cout << "STATE generation=" << generation << " highlight=" << highlight
                      << " picking=" << bridge->picking() << std::endl;
            lastHighlight = highlight;
        }
        if (host->needsRender())
        {
            if (bridge->recording())
                bridge->renderFrame(*host, compositor, compositor.capabilities());
            else
                compositor.composite(host->frame(compositor.capabilities()));
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    const auto teardown = std::chrono::steady_clock::now();
    bridge.reset();
    return std::chrono::steady_clock::now() - teardown < std::chrono::seconds(1) ? 0 : 2;
}
