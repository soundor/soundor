#include "../web/WebTestSupport.h"

#include <soundor/debug/Inspector.h>

#include <algorithm>
#include <chrono>
#include <limits>
#include <string>
#include <vector>
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
    double number(const debug::Value& value)
    {
        return std::get<double>(value.data);
    }
    struct Fixture : test::WebFixture
    {
        std::vector<std::string> messages;
        debug::Inspector inspector { [this](std::string message) { messages.push_back(std::move(message)); } };
        Fixture() { host.surface().setSize({ 120, 100 }); }
        ui::NodeId view(float width = 40, float height = 30, ui::NodeId parent = ui::noNode)
        {
            auto& surface = host.surface();
            const auto id = surface.createNode(ui::NodeType::View);
            ui::Style style;
            style.width = ui::Length::points(width);
            style.height = ui::Length::points(height);
            surface.setStyle(id, style);
            surface.insertChild(parent == ui::noNode ? surface.root().id() : parent, id);
            return id;
        }
        void picker() { inspector.execute(host, { .method = "UI.setPickerEnabled", .enabled = true }); }
        bool input(ui::PointerInput::Phase phase, float x = 10, float y = 10, unsigned buttons = 0)
        {
            const ui::PointerInput input { .phase = phase, .position = { x, y }, .button = 0, .buttons = buttons };
            if (inspector.pointer(host.surface(), input))
                return true;
            return host.surface().pointer(input);
        }
        void subscribe()
        {
            inspector.execute(
                host, { .method = "subscribe", .events = { "UI.nodeSelected", "UI.pickerChanged", "UI.treeChanged" } });
        }
    };
} // namespace

