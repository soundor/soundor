#include "../web/WebTestSupport.h"

#include <soundor/debug/Inspector.h>
#include <soundor/render/Compositor.h>

#include <algorithm>
#if SOUNDOR_TEST_GPU
    #include "../gpu/GpuTestSupport.h"
    #include "gpu/OffscreenCompositor.h"
#endif

using namespace soundor;
namespace
{
    using Object = debug::Value::Object;
    using Array = debug::Value::Array;
    const Object& object(const debug::Value& value)
    {
        return std::get<Object>(value.data);
    }
    const Array& array(const debug::Value& value)
    {
        return std::get<Array>(value.data);
    }
    double number(const debug::Value& value)
    {
        return std::get<double>(value.data);
    }
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
    struct Fixture : test::WebFixture
    {
        std::chrono::steady_clock::time_point time = std::chrono::steady_clock::now();
        std::vector<std::string> events;
        debug::Inspector inspector { [this](std::string message) { events.push_back(std::move(message)); },
                                     [this] { return time; } };
        Fixture() { host.surface().setSize({ 40, 30 }); }
        ui::NodeId view()
        {
            auto& surface = host.surface();
            const auto id = surface.createNode(ui::NodeType::View);
            ui::Style style;
            style.width = ui::Length::points(20);
            style.height = ui::Length::points(20);
            surface.setStyle(id, style);
            surface.insertChild(surface.root().id(), id);
            return id;
        }
        void record(bool enabled = true)
        {
            inspector.execute(host, { .method = "Diagnostics.setRecording", .enabled = enabled });
        }
        void advance()
        {
            time += std::chrono::milliseconds(101);
            host.tick();
            inspector.tick(host, 1);
        }
    };
} // namespace
TEST_SUITE("Native DevTools diagnostics")
{
    TEST_CASE("animation inspection uses actual timing, spring and presentation values")
    {
        Fixture f;
        const auto id = f.view();
        double time = 0;
        auto& timeline = f.host.surface().animations();
        timeline.setClock([&] { return time; });
        ui::AnimationDescription description;
        description.properties = ui::propertyBit(ui::AnimatedProperty::Opacity);
        description.from = ui::Presentation {};
        description.to[ui::AnimatedProperty::Opacity] = 0;
        description.timing.duration = 100;
        description.timing.delay = 20;
        const auto animation = timeline.animate(id, description);
        time = 70;
        timeline.tick();
        const auto snapshot = f.inspector.animations(f.host, id);
        REQUIRE(array(snapshot).size() == 1);
        const auto& item = object(array(snapshot).front());
        CHECK(number(item.at("elapsedMs")) == 70);
        CHECK(number(item.at("durationMs")) == 100);
        CHECK(number(item.at("delayMs")) == 20);
        const auto& target = object(array(item.at("targets")).front());
        CHECK(number(object(target.at("presentation")).at("opacity")) == doctest::Approx(0.5));
        timeline.pause(animation);
        CHECK(std::get<std::string>(object(array(f.inspector.animations(f.host)).front()).at("state").data)
              == "paused");
        f.inspector.execute(
            f.host, { .id = "invalid", .method = "Animation.getActive", .generation = 1, .nodeRequested = true });
        CHECK(f.events.back().find("STALE_NODE") != std::string::npos);
        timeline.cancel(animation);
        CHECK(array(f.inspector.animations(f.host)).empty());
        description.spring = ui::SpringParameters {};
        timeline.animate(id, description);
        CHECK(object(array(f.inspector.animations(f.host)).front()).contains("spring"));
    }
    TEST_CASE("replacement, completion, pause, cancellation and deletion notify only subscribed observers")
    {
        Fixture f;
        const auto id = f.view();
        double time = 0;
        auto& timeline = f.host.surface().animations();
        timeline.setClock([&] { return time; });
        ui::AnimationDescription description;
        description.properties = ui::propertyBit(ui::AnimatedProperty::Opacity);
        description.to[ui::AnimatedProperty::Opacity] = 0;
        description.timing.duration = 100;
        const auto first = timeline.animate(id, description);
        bool truncated = false;
        CHECK(timeline.takeDebugChanges(truncated).empty());
        f.inspector.execute(f.host, { .method = "subscribe", .events = { "Animation.changed" } });
        timeline.pause(first);
        timeline.play(first);
        const auto replacement = timeline.animate(id, description);
        time = 101;
        timeline.tick();
        auto changes = timeline.takeDebugChanges(truncated);
        CHECK(changes.size() >= 5);
        CHECK_FALSE(truncated);
        CHECK(std::ranges::any_of(changes, [&](const auto& change)
                                  { return change.id == first && change.state == ui::PlaybackState::Cancelled; }));
        CHECK(std::ranges::any_of(changes, [&](const auto& change)
                                  { return change.id == replacement && change.state == ui::PlaybackState::Finished; }));
        timeline.play(replacement);
        f.host.surface().releaseNode(id);
        changes = timeline.takeDebugChanges(truncated);
        CHECK(std::ranges::any_of(changes,
                                  [](const auto& change) { return change.state == ui::PlaybackState::Cancelled; }));
        CHECK(array(f.inspector.animations(f.host)).empty());
    }
    TEST_CASE("composition targets can be filtered without duplicating animation state")
    {
        Fixture f;
        const auto first = f.view(), second = f.view();
        auto& timeline = f.host.surface().animations();
        ui::AnimationDescription child;
        child.properties = ui::propertyBit(ui::AnimatedProperty::TranslateX);
        child.to[ui::AnimatedProperty::TranslateX] = 20;
        child.to.order[0] = ui::AnimatedProperty::TranslateX;
        child.to.count = 1;
        child.targetNode = second;
        ui::AnimationDescription program;
        program.composition = ui::Composition::Sequence;
        program.children = { child };
        timeline.animate(first, program);
        const auto snapshot = f.inspector.animations(f.host, second);
        REQUIRE(array(snapshot).size() == 1);
        CHECK(std::get<std::string>(object(array(snapshot).front()).at("kind").data) == "composition");
        CHECK(array(f.inspector.animations(f.host, first)).empty());
    }
    TEST_CASE("lifecycle queues and inspection snapshots are bounded")
    {
        Fixture f;
        const auto id = f.view();
        auto& timeline = f.host.surface().animations();
        timeline.debugObserve(true);
        ui::AnimationDescription description;
        description.properties = ui::propertyBit(ui::AnimatedProperty::Opacity);
        description.to[ui::AnimatedProperty::Opacity] = 0;
        for (int index = 0; index < 300; ++index)
            timeline.animate(id, description);
        bool truncated = false;
        CHECK(timeline.takeDebugChanges(truncated).size() == 128);
        CHECK(truncated);
        timeline.debugObserve(false);
        CHECK(timeline.takeDebugChanges(truncated).empty());
        for (int index = 0; index < 300; ++index)
            timeline.animate(f.view(), description);
        const auto snapshot = f.inspector.animations(f.host);
        CHECK(array(snapshot).size() == 256);
        CHECK(std::get<bool>(object(array(snapshot).back()).at("snapshotTruncated").data));
        CHECK(snapshot.json().size() < 900000);
    }
    TEST_CASE("profiling has no raster timers until requested and records actual CPU work")
    {
        Fixture f;
        f.view();
        RasterOutput output;
        render::RasterCompositor compositor(output);
        f.inspector.renderFrame(f.host, compositor, compositor.capabilities());
        CHECK(f.host.surface().debugRasterTime() == 0);
        CHECK(array(object(f.inspector.metrics()).at("frames")).empty());
        f.record();
        f.host.surface().setSize({ 41, 30 });
        f.inspector.renderFrame(f.host, compositor, compositor.capabilities());
        f.advance();
        const auto metrics = f.inspector.metrics();
        const auto& data = object(metrics);
        CHECK(std::get<bool>(data.at("recording").data));
        CHECK(number(data.at("frameCount")) == 1);
        const auto& frame = object(array(data.at("frames")).front());
        CHECK(std::get<std::string>(frame.at("mode").data) == "cpu");
        CHECK(number(frame.at("rasterMs")) > 0);
        CHECK(number(frame.at("frameMs")) >= number(frame.at("compositionMs")));
        CHECK(number(frame.at("layerCount")) > 0);
        CHECK(number(frame.at("layersRasterized")) > 0);
        f.inspector.execute(f.host, { .method = "UI.setPickerEnabled", .enabled = true });
        f.inspector.key(f.host.surface(), { .down = true, .key = "Escape" });
        CHECK(f.inspector.recording());
        f.record(false);
        CHECK_FALSE(f.inspector.recording());
        CHECK_FALSE(f.host.surface().debugRecording());
        CHECK(array(object(f.inspector.metrics()).at("frames")).size() == 1);
        const auto captured = f.host.surface().debugRasterTime();
        f.host.surface().setSize({ 42, 30 });
        f.inspector.renderFrame(f.host, compositor, compositor.capabilities());
        CHECK(f.host.surface().debugRasterTime() == captured);
    }
    TEST_CASE("profiling buffers are bounded and control loss or reload clears recordings")
    {
        Fixture f;
        f.view();
        RasterOutput output;
        render::RasterCompositor compositor(output);
        f.record();
        for (int index = 0; index < 400; ++index)
        {
            f.advance();
            f.inspector.renderFrame(f.host, compositor, compositor.capabilities());
        }
        CHECK(number(object(f.inspector.metrics()).at("frameCount")) == 400);
        CHECK(array(object(f.inspector.metrics()).at("frames")).size() == 300);
        f.inspector.reset(f.host.surface());
        CHECK_FALSE(f.inspector.recording());
        CHECK(array(object(f.inspector.metrics()).at("frames")).empty());
        f.record();
        f.inspector.tick(f.host, 2);
        CHECK_FALSE(f.inspector.recording());
        CHECK(number(object(f.inspector.metrics()).at("generation")) == 2);
        f.inspector.execute(
            f.host, { .id = "old", .method = "Diagnostics.setRecording", .targetGeneration = 1, .enabled = true });
        CHECK_FALSE(f.inspector.recording());
        CHECK(f.events.back().find("STALE_NODE") != std::string::npos);
    }
#if SOUNDOR_TEST_GPU
    TEST_CASE("profiling reports the actual GPU compositor without forcing a readback")
    {
        const auto device = test::testDevice();
        if (! device)
            return;
        Fixture f;
        f.view();
        gpu::OffscreenCompositor compositor(device);
        f.record();
        f.inspector.renderFrame(f.host, compositor, compositor.capabilities());
        const auto snapshot = f.inspector.metrics();
        const auto& frame = object(array(object(snapshot).at("frames")).front());
        CHECK(std::get<std::string>(frame.at("mode").data) == "gpu");
        CHECK(number(frame.at("compositorReadbacks")) == 0);
    }
#endif

    TEST_CASE("one shared recording, which stops when every client that asked for it went")
    {
        Fixture f;
        const auto record = [&](const std::string& client, bool enabled) {
            f.inspector.execute(f.host, { .method = "Diagnostics.setRecording", .client = client, .enabled = enabled });
        };
        record("a", true);
        record("b", true);
        f.inspector.execute(f.host, { .method = "clientGone", .client = "a" });
        CHECK(f.inspector.recording());
        f.inspector.execute(f.host, { .method = "clientGone", .client = "b" });
        CHECK_FALSE(f.inspector.recording());
        // Any client stops it for everyone.
        record("a", true);
        record("b", true);
        record("a", false);
        CHECK_FALSE(f.inspector.recording());
    }
}
