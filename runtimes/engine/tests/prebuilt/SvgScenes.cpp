// Public headers only: this runs unchanged against source and both prebuilt variants.
#include <soundor/ui/Renderer.h>

#include <doctest/doctest.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>
#include <vector>

using namespace soundor;

namespace
{
    ui::SvgShape shape(ui::SvgGeometry geometry, ui::SvgPresentation presentation = {})
    {
        return { std::move(geometry), std::move(presentation), {} };
    }

    struct SvgFixture
    {
        std::string xml;
        ui::Renderer renderer;
        ui::Surface surface;
        ui::NodeId node;
        std::vector<std::uint32_t> pixels;
        int side = 100;

        explicit SvgFixture(std::string document = {})
            : xml(std::move(document)),
              renderer([&](std::string_view) -> std::optional<std::span<const std::uint8_t>>
                       { return std::span(reinterpret_cast<const std::uint8_t*>(xml.data()), xml.size()); }),
              surface({ .textEngine = renderer.textEngine(), .images = renderer.images() }),
              node(surface.createNode(xml.empty() ? ui::NodeType::Svg : ui::NodeType::Image))
        {
            surface.setSize({ 100, 100 });
            ui::Style style;
            style.width = ui::Length::points(100);
            style.height = ui::Length::points(100);
            surface.setStyle(node, style);
            surface.insertChild(surface.root().id(), node);
            if (! xml.empty())
                surface.setSource(node, "reference.svg");
        }
        void draw(float scale = 1)
        {
            surface.setScale(scale);
            side = static_cast<int>(100 * scale);
            pixels.assign(static_cast<std::size_t>(side) * static_cast<std::size_t>(side), 0);
            renderer.render(surface, { pixels.data(), side, side, static_cast<std::size_t>(side) * 4 }, 0);
        }
        std::uint32_t at(int x, int y) const
        {
            return pixels[static_cast<std::size_t>(y) * static_cast<std::size_t>(side) + static_cast<std::size_t>(x)];
        }
    };

    void samePixels(SvgFixture& a, SvgFixture& b)
    {
        REQUIRE(a.pixels.size() == b.pixels.size());
        int worst = 0;
        std::size_t where = 0;
        for (std::size_t i = 0; i < a.pixels.size(); ++i)
            for (int shift = 0; shift < 32; shift += 8)
            {
                const int difference = std::abs(static_cast<int>((a.pixels[i] >> shift) & 255)
                                                - static_cast<int>((b.pixels[i] >> shift) & 255));
                if (difference > worst)
                {
                    worst = difference;
                    where = i;
                }
            }
        CHECK_MESSAGE(worst <= 16, "channel difference " << worst << " at pixel " << where);
    }
} // namespace

