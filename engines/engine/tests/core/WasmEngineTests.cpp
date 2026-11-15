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

        Commands& create(std::uint32_t handle, bool text = false)
        {
            return command(Command::Create).word(handle).word(text ? 1 : 0);
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

TEST_SUITE("wasm engine")
{
    TEST_CASE("creates nodes, lays them out and reports their frames")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(300, 200)
            .create(2)
            .create(3)
            .style(1, { { "flexDirection", std::string("row") }, { "padding", 10.0 }, { "gap", 5.0 } })
            .style(2, { { "width", 100.0 } })
            .style(3, { { "flex", 1.0 } })
            .insert(1, 2)
            .insert(1, 3)
            .layout();
        const Answer answer = run(engine, commands);
        CHECK(answer.errors.empty());
        REQUIRE(answer.frames.size() == 3);
        checkBox(answer.frames.at(1), 0, 0, 300, 200);
        checkBox(answer.frames.at(2), 10, 10, 100, 180);
        checkBox(answer.frames.at(3), 115, 10, 175, 180);
        CHECK(engine.nodeCount() == 3);
    }

    TEST_CASE("reports only what changed")
    {
        wasm::Engine engine;
        Commands first;
        first.size(100, 100).create(2).style(2, { { "height", 10.0 } }).insert(1, 2).layout();
        CHECK(run(engine, first).frames.size() == 2);
        CHECK(run(engine, Commands().layout()).empty());

        const Answer resized = run(engine, Commands().size(50, 100).layout());
        REQUIRE(resized.frames.size() == 2);
        checkBox(resized.frames.at(1), 0, 0, 50, 100);
        checkBox(resized.frames.at(2), 0, 0, 50, 10);
    }

    TEST_CASE("children are inserted before others, moved and removed")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(100, 100);
        for (std::uint32_t handle = 2; handle <= 4; ++handle)
            commands.create(handle).style(handle, { { "height", 10.0 } });
        commands.insert(1, 2).insert(1, 3).insert(1, 4, 2).layout();
        Answer answer = run(engine, commands);
        CHECK(answer.frames.at(4).y == 0);
        CHECK(answer.frames.at(2).y == 10);
        CHECK(answer.frames.at(3).y == 20);

        // Moved to the end: inserting again moves it.
        answer = run(engine, Commands().insert(1, 4).layout());
        CHECK(answer.frames.at(2).y == 0);
        CHECK(answer.frames.at(3).y == 10);
        CHECK(answer.frames.at(4).y == 20);

        answer = run(engine, Commands().remove(1, 2).layout());
        CHECK(answer.frames.at(3).y == 0);
        CHECK(answer.frames.at(4).y == 10);
        CHECK(answer.frames.count(2) == 0); // detached: not reported
    }

    TEST_CASE("borders: frames are relative to the parent's border box, elements to its padding box")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(100, 100)
            .create(2)
            .create(3)
            .style(2, { { "borderWidth", 4.0 }, { "borderLeftWidth", 6.0 }, { "padding", 2.0 } })
            .style(3, { { "height", 10.0 } })
            .insert(1, 2)
            .insert(2, 3)
            .layout();
        const Answer answer = run(engine, commands);
        const Frame& parent = answer.frames.at(2);
        CHECK(parent.border[0] == 4);
        CHECK(parent.border[1] == 4);
        CHECK(parent.border[2] == 4);
        CHECK(parent.border[3] == 6);
        const Frame& child = answer.frames.at(3);
        CHECK(child.x == 8);
        CHECK(child.y == 6);
        CHECK(child.left == 2);
        CHECK(child.top == 2);
    }

    TEST_CASE("an invalid style is reported and skipped; the rest of the batch runs")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(100, 100)
            .create(2)
            .style(2, { { "height", 20.0 } })
            .insert(1, 2)
            .style(2, { { "height", std::string("tall") } })
            .style(2, { { "width", 30.0 }, { "flexDirection", std::string("sideways") } })
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
        checkBox(answer.frames.at(2), 0, 0, 100, 20);
    }

    TEST_CASE("misuse is reported: unknown nodes, cycles, children of text")
    {
        wasm::Engine engine;
        Commands commands;
        commands.create(2).create(3, true).insert(9, 2).insert(2, 2).insert(3, 2).create(2).layout();
        const Answer answer = run(engine, commands);
        REQUIRE(answer.errors.size() == 4);
        CHECK(answer.errors[0] == std::pair<std::uint32_t, std::string>(2, "unknown node 9"));
        CHECK(answer.errors[1].first == 3);
        CHECK(answer.errors[2].first == 4);
        CHECK(answer.errors[3].second == "handle 2 is in use");
        CHECK(answer.errorKinds[0] == 2);
    }

    TEST_CASE("a truncated batch stops where it can no longer be read")
    {
        wasm::Engine engine;
        Commands commands;
        commands.create(2).command(Command::Insert).word(1);
        const Answer answer = run(engine, commands);
        REQUIRE(answer.errors.size() == 1);
        CHECK(answer.errors[0].second == "truncated command buffer");
        CHECK(engine.nodeCount() == 2);
    }

    TEST_CASE("released nodes free their handles; their children live on, detached")
    {
        wasm::Engine engine;
        Commands commands;
        commands.size(100, 100).create(2).create(3).insert(1, 2).insert(2, 3).layout();
        run(engine, commands);
        CHECK(engine.nodeCount() == 3);
        Answer answer = run(engine, Commands().release(2).layout());
        CHECK(answer.errors.empty());
        CHECK(engine.nodeCount() == 2);
        CHECK(engine.surface().find(engine.surface().root().id())->children().empty());

        // The handle is free again, for a node of any type.
        answer = run(engine, Commands().create(2, true).insert(1, 2).setText(2, "hi").layout());
        CHECK(answer.errors.empty());
        CHECK(answer.texts.count(2) == 1);
        CHECK(run(engine, Commands().release(1)).errors.at(0).second == "the root cannot be released");
    }

    TEST_CASE("text is wrapped by the engine; its lines are in UTF-16 offsets")
    {
        // The approximation: every character 0.55 em wide, lines 1.2 em high.
        wasm::Engine engine;
        Commands commands;
        commands.size(200, 100)
            .create(2, true)
            .style(
                2,
                { { "fontSize", 10.0 }, { "width", 60.0 }, { "padding", 5.0 }, { "textAlign", std::string("center") } })
            .setText(2, "h\xC3\xA9llo \xF0\x9F\x8E\xB5 world")
            .insert(1, 2)
            .layout();
        const Answer answer = run(engine, commands);
        REQUIRE(answer.texts.count(2) == 1);
        const std::vector<Line>& lines = answer.texts.at(2);
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
        CHECK(answer.frames.at(2).height == doctest::Approx(2 * 12 + 10));

        // Wider: one line, reported again.
        const Answer wider = run(engine, Commands().style(2, { { "fontSize", 10.0 } }).layout());
        REQUIRE(wider.texts.count(2) == 1);
        CHECK(wider.texts.at(2).size() == 1);
    }

    TEST_CASE("SVG needs Skia: setting a scene fails without changing the node")
    {
        wasm::Engine engine;
        const ui::NodeId svg = engine.surface().createNode(ui::NodeType::Svg);
        CHECK_THROWS_AS(engine.surface().setSvgScene(svg, ui::SvgScene {}), std::invalid_argument);
        CHECK(engine.surface().find(svg)->svgScene() == nullptr);
    }
}