TEST_SUITE("Native DevTools inspector")
{
    TEST_CASE("numbers are JSON that reads back exactly, in the shortest form")
    {
        CHECK(debug::Value(0.5).json() == "0.5");
        CHECK(debug::Value(0.1).json() == "0.1");
        CHECK(debug::Value(3.0).json() == "3");
        CHECK(debug::Value(-1e21).json() == "-1e+21");
        CHECK(debug::Value(std::numeric_limits<double>::infinity()).json() == "null");
        for (const double value : { 1.0 / 3.0, 2.0 / 3.0, 0.1 + 0.2, 123456.789e-30 })
            CHECK(std::stod(debug::Value(value).json()) == value);
    }

    TEST_CASE("real tree snapshots and details include layout, presentation and accessibility")
    {
        Fixture f;
        const auto parent = f.view();
        const auto child = f.view(20, 15, parent);
        auto& surface = f.host.surface();
        surface.setFocusable(child, true);
        surface.focus(child);
        a11y::Properties properties;
        properties.role = a11y::Role::Adjustable;
        properties.label = "Gain";
        properties.value.now = 0.5;
        surface.setAccessibility(child, properties);
        const auto tree = f.inspector.tree(f.host);
        CHECK(std::get<Array>(object(tree).at("nodes").data).size() == 4);
        const auto details = f.inspector.node(f.host, child);
        CHECK(std::get<std::string>(object(details).at("parent").data) == std::to_string(parent));
        CHECK(number(object(object(details).at("bounds")).at("width")) == 20);
        CHECK(std::get<bool>(object(details).at("focused").data));
        const auto& a11y = object(object(details).at("accessibility"));
        CHECK(std::get<std::string>(a11y.at("role").data) == "adjustable");
        CHECK(std::get<std::string>(a11y.at("name").data) == "Gain");
        CHECK(number(object(a11y.at("value")).at("now")) == 0.5);
        // Inspector reads do not swallow the platform adapter's updates.
        const auto update = f.host.accessibility().update();
        CHECK(update.full);
        CHECK_FALSE(update.nodes.empty());
        const auto parsed = f.eval("JSON.parse(" + debug::Value(tree.json()).json() + ").nodes.length");
        CHECK(parsed.asNumber() == 4);
    }

    TEST_CASE("removed and old-generation nodes cannot resolve to new nodes")
    {
        Fixture f;
        const auto id = f.view();
        f.host.surface().releaseNode(id);
        CHECK_THROWS_AS((void)f.inspector.node(f.host, id), std::invalid_argument);
        const auto fresh = f.view();
        CHECK(fresh != id);
        f.inspector.tick(f.host, 2);
        f.inspector.execute(f.host, { .id = "stale", .method = "UI.highlightNode", .generation = 1, .node = fresh });
        CHECK(f.messages.back().find("STALE_NODE") != std::string::npos);
        f.inspector.execute(
            f.host, { .id = "old-picker", .method = "UI.setPickerEnabled", .targetGeneration = 1, .enabled = true });
        CHECK_FALSE(f.inspector.picking());
        CHECK(f.messages.back().find("STALE_NODE") != std::string::npos);
    }

    TEST_CASE("picker selects the deepest node and intercepts the entire click and focus")
    {
        Fixture f;
        f.subscribe();
        const auto parent = f.view();
        const auto child = f.view(20, 15, parent);
        f.host.surface().setFocusable(child, true);
        int applicationEvents = 0;
        f.host.surface().setEventSink(
            [&](const ui::Event&)
            {
                ++applicationEvents;
                return false;
            });
        f.picker();
        const int before = applicationEvents;
        f.input(ui::PointerInput::Phase::Move);
        CHECK(f.host.surface().debugHighlight() == child);
        f.input(ui::PointerInput::Phase::Down, 10, 10, 1);
        f.input(ui::PointerInput::Phase::Up);
        CHECK(applicationEvents == before);
        CHECK(f.host.surface().focused() == ui::noNode);
        CHECK_FALSE(f.inspector.picking());
        CHECK(std::ranges::any_of(f.messages,
                                  [&](const auto& message)
                                  {
                                      return message.find("UI.nodeSelected") != std::string::npos
                                             && message.find('"' + std::to_string(child) + '"') != std::string::npos;
                                  }));
        f.input(ui::PointerInput::Phase::Down, 10, 10, 1);
        f.input(ui::PointerInput::Phase::Up);
        CHECK(applicationEvents > before);
    }

    TEST_CASE("picker never invokes real application JavaScript listeners")
    {
        Fixture f;
        f.run(R"(import { root, createView } from 'soundor:ui';
            globalThis.calls = 0;
            const control = createView(); control.style = { width: 40, height: 30 }; root.appendChild(control);
            control.addEventListener('pointerdown', () => globalThis.calls++);
            control.addEventListener('pointerup', () => globalThis.calls++);
            control.addEventListener('click', () => globalThis.calls++);
        )");
        f.picker();
        f.input(ui::PointerInput::Phase::Down, 10, 10, 1);
        f.input(ui::PointerInput::Phase::Up);
        const auto count = f.eval("calls");
        CHECK(count.asNumber() == 0);
    }

    TEST_CASE("Escape and disconnect cancel selection without leaking a release")
    {
        Fixture f;
        f.view();
        f.picker();
        int events = 0;
        f.host.surface().setEventSink(
            [&](const ui::Event&)
            {
                ++events;
                return false;
            });
        f.input(ui::PointerInput::Phase::Down, 10, 10, 1);
        CHECK(f.inspector.key(f.host.surface(), { .down = true, .key = "Escape" }));
        CHECK_FALSE(f.inspector.picking());
        CHECK(f.host.surface().debugHighlight() == ui::noNode);
        CHECK(f.inspector.key(f.host.surface(), { .down = false, .key = "Escape" }));
        f.input(ui::PointerInput::Phase::Up);
        CHECK(events == 0);
        f.picker();
        f.input(ui::PointerInput::Phase::Down, 10, 10, 1);
        f.inspector.reset(f.host.surface());
        f.input(ui::PointerInput::Phase::Up);
        CHECK(events == 0);
    }

    TEST_CASE("activation cancels implicit pointer capture, including after early disconnect")
    {
        Fixture f;
        f.view();
        int cancelled = 0, released = 0;
        f.host.surface().setEventSink(
            [&](const ui::Event& event)
            {
                if (event.type == ui::Event::Type::PointerCancel)
                    ++cancelled;
                if (event.type == ui::Event::Type::PointerUp)
                    ++released;
                return false;
            });
        f.input(ui::PointerInput::Phase::Down, 10, 10, 1);
        f.picker();
        CHECK(cancelled == 1);
        f.inspector.reset(f.host.surface());
        f.input(ui::PointerInput::Phase::Up);
        CHECK(released == 0);
    }

    TEST_CASE("overlay and Canvas nodes are eligible, including scrolling and transforms")
    {
        Fixture f;
        f.view();
        const auto overlay = f.view(30, 30, f.host.surface().overlay().id());
        const auto canvas = f.host.surface().createNode(ui::NodeType::Canvas);
        f.host.surface().insertChild(overlay, canvas);
        f.host.surface().setCanvasSize(canvas, 20, 20);
        f.picker();
        f.input(ui::PointerInput::Phase::Move);
        CHECK(f.host.surface().debugHighlight() == canvas);
        f.input(ui::PointerInput::Phase::Down, 10, 10, 1);
        f.inspector.tick(f.host, 2);
        f.input(ui::PointerInput::Phase::Up);
        CHECK(f.host.surface().debugHighlight() == ui::noNode);
        CHECK_FALSE(f.inspector.picking());
    }

    TEST_CASE("CPU highlight is a separate cached final layer and never changes node styles")
    {
        Fixture f;
        const auto id = f.view();
        const auto style = f.host.surface().find(id)->style();
        CHECK(f.host.frame().layers.size() == 1);
        f.host.surface().debugHighlight(id);
        const auto& frame = f.host.frame();
        REQUIRE(frame.layers.size() == 2);
        const auto& pixels = std::get<render::RasterContent>(frame.layers.back().content);
        REQUIRE(pixels.surface);
        CHECK((pixels.surface->pixels()[10 * 120 + 10] >> 24) > 0);
        CHECK((pixels.surface->pixels()[80 * 120 + 80] >> 24) == 0);
        CHECK(f.host.surface().find(id)->style() == style);
        const auto layer = frame.layers.back().id;
        const auto& cached = f.host.frame();
        CHECK(cached.layers.back().id == layer);
        CHECK(std::get<render::RasterContent>(cached.layers.back().content).damage.empty());
        const auto other = f.view();
        auto otherStyle = f.host.surface().find(other)->style();
        otherStyle.backgroundColor = { 255, 0, 0, 255 };
        f.host.surface().setStyle(other, otherStyle);
        CHECK(std::get<render::RasterContent>(f.host.frame().layers.back().content).damage.empty());
        f.host.surface().setSize({ 60, 50 });
        f.host.surface().setScale(2);
        const auto& scaled = std::get<render::RasterContent>(f.host.frame().layers.back().content);
        CHECK((scaled.surface->pixels()[10 * 120 + 50] >> 24) > 0);
        f.host.surface().debugHighlight(ui::noNode);
        CHECK(f.host.frame().layers.size() == 1);
    }

    TEST_CASE("highlight follows layout and clipping after scrolling")
    {
        Fixture f;
        auto& surface = f.host.surface();
        const auto scroll = surface.createNode(ui::NodeType::Scroll);
        ui::Style box;
        box.width = ui::Length::points(30);
        box.height = ui::Length::points(30);
        surface.setStyle(scroll, box);
        surface.insertChild(surface.root().id(), scroll);
        const auto child = f.view(100, 30, scroll);
        surface.scrollTo(scroll, { 20, 0 });
        surface.debugHighlight(child);
        const auto& frame = f.host.frame();
        const auto& pixels = std::get<render::RasterContent>(frame.layers.back().content);
        CHECK((pixels.surface->pixels()[10 * 120 + 10] >> 24) > 0);
        CHECK((pixels.surface->pixels()[10 * 120 + 40] >> 24) == 0);
        CHECK(surface.hitTest({ 10, 10 }) == child);
        const auto details = f.inspector.node(f.host, child);
        CHECK(number(object(object(details).at("bounds")).at("x")) == -20);
    }

    TEST_CASE("snapshot output and change notifications are bounded and optional")
    {
        Fixture f;
        for (int i = 0; i < 5100; ++i)
            f.view(1, 1);
        const auto snapshot = f.inspector.tree(f.host);
        CHECK(std::get<bool>(object(snapshot).at("truncated").data));
        CHECK(snapshot.json().size() < 1024 * 1024);
        f.inspector.tick(f.host, 1);
        CHECK(f.messages.empty());
        f.subscribe();
        f.inspector.tick(f.host, 1);
        const auto count = f.messages.size();
        for (int i = 0; i < 100; ++i)
            f.inspector.tick(f.host, 1);
        CHECK(f.messages.size() == count);
    }

    TEST_CASE("text and accessibility changes have bounded metadata patches only while subscribed")
    {
        Fixture f;
        auto& surface = f.host.surface();
        const auto text = surface.createNode(ui::NodeType::Text);
        surface.insertChild(surface.root().id(), text);
        surface.setText(text, "Before");
        bool overflow = false;
        CHECK(surface.takeDebugMetadataChanges(overflow).empty());
        f.subscribe();
        surface.setText(text, "After");
        const auto changes = surface.takeDebugMetadataChanges(overflow);
        CHECK(std::ranges::find(changes, text) != changes.end());
        CHECK_FALSE(overflow);
        a11y::Properties properties;
        properties.role = a11y::Role::Button;
        properties.label = "Updated";
        surface.setAccessibility(text, properties);
        f.inspector.tick(f.host, 1);
        CHECK(std::ranges::any_of(f.messages,
                                  [](const auto& message) {
                                      return message.find("Updated") != std::string::npos
                                             && message.find("UI.treeChanged") != std::string::npos;
                                  }));
        f.inspector.execute(f.host, { .method = "subscribe" });
        surface.setText(text, "Inactive");
        CHECK(surface.takeDebugMetadataChanges(overflow).empty());
    }

    TEST_CASE("transformed highlights and hit testing use the same world coordinates")
    {
        Fixture f;
        const auto id = f.view(20, 20);
        auto& surface = f.host.surface();
        auto style = surface.find(id)->style();
        style.transform.count = 2;
        style.transform.order[0] = ui::AnimatedProperty::TranslateX;
        style.transform.order[1] = ui::AnimatedProperty::Scale;
        style.transform[ui::AnimatedProperty::TranslateX] = 30;
        style.transform[ui::AnimatedProperty::Scale] = 2;
        surface.setStyle(id, style);
        const auto bounds = surface.bounds(id);
        const ui::Point center { bounds.x + bounds.width / 2, bounds.y + bounds.height / 2 };
        f.picker();
        f.input(ui::PointerInput::Phase::Move, center.x, center.y);
        CHECK(surface.debugHighlight() == id);
        CHECK(bounds.width == 40);
        const auto& pixels = std::get<render::RasterContent>(f.host.frame().layers.back().content);
        const auto x = static_cast<std::size_t>(center.x), y = static_cast<std::size_t>(center.y);
        CHECK((pixels.surface->pixels()[y * 120 + x] >> 24) > 0);
    }

#if SOUNDOR_TEST_GPU
    TEST_CASE("GPU composition shows a cached highlight without WebGL readbacks")
    {
        const auto device = test::testDevice();
        if (! device)
            return;
        RuntimeHost::Options options;
        options.gpuDevice = device;
        options.allowSoftwareGpu = true;
        test::WebFixture f(options);
        f.host.surface().setSize({ 100, 100 });
        f.run(R"(import { root, createCanvas } from 'soundor:ui';
            const canvas = createCanvas({ width: 40, height: 40 }); canvas.width = 40; canvas.height = 40; root.appendChild(canvas);
            const gl = canvas.getContext('webgl2'); gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
        )");
        f.host.tick();
        const auto id = f.host.surface().root().children().front()->id();
        f.host.surface().debugHighlight(id);
        gpu::OffscreenCompositor compositor(device);
        const auto& frame = f.host.frame(compositor.capabilities());
        CHECK(frame.statistics.gpuLayers == 1);
        CHECK(frame.statistics.gpuReadbacks == 0);
        compositor.composite(frame);
        const auto pixels = compositor.readPixels();
        CHECK((pixels[10 * 100 + 10] & 0xff) > 0);
        const auto& cached = f.host.frame(compositor.capabilities());
        compositor.composite(cached);
        CHECK(compositor.statistics().bytesUploaded == 0);
        CHECK(compositor.statistics().readbacks == 0);
        CHECK(cached.statistics.gpuReadbacks == 0);
    }
#endif
}
