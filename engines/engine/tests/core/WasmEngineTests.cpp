// The WebAssembly engine's C++ side (wasm/Engine.cpp), compiled natively with
// the engine's core alone: commands in, records of the changed layout out,
// as web/src/engine.ts sends and reads them. The executable links Yoga and
// the core's sources, no Hermes nor Skia: what the WebAssembly module is.
#include "../../wasm/Engine.h"

#include <doctest/doctest.h>

#include <bit>
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

using namespace soundor;
using wasm::Command;
using wasm::NodeKind;
using wasm::Record;

namespace
{
    // Writes commands as web/src/protocol.ts does.
    struct Commands
    {
        std::vector<std::uint8_t> bytes;

        Commands& word(std::uint32_t value)
        {
            const auto* at = reinterpret_cast<const std::uint8_t*>(&value);
            bytes.insert(bytes.end(), at, at + 4);
            return *this;
        }
        Commands& command(Command command) { return word(static_cast<std::uint32_t>(command)); }
        Commands& real(float value) { return word(std::bit_cast<std::uint32_t>(value)); }
        Commands& real64(double value)
        {
            const auto* at = reinterpret_cast<const std::uint8_t*>(&value);
            bytes.insert(bytes.end(), at, at + 8);
            return *this;
        }
        Commands& text(std::string_view value)
        {
            word(static_cast<std::uint32_t>(value.size()));
            bytes.insert(bytes.end(), value.begin(), value.end());
            bytes.resize(bytes.size() + (4 - value.size() % 4) % 4, 0);
            return *this;
        }

        Commands& create(std::uint32_t handle, NodeKind kind = NodeKind::View)
        {
            return command(Command::Create).word(handle).word(static_cast<std::uint32_t>(kind));
        }
        Commands& insert(std::uint32_t parent, std::uint32_t child, std::uint32_t before = 0)
        {
            return command(Command::Insert).word(parent).word(child).word(before);
        }
        Commands& remove(std::uint32_t parent, std::uint32_t child)
        {
            return command(Command::Remove).word(parent).word(child);
        }
        Commands& release(std::uint32_t handle) { return command(Command::Release).word(handle); }
        Commands& size(float width, float height) { return command(Command::Size).real(width).real(height); }
        Commands& setText(std::uint32_t handle, std::string_view value)
        {
            return command(Command::Text).word(handle).text(value);
        }
        Commands& layout() { return command(Command::Layout); }
        Commands& natural(std::uint32_t handle, float width, float height)
        {
            return command(Command::Natural).word(handle).real(width).real(height);
        }
        Commands& placeholder(std::uint32_t handle, std::string_view value)
        {
            return command(Command::Placeholder).word(handle).text(value);
        }

        // A style of numbers and strings.
        using Value = std::pair<std::string, std::variant<double, std::string>>;
        Commands& style(std::uint32_t handle, const std::vector<Value>& properties)
        {
            command(Command::Style).word(handle).word(static_cast<std::uint32_t>(properties.size()));
            for (const auto& [key, value] : properties)
            {
                text(key);
                if (const auto* number = std::get_if<double>(&value))
                    word(1).real64(*number);
                else
                    word(2).text(std::get<std::string>(value));
            }
            return *this;
        }
    };

    struct Frame
    {
        float x, y, left, top, width, height;
        float border[4];
        float padding[4];
    };

    struct Extent
    {
        float contentWidth, contentHeight, clientWidth, clientHeight;
    };

    struct Line
    {
        std::uint32_t start, end;
        float x, y, width, height;
    };

    struct Answer
    {
        std::map<std::uint32_t, Frame> frames;
        std::map<std::uint32_t, std::vector<Line>> texts;
        std::map<std::uint32_t, float> lineHeights;
        std::map<std::uint32_t, Extent> extents;
        std::vector<std::pair<std::uint32_t, std::string>> errors; // command index, message
        std::vector<int> errorKinds;
        [[nodiscard]] bool empty() const { return frames.empty() && texts.empty() && errors.empty(); }
    };

