#include "../web/WebTestSupport.h"

#include <soundor/debug/Inspector.h>

#include <cstdint>
#include <string>
#include <vector>

using namespace soundor;

namespace
{
    struct Capture
    {
        std::string id;
        std::vector<std::uint8_t> png;
        std::string response;
    };

    struct Fixture : test::WebFixture
    {
        std::vector<std::string> messages;
        std::vector<Capture> captures;
        debug::Inspector inspector { [this](std::string message) { messages.push_back(std::move(message)); } };
        ui::NodeId box = ui::noNode;
        Fixture()
        {
            inspector.attachments([this](std::string id, std::vector<std::uint8_t> png, std::string response)
                                  { captures.push_back({ std::move(id), std::move(png), std::move(response) }); });
            auto& surface = host.surface();
            surface.setSize({ 120, 100 });
            box = surface.createNode(ui::NodeType::View);
            ui::Style style;
            style.position = ui::Position::Absolute;
            style.inset.left = ui::Length::points(10);
            style.inset.top = ui::Length::points(20);
            style.width = ui::Length::points(30);
            style.height = ui::Length::points(15);
            style.backgroundColor = { 255, 0, 0, 255 };
            surface.setStyle(box, style);
            surface.insertChild(surface.root().id(), box);
        }
        void capture(ui::NodeId node = ui::noNode)
        {
            debug::Command command { .id = "c" + std::to_string(captures.size() + messages.size()),
                                     .method = "Capture.screenshot",
                                     .generation = 1,
                                     .node = node,
                                     .nodeRequested = node != ui::noNode };
            inspector.execute(host, command);
        }
    };

    std::uint32_t big(const std::vector<std::uint8_t>& bytes, std::size_t at)
    {
        return (std::uint32_t { bytes[at] } << 24) | (std::uint32_t { bytes[at + 1] } << 16)
               | (std::uint32_t { bytes[at + 2] } << 8) | std::uint32_t { bytes[at + 3] };
    }
    // A PNG's size from its header, after checking its signature and end.
    std::pair<std::uint32_t, std::uint32_t> size(const std::vector<std::uint8_t>& png)
    {
        REQUIRE(png.size() > 33);
        CHECK(std::vector<std::uint8_t>(png.begin(), png.begin() + 8)
              == std::vector<std::uint8_t> { 0x89, 'P', 'N', 'G', '\r', '\n', 0x1a, '\n' });
        CHECK(std::string(png.end() - 8, png.end() - 4) == "IEND");
        return { big(png, 16), big(png, 20) };
    }
} // namespace

TEST_SUITE("Native DevTools capture")
{
    TEST_CASE("captures the view at its scale, as PNG, through the attachment channel")
    {
        Fixture f;
        f.capture();
        REQUIRE(f.captures.size() == 1);
        CHECK(f.messages.empty());
        const auto& capture = f.captures.front();
        CHECK(capture.id == "c0");
        CHECK(size(capture.png) == std::pair<std::uint32_t, std::uint32_t> { 120, 100 });
        CHECK(capture.response.find(R"("bytes":)" + std::to_string(capture.png.size())) != std::string::npos);
        CHECK(capture.response.find(R"("format":"png")") != std::string::npos);
        f.host.surface().setScale(2);
        f.capture();
        CHECK(size(f.captures.back().png) == std::pair<std::uint32_t, std::uint32_t> { 240, 200 });
        CHECK(f.captures.back().response.find(R"("scale":2)") != std::string::npos);
    }

    TEST_CASE("captures what is rendered: a change shows in the next capture")
    {
        Fixture f;
        f.capture();
        ui::Style style = f.host.surface().find(f.box)->style();
        style.backgroundColor = { 0, 0, 255, 255 };
        f.host.surface().setStyle(f.box, style);
        f.capture();
        REQUIRE(f.captures.size() == 2);
        CHECK(f.captures[0].png != f.captures[1].png);
    }

    TEST_CASE("clips a capture to a node's box, at the view's scale")
    {
        Fixture f;
        f.host.surface().setScale(2);
        f.capture(f.box);
        REQUIRE(f.captures.size() == 1);
        CHECK(size(f.captures.front().png) == std::pair<std::uint32_t, std::uint32_t> { 60, 30 });
    }

    TEST_CASE("reports when a capture cannot be made, and never sends a half one")
    {
        Fixture f;
        f.host.surface().setSize({ 0, 0 });
        f.capture();
        CHECK(f.captures.empty());
        REQUIRE_FALSE(f.messages.empty());
        CHECK(f.messages.back().find("CAPTURE_UNAVAILABLE") != std::string::npos);

        debug::Inspector bare([&](std::string message) { f.messages.push_back(std::move(message)); });
        f.host.surface().setSize({ 120, 100 });
        bare.execute(f.host, { .id = "x", .method = "Capture.screenshot" });
        CHECK(f.messages.back().find("cannot transfer captures") != std::string::npos);

        const auto removed = f.box;
        f.host.surface().releaseNode(removed);
        f.capture(removed);
        CHECK(f.messages.back().find("STALE_NODE") != std::string::npos);
        CHECK(f.captures.empty());
    }
}