TEST_SUITE("retained SVG scene")
{
    TEST_CASE("primitives, arcs, inherited paint and nested transforms match SVG document rendering at physical scales")
    {
        SvgFixture scene;
        SvgFixture image(
            R"svg(<svg width="100" height="100" viewBox="0 0 100 100" fill="none" stroke="currentColor" color="blue" stroke-width="2">
          <g transform="translate(2 3)" stroke-linecap="round" stroke-linejoin="bevel">
            <circle cx="15" cy="15" r="10"/><rect x="35" y="5" width="25" height="20" rx="4"/>
            <ellipse cx="85" cy="15" rx="10" ry="5"/><line x1="5" y1="40" x2="25" y2="60"/>
            <polygon points="35,35 60,35 50,60"/><polyline points="70,40 80,60 95,40"/>
            <path d="M5 85C15 65 30 65 35 85S55 105 65 85Q75 65 85 85T95 85"/>
            <path d="M10 50A10 10 0 0110 70"/>
          </g></svg>)svg");
        ui::SvgScene data;
        data.viewBox = { 0, 0, 100, 100 };
        data.presentation.fill = "none";
        data.presentation.stroke = "currentColor";
        data.presentation.color = "blue";
        data.presentation.strokeWidth = 2;
        auto group = shape(ui::SvgGroup {});
        group.presentation.transform = { 1, 0, 0, 1, 2, 3 };
        group.presentation.strokeLinecap = "round";
        group.presentation.strokeLinejoin = "bevel";
        group.children = { shape(ui::SvgCircle { 15, 15, 10 }),
                           shape(ui::SvgRect { 35, 5, 25, 20, 4, {} }),
                           shape(ui::SvgEllipse { 85, 15, 10, 5 }),
                           shape(ui::SvgLine { 5, 40, 25, 60 }),
                           shape(ui::SvgPoints { { 35, 35, 60, 35, 50, 60 }, true }),
                           shape(ui::SvgPoints { { 70, 40, 80, 60, 95, 40 }, false }),
                           shape(ui::SvgPath { "M5 85C15 65 30 65 35 85S55 105 65 85Q75 65 85 85T95 85" }),
                           shape(ui::SvgPath { "M10 50A10 10 0 0110 70" }) };
        data.children.push_back(std::move(group));
        scene.surface.setSvgScene(scene.node, data);
        for (const float scale : { 0.5f, 1.0f, 1.5f, 2.0f, 3.0f, 4.0f })
        {
            scene.draw(scale);
            image.draw(scale);
            samePixels(scene, image);
        }
        CHECK(scene.surface.statistics().svgPathParses == 2);
        CHECK(scene.surface.find(scene.node)->children().empty());
    }

    TEST_CASE("viewBox origin, meet, slice and none map into the updated viewport")
    {
        for (const auto* ratio : { "xMidYMid meet", "xMinYMax meet", "xMidYMid slice", "none" })
        {
            SvgFixture scene;
            SvgFixture image(std::string("<svg width='100' height='100' viewBox='10 20 100 50' preserveAspectRatio='")
                             + ratio
                             + "'><rect x='10' y='20' width='50' height='50' fill='red'/>"
                               "<rect x='60' y='20' width='50' height='50' fill='blue'/></svg>");
            ui::SvgScene data;
            data.viewBox = { 10, 20, 100, 50 };
            data.preserveAspectRatio = ratio;
            data.children = { shape(ui::SvgRect { 10, 20, 50, 50 }, { .fill = "red" }),
                              shape(ui::SvgRect { 60, 20, 50, 50 }, { .fill = "blue" }) };
            scene.surface.setSvgScene(scene.node, data);
            scene.draw();
            image.draw();
            samePixels(scene, image);
        }
    }

    TEST_CASE("group and shape opacity isolate overlap, currentColor follows the child's inherited color")
    {
        SvgFixture f;
        ui::SvgScene scene;
        scene.presentation.fill = "currentColor";
        scene.presentation.color = "red";
        auto group = shape(ui::SvgGroup {}, { .opacity = 0.5f });
        group.children = { shape(ui::SvgRect { 0, 0, 60, 60 }), shape(ui::SvgRect { 30, 0, 60, 60 }) };
        scene.children = { group, shape(ui::SvgRect { 0, 70, 20, 20 }, { .color = "blue" }) };
        f.surface.setSvgScene(f.node, scene);
        f.draw();
        CHECK((f.at(10, 30) >> 24) == 128);
        CHECK((f.at(40, 30) >> 24) == 128);
        CHECK(f.at(10, 80) == 0xff0000ff);
        scene.children = { shape(ui::SvgRect { 10, 10, 60, 60 },
                                 { .fill = "red", .stroke = "blue", .strokeWidth = 10, .opacity = 0.5f }) };
        f.surface.setSvgScene(f.node, scene);
        f.draw();
        CHECK((f.at(12, 30) >> 24) == 128);
        CHECK((f.at(30, 30) >> 24) == 128);
    }

    TEST_CASE("fill rules, dash inheritance and zero-width strokes follow SVG defaults")
    {
        SvgFixture f;
        ui::SvgScene scene;
        scene.children = { shape(ui::SvgPath { "M0 0h60v60H0z M10 10h40v40H10z" },
                                 { .fill = "red", .fillRule = "evenodd" }),
                           shape(ui::SvgLine { 0, 80, 100, 80 }, { .stroke = "blue", .strokeWidth = 0 }) };
        f.surface.setSvgScene(f.node, scene);
        f.draw();
        CHECK(f.at(5, 5) == 0xffff0000);
        CHECK(f.at(30, 30) == 0);
        CHECK(f.at(50, 80) == 0);
        scene.presentation.stroke = "blue";
        scene.presentation.strokeWidth = 4;
        scene.presentation.strokeDasharray = std::vector<float> { 10 };
        scene.children = { shape(ui::SvgLine { 0, 80, 100, 80 }) };
        f.surface.setSvgScene(f.node, scene);
        f.draw();
        CHECK(f.at(5, 80) == 0xff0000ff);
        CHECK(f.at(15, 80) == 0);
    }

    TEST_CASE("geometry is shared across 500 roots and retained through paint, layout and scale updates")
    {
        SvgFixture f;
        ui::SvgScene scene;
        scene.viewBox = { 0, 0, 20, 20 };
        scene.children = { shape(ui::SvgPath { "M2 2h16v16H2z" }) };
        std::vector<ui::NodeId> nodes;
        for (int i = 0; i < 500; ++i)
        {
            const auto id = f.surface.createNode(ui::NodeType::Svg);
            f.surface.setSvgScene(id, scene);
            nodes.push_back(id);
        }
        CHECK(f.surface.statistics().svgPathParses == 1);
        f.surface.setSvgScene(f.node, scene);
        const auto updates = f.surface.statistics().svgSceneUpdates;
        f.surface.setSvgScene(f.node, scene);
        CHECK(f.surface.statistics().svgSceneUpdates == updates);
        scene.presentation.fill = "red";
        f.surface.setSvgScene(f.node, scene);
        f.draw();
        const auto layouts = f.surface.statistics().layoutPasses;
        scene.presentation.fill = "blue";
        f.surface.setSvgScene(f.node, scene);
        f.draw();
        CHECK(f.surface.statistics().layoutPasses == layouts);
        for (const float scale : { 0.5f, 1.0f, 1.5f, 2.0f, 3.0f, 4.0f })
            f.draw(scale);
        CHECK(f.surface.statistics().svgPathParses == 1);
        CHECK(f.surface.hitTest({ 1, 1 }) == f.node); // viewport, not shape geometry
        CHECK_THROWS_AS(f.surface.insertChild(f.node, nodes.front()), std::invalid_argument);
        for (const auto id : nodes)
            f.surface.releaseNode(id);
        f.surface.setSvgScene(f.node, std::nullopt);
        f.draw();
        CHECK(f.at(f.side / 2, f.side / 2) == 0);
        CHECK(f.surface.find(f.node)->svgScene() == nullptr);
    }

    TEST_CASE("intrinsic layout uses the viewBox ratio, with only the root participating")
    {
        ui::Surface surface;
        surface.setSize({ 1000, 1000 });
        const auto parent = surface.createNode(ui::NodeType::View);
        ui::Style start;
        start.alignItems = ui::Align::FlexStart;
        surface.setStyle(parent, start);
        surface.insertChild(surface.root().id(), parent);
        const auto svg = surface.createNode(ui::NodeType::Svg);
        surface.insertChild(parent, svg);
        surface.layout();
        CHECK(surface.find(svg)->frame().width == 300);
        CHECK(surface.find(svg)->frame().height == 150);
        ui::SvgScene scene;
        scene.viewBox = { 0, 0, 20, 20 };
        surface.setSvgScene(svg, scene);
        surface.layout();
        CHECK(surface.find(svg)->frame().width == 150);
        CHECK(surface.find(svg)->frame().height == 150);
        ui::Style size;
        size.width = ui::Length::points(40);
        surface.setStyle(svg, size);
        surface.layout();
        CHECK(surface.find(svg)->frame().width == 40);
        CHECK(surface.find(svg)->frame().height == 40);
    }

    TEST_CASE("invalid snapshots are rejected atomically and repeated replacement/clear is safe")
    {
        SvgFixture f;
        ui::SvgScene good;
        good.children = { shape(ui::SvgRect { 0, 0, 100, 100 }, { .fill = "red" }) };
        f.surface.setSvgScene(f.node, good);
        f.draw();
        const auto reject = [&](ui::SvgScene bad)
        {
            const auto before = f.surface.statistics().svgSceneUpdates;
            CHECK_THROWS_AS(f.surface.setSvgScene(f.node, std::move(bad)), std::invalid_argument);
            CHECK(f.surface.statistics().svgSceneUpdates == before);
            f.draw();
            CHECK(f.at(50, 50) == 0xffff0000);
        };
        auto bad = good;
        bad.version = 2;
        reject(bad);
        bad = good;
        bad.viewBox = { 0, 0, 0, 10 };
        reject(bad);
        bad = good;
        bad.presentation.opacity = std::numeric_limits<float>::infinity();
        reject(bad);
        bad = good;
        bad.children = { shape(ui::SvgCircle { 0, 0, -1 }) };
        reject(bad);
        bad = good;
        bad.children = { shape(ui::SvgPath { "M0 0LNaN 1" }) };
        reject(bad);
        bad = good;
        bad.children = { shape(ui::SvgPath { "M0 0garbage" }) };
        reject(bad);
        bad = good;
        bad.children = { shape(ui::SvgPoints { { 1, 2, 3 }, false }) };
        reject(bad);
        bad = good;
        bad.presentation.strokeDasharray = std::vector<float> { -1, 2 };
        reject(bad);
        bad = good;
        bad.presentation.strokeMiterlimit = 0;
        reject(bad);
        bad = good;
        bad.presentation.fill = "url(https://example.invalid/a)";
        reject(bad);
        bad = good;
        bad.children.resize(4096);
        reject(bad);
        bad = good;
        bad.children = { shape(ui::SvgPath { std::string(256 * 1024 + 1, ' ') }) };
        reject(bad);
        bad = good;
        bad.children.front().children.push_back(shape(ui::SvgGroup {}));
        reject(bad);
        bad = good;
        for (int i = 0; i < 66; ++i)
        {
            auto group = shape(ui::SvgGroup {});
            group.children = std::move(bad.children);
            bad.children = { std::move(group) };
        }
        reject(bad);
        for (int i = 0; i < 100; ++i)
        {
            f.surface.setSvgScene(f.node, std::nullopt);
            f.surface.setSvgScene(f.node, good);
        }
        f.draw();
        CHECK(f.at(50, 50) == 0xffff0000);
    }
}