    // Runs commands and reads the answer as web/src/engine.ts does.
    Answer run(wasm::Engine& engine, const Commands& commands)
    {
        std::memcpy(engine.input(commands.bytes.size()), commands.bytes.data(), commands.bytes.size());
        const std::uint8_t* answer = engine.apply(commands.bytes.size());
        REQUIRE(answer != nullptr);
        std::uint32_t length = 0;
        std::memcpy(&length, answer, 4);
        std::size_t position = 4;
        const auto word = [&]
        {
            std::uint32_t value = 0;
            std::memcpy(&value, answer + position, 4);
            position += 4;
            return value;
        };
        const auto real = [&] { return std::bit_cast<float>(word()); };
        const auto text = [&]
        {
            const std::uint32_t size = word();
            std::string value(reinterpret_cast<const char*>(answer + position), size);
            position += (static_cast<std::size_t>(size) + 3) / 4 * 4;
            return value;
        };
        Answer out;
        while (position < 4 + length)
        {
            switch (static_cast<Record>(word()))
            {
                case Record::Error:
                {
                    const std::uint32_t index = word();
                    out.errorKinds.push_back(static_cast<int>(word()));
                    out.errors.emplace_back(index, text());
                    break;
                }
                case Record::Frame:
                {
                    const std::uint32_t handle = word();
                    Frame frame {};
                    frame.x = real();
                    frame.y = real();
                    frame.left = real();
                    frame.top = real();
                    frame.width = real();
                    frame.height = real();
                    for (float& border : frame.border)
                        border = real();
                    for (float& padding : frame.padding)
                        padding = real();
                    out.frames[handle] = frame;
                    break;
                }
                case Record::Text:
                {
                    const std::uint32_t handle = word();
                    real();
                    word();
                    word();
                    text();
                    out.lineHeights[handle] = real();
                    real(); // the content's top in the view
                    std::vector<Line> lines(word());
                    for (Line& line : lines)
                    {
                        line.start = word();
                        line.end = word();
                        line.x = real();
                        line.y = real();
                        line.width = real();
                        line.height = real();
                    }
                    out.texts[handle] = std::move(lines);
                    break;
                }
                case Record::Extent:
                {
                    const std::uint32_t handle = word();
                    Extent extent {};
                    extent.contentWidth = real();
                    extent.contentHeight = real();
                    extent.clientWidth = real();
                    extent.clientHeight = real();
                    out.extents[handle] = extent;
                    break;
                }
                default:
                    FAIL("unknown record");
            }
        }
        return out;
    }

    void checkBox(const Frame& frame, float x, float y, float width, float height)
    {
        CHECK(frame.x == x);
        CHECK(frame.y == y);
        CHECK(frame.width == width);
        CHECK(frame.height == height);
    }
} // namespace

