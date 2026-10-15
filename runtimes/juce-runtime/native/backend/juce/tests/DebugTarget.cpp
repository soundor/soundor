#include <soundor/backend/JuceDebugBridge.h>
#include <soundor/render/Compositor.h>

#include <juce_core/juce_core.h>

#include <chrono>
#include <iostream>
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
} // namespace
// A real headless native engine, solely for protocol integration tests. Pointer
// input is generated locally here; no automation method is added to the wire.
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
        return host;
    };
    auto host = makeHost();
    RasterOutput output;
    render::RasterCompositor compositor(output);
    int events = 0;
    host->surface().setEventSink(
        [&](const ui::Event&)
        {
            ++events;
            return false;
        });
    auto bridge = std::make_unique<backend::JuceDebugBridge>(
        juce::SystemStats::getEnvironmentVariable("SOUNDOR_DEVTOOLS_SESSION", {}).toStdString(), "Native Bridge Test",
        [](js::LogLevel, std::string_view message) { std::cerr << message << std::endl; });
    std::cout << "READY native target" << std::endl;
    unsigned generation = 1;
    ui::NodeId lastHighlight = ui::noNode;
    bool picked = false;
    const auto started = std::chrono::steady_clock::now();
    while (std::chrono::steady_clock::now() - started < std::chrono::seconds(12))
    {
        if (generation == 1 && std::chrono::steady_clock::now() - started > std::chrono::seconds(4))
        {
            host.reset();
            host = makeHost();
            generation = 2;
            host->surface().setEventSink(
                [&](const ui::Event&)
                {
                    ++events;
                    return false;
                });
        }
        host->tick();
        bridge->tick(*host, generation);
        if (bridge->picking() && ! picked)
        {
            bridge->pointer(*host, { .phase = ui::PointerInput::Phase::Move, .position = { 10, 10 } });
            bridge->pointer(
                *host, { .phase = ui::PointerInput::Phase::Down, .position = { 10, 10 }, .button = 0, .buttons = 1 });
            bridge->pointer(*host, { .phase = ui::PointerInput::Phase::Up, .position = { 10, 10 }, .button = 0 });
            picked = true;
            std::cout << "PICKED applicationEvents=" << events << std::endl;
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