// Handles 1 and 2 are the roots (the content, the overlay layer); nodes made
// by commands start at 3.
TEST_SUITE("wasm engine")
{
    TEST_CASE("creates nodes, lays them out and reports their frames")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(300, 200)
            .create(3)
            .create(4)
            .style(1, { { "flexDirection", std::string("row") }, { "padding", 10.0 }, { "gap", 5.0 } })
            .style(3, { { "width", 100.0 } })
            .style(4, { { "flex", 1.0 } })
            .insert(1, 3)
            .insert(1, 4)
            .layout();
        const Answer answer = run(engine, commands);
        CHECK(answer.errors.empty());
        // Both roots, and the two nodes.
        REQUIRE(answer.frames.size() == 4);
        checkBox(answer.frames.at(1), 0, 0, 300, 200);
        checkBox(answer.frames.at(2), 0, 0, 300, 200);
        checkBox(answer.frames.at(3), 10, 10, 100, 180);
        checkBox(answer.frames.at(4), 115, 10, 175, 180);
        CHECK(answer.frames.at(1).padding[0] == 10);
        CHECK(engine.nodeCount() == 4);
    }

    TEST_CASE("the overlay layer is laid out apart from the content, filling the view")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(200, 100)
            .create(3)
            .create(4)
            .style(3, { { "height", 150.0 }, { "flexShrink", 0.0 } })
            .style(4, { { "position", std::string("absolute") }, { "bottom", 0.0 }, { "height", 10.0 } })
            .insert(1, 3)
            .insert(2, 4)
            .layout();
        const Answer answer = run(engine, commands);
        checkBox(answer.frames.at(4), 0, 90, 0, 10);
        CHECK(run(engine, Commands().release(2)).errors.at(0).second == "a root cannot be released");
    }

    TEST_CASE("reports only what changed")
    {
        wasm::Engine engine;
        Commands first;
        first.size(100, 100).create(3).style(3, { { "height", 10.0 } }).insert(1, 3).layout();
        CHECK(run(engine, first).frames.size() == 3);
        CHECK(run(engine, Commands().layout()).empty());

        const Answer resized = run(engine, Commands().size(50, 100).layout());
        REQUIRE(resized.frames.size() == 3);
        checkBox(resized.frames.at(1), 0, 0, 50, 100);
        checkBox(resized.frames.at(3), 0, 0, 50, 10);
    }

    TEST_CASE("a node out of the trees is reported again when it comes back")
    {
        wasm::Engine engine;
        run(engine, Commands().size(100, 100).create(3).style(3, { { "height", 10.0 } }).insert(1, 3).layout());
        CHECK(run(engine, Commands().remove(1, 3).layout()).frames.count(3) == 0);
        const Answer back = run(engine, Commands().insert(1, 3).layout());
        REQUIRE(back.frames.count(3) == 1);
        checkBox(back.frames.at(3), 0, 0, 100, 10);
    }

    TEST_CASE("children are inserted before others, moved and removed")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(100, 100);
        for (std::uint32_t handle = 3; handle <= 5; ++handle)
            commands.create(handle).style(handle, { { "height", 10.0 } });
        commands.insert(1, 3).insert(1, 4).insert(1, 5, 3).layout();
        Answer answer = run(engine, commands);
        CHECK(answer.frames.at(5).y == 0);
        CHECK(answer.frames.at(3).y == 10);
        CHECK(answer.frames.at(4).y == 20);

        // Moved to the end: inserting again moves it.
        answer = run(engine, Commands().insert(1, 5).layout());
        CHECK(answer.frames.at(3).y == 0);
        CHECK(answer.frames.at(4).y == 10);
        CHECK(answer.frames.at(5).y == 20);

        answer = run(engine, Commands().remove(1, 3).layout());
        CHECK(answer.frames.at(4).y == 0);
        CHECK(answer.frames.at(5).y == 10);
        CHECK(answer.frames.count(3) == 0); // detached: not reported
    }

    TEST_CASE("borders and padding: frames are relative to the parent's border box, elements to its padding box")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(100, 100)
            .create(3)
            .create(4)
            .style(3, { { "borderWidth", 4.0 }, { "borderLeftWidth", 6.0 }, { "padding", 2.0 }, { "paddingTop", 3.0 } })
            .style(4, { { "height", 10.0 } })
            .insert(1, 3)
            .insert(3, 4)
            .layout();
        const Answer answer = run(engine, commands);
        const Frame& parent = answer.frames.at(3);
        CHECK(parent.border[0] == 4);
        CHECK(parent.border[1] == 4);
        CHECK(parent.border[2] == 4);
        CHECK(parent.border[3] == 6);
        CHECK(parent.padding[0] == 3);
        CHECK(parent.padding[1] == 2);
        CHECK(parent.padding[2] == 2);
        CHECK(parent.padding[3] == 2);
        const Frame& child = answer.frames.at(4);
        CHECK(child.x == 8);
        CHECK(child.y == 7);
        CHECK(child.left == 2);
        CHECK(child.top == 3);
    }

    TEST_CASE("an invalid style is reported and skipped; the rest of the batch runs")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(100, 100)
            .create(3)
            .style(3, { { "height", 20.0 } })
            .insert(1, 3)
            .style(3, { { "height", std::string("tall") } })
            .style(3, { { "width", 30.0 }, { "flexDirection", std::string("sideways") } })
            .layout();
        const Answer answer = run(engine, commands);
        REQUIRE(answer.errors.size() == 2);
        CHECK(answer.errors[0].first == 4);
        CHECK(answer.errors[0].second == "style.height: expected a number, a percentage or 'auto', got 'tall'");
        CHECK(answer.errorKinds[0] == 1);
        CHECK(answer.errors[1].second
              == "style.flexDirection: expected one of 'column', 'column-reverse', 'row', 'row-reverse', got "
                 "'sideways'");
        // The node keeps the style it had.
        checkBox(answer.frames.at(3), 0, 0, 100, 20);
    }

    TEST_CASE("transform and boxShadow are read as natively, with the same errors")
    {
        // A style of one property, its value nested as protocol.ts writes it.
        const auto style = [](Commands& commands, std::string_view key, const auto& write)
        {
            commands.command(Command::Style).word(3).word(1).text(key);
            write(commands);
        };
        const auto object = [](Commands& commands, std::string_view key, double value)
        { commands.word(6).text("[object Object]").word(1).text(key).word(1).real64(value); };
        wasm::Engine engine;
        Commands commands;
        commands.create(3);
        style(commands, "transform",
              [&](Commands& c)
              {
                  c.word(5).text("[object Object],[object Object]").word(2);
                  object(c, "translateX", 4);
                  c.word(6).text("[object Object]").word(1).text("rotate").word(2).text("90deg");
              });
        style(commands, "transform",
              [&](Commands& c)
              {
                  c.word(5).text("[object Object]").word(1);
                  object(c, "skew", 1);
              });
        style(commands, "boxShadow",
              [&](Commands& c)
              {
                  c.word(5).text("[object Object]").word(1);
                  c.word(6).text("[object Object]").word(2).text("blur").word(1).real64(-1);
                  c.text("color").word(3).text("undefined").text("undefined");
              });
        style(commands, "boxShadow",
              [&](Commands& c)
              {
                  c.word(5).text("[object Object]").word(1);
                  c.word(6).text("[object Object]").word(1).text("inset").word(4).word(1);
              });
        const Answer answer = run(engine, commands);
        REQUIRE(answer.errors.size() == 2);
        CHECK(answer.errors[0]
              == std::pair<std::uint32_t, std::string>(2, "style.transform: unsupported property skew"));
        CHECK(answer.errors[1]
              == std::pair<std::uint32_t, std::string>(
                  3, "style.boxShadow[0].blur: expected a finite nonnegative number, got -1"));
        CHECK(engine.surface().find(3)->style().boxShadow.at(0).inset);
    }

    TEST_CASE("images, canvases and SVGs are measured by the natural size JavaScript gives")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(400, 400)
            .style(1, { { "alignItems", std::string("flex-start") } })
            .create(3, NodeKind::Image)
            .create(4, NodeKind::Canvas)
            .create(5, NodeKind::Svg)
            .insert(1, 3)
            .insert(1, 4)
            .insert(1, 5)
            .layout();
        Answer answer = run(engine, commands);
        // No image yet; a canvas's and an SVG's default size.
        checkBox(answer.frames.at(3), 0, 0, 0, 0);
        checkBox(answer.frames.at(4), 0, 0, 300, 150);
        checkBox(answer.frames.at(5), 0, 150, 300, 150);
        answer = run(engine, Commands().natural(3, 40, 20).style(3, { { "width", 80.0 } }).layout());
        checkBox(answer.frames.at(3), 0, 0, 80, 40);
        CHECK(run(engine, Commands().create(6).natural(6, 1, 1)).errors.at(0).second
              == "only images, canvases and SVGs have a natural size");
    }

    TEST_CASE("an input is measured by its text or placeholder, on one line")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(400, 400)
            .style(1, { { "alignItems", std::string("flex-start") } })
            .create(3, NodeKind::Input)
            .style(3, { { "fontSize", 10.0 } })
            .placeholder(3, "abcd")
            .insert(1, 3)
            .layout();
        Answer answer = run(engine, commands);
        // Four characters and the caret.
        checkBox(answer.frames.at(3), 0, 0, 23, 12);
        CHECK(answer.lineHeights.at(3) == doctest::Approx(12));
        answer = run(engine, Commands().setText(3, "abcdefgh").layout());
        CHECK(answer.frames.at(3).width == 45);
    }

    TEST_CASE("a scroll view's extent is reported as it changes")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(100, 100)
            .create(3)
            .create(4)
            .style(3, { { "height", 50.0 }, { "overflowY", std::string("scroll") }, { "padding", 5.0 } })
            .style(4, { { "height", 200.0 }, { "flexShrink", 0.0 } })
            .insert(1, 3)
            .insert(3, 4)
            .layout();
        Answer answer = run(engine, commands);
        REQUIRE(answer.extents.count(3) == 1);
        CHECK(answer.extents.at(3).contentHeight == 205);
        CHECK(answer.extents.at(3).clientHeight == 40);
        CHECK(run(engine, Commands().layout()).extents.empty());
        // Asked for: any node's, now.
        answer = run(engine, Commands().command(Command::Extent).word(1));
        CHECK(answer.extents.at(1).contentHeight == 100);
    }

    TEST_CASE("misuse is reported: unknown nodes, cycles, children of text")
    {
        wasm::Engine engine;
        Commands commands;
        commands.create(3).create(4, NodeKind::Text).insert(9, 3).insert(3, 3).insert(4, 3).create(3).layout();
        const Answer answer = run(engine, commands);
        REQUIRE(answer.errors.size() == 4);
        CHECK(answer.errors[0] == std::pair<std::uint32_t, std::string>(2, "unknown node 9"));
        CHECK(answer.errors[1].first == 3);
        CHECK(answer.errors[2].first == 4);
        CHECK(answer.errors[3].second == "handle 3 is in use");
        CHECK(answer.errorKinds[0] == 2);
        CHECK(run(engine, Commands().create(2)).errors.at(0).second == "handle 2 is in use");
    }

    TEST_CASE("a truncated batch stops where it can no longer be read")
    {
        wasm::Engine engine;
        Commands commands;
        commands.create(3).command(Command::Insert).word(1);
        const Answer answer = run(engine, commands);
        REQUIRE(answer.errors.size() == 1);
        CHECK(answer.errors[0].second == "truncated command buffer");
        CHECK(engine.nodeCount() == 3);
    }

    TEST_CASE("released nodes free their handles; their children live on, detached")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(100, 100).create(3).create(4).insert(1, 3).insert(3, 4).layout();
        run(engine, commands);
        CHECK(engine.nodeCount() == 4);
        Answer answer = run(engine, Commands().release(3).layout());
        CHECK(answer.errors.empty());
        CHECK(engine.nodeCount() == 3);
        CHECK(engine.surface().find(engine.surface().root().id())->children().empty());

        // The handle is free again, for a node of any type.
        answer = run(engine, Commands().create(3, NodeKind::Text).insert(1, 3).setText(3, "hi").layout());
        CHECK(answer.errors.empty());
        CHECK(answer.texts.count(3) == 1);
        CHECK(run(engine, Commands().release(1)).errors.at(0).second == "a root cannot be released");
    }

    TEST_CASE("text is wrapped by the engine; its lines are in UTF-16 offsets")
    {
        // The approximation: every character 0.55 em wide, lines 1.2 em high.
        wasm::Engine engine;
        Commands commands;
        commands.size(200, 100)
            .create(3, NodeKind::Text)
            .style(
                3,
                { { "fontSize", 10.0 }, { "width", 60.0 }, { "padding", 5.0 }, { "textAlign", std::string("center") } })
            .setText(3, "h\xC3\xA9llo \xF0\x9F\x8E\xB5 world")
            .insert(1, 3)
            .layout();
        const Answer answer = run(engine, commands);
        REQUIRE(answer.texts.count(3) == 1);
        const std::vector<Line>& lines = answer.texts.at(3);
        REQUIRE(lines.size() == 2);
        // "héllo 🎵" is 7 characters, 8 UTF-16 units; " " is no line's.
        CHECK(lines[0].start == 0);
        CHECK(lines[0].end == 8);
        CHECK(lines[0].width == doctest::Approx(7 * 5.5));
        CHECK(lines[1].start == 9);
        CHECK(lines[1].end == 14);
        CHECK(lines[1].y == doctest::Approx(5 + 12));
        CHECK(lines[1].height == doctest::Approx(12));
        // Centered in the 50 wide content box.
        CHECK(lines[1].x == doctest::Approx(5 + (50 - 5 * 5.5) / 2));
        CHECK(answer.frames.at(3).height == doctest::Approx(2 * 12 + 10));

        // Wider: one line, reported again.
        const Answer wider = run(engine, Commands().style(3, { { "fontSize", 10.0 } }).layout());
        REQUIRE(wider.texts.count(3) == 1);
        CHECK(wider.texts.at(3).size() == 1);
    }

    TEST_CASE("SVG scenes need Skia: the engine's own SVG nodes cannot have one")
    {
        wasm::Engine engine;
        const ui::NodeId svg = engine.surface().createNode(ui::NodeType::Svg);
        CHECK_THROWS_AS(engine.surface().setSvgScene(svg, ui::SvgScene {}), std::invalid_argument);
        CHECK(engine.surface().find(svg)->svgScene() == nullptr);
    }
}
