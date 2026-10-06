#include "../web/WebTestSupport.h"
#include "ui/Color.h"

#include <chrono>
#include <string>

using namespace soundor;
using test::WebFixture;

namespace
{
    constexpr const char* imports =
        "import { root, createView, createTextInput, createScrollView, pressable, clipboard } from 'soundor:ui';\n";

    RuntimeHost::Options approximateText()
    {
        RuntimeHost::Options options;
        options.textEngine = ui::approximateTextEngine(); // 0.55 em per character
        return options;
    }

    ui::KeyInput key(std::string name, ui::Modifiers modifiers = 0)
    {
        return { .down = true, .key = std::move(name), .repeat = false, .modifiers = modifiers };
    }

    ui::PointerInput pointer(ui::PointerInput::Phase phase, float x, float y, unsigned buttons, int button)
    {
        ui::PointerInput input;
        input.phase = phase;
        input.position = { x, y };
        input.buttons = buttons;
        input.button = button;
        return input;
    }

    // A focused 200×20 input at the top left, font size 20 (11 px per
    // character), with its events logged.
    struct InputFixture : WebFixture
    {
        InputFixture() : WebFixture(approximateText())
        {
            host.surface().setSize({ 300, 100 });
            run(std::string(imports) + R"(
                globalThis.log = [];
                globalThis.input = createTextInput({ placeholder: 'Name', style: { width: 200, fontSize: 20 } });
                root.style = { alignItems: 'flex-start' };
                root.appendChild(input);
                input.addEventListener('input', (e) => log.push(e.inputType + ':' + (e.data ?? '')));
                input.addEventListener('change', () => log.push('change:' + input.value));
                input.focus();
            )");
        }

        void type(const std::string& text)
        {
            for (char c : text)
            {
                const std::string character(1, c);
                if (! host.surface().key(key(character)))
                    host.surface().text({ character });
            }
        }

        std::string state()
        {
            return eval("JSON.stringify([input.value, input.selectionStart, input.selectionEnd])").asString();
        }

        std::string log() { return eval("log.splice(0).join(' ')").asString(); }
    };
} // namespace

TEST_SUITE("soundor:ui text input")
{
    TEST_CASE("typing inserts at the caret and reports input")
    {
        InputFixture f;
        f.type("hello");
        CHECK(f.state() == R"(["hello",5,5])");
        CHECK(f.log() == "insertText:h insertText:e insertText:l insertText:l insertText:o");
        CHECK(f.host.surface().key(key("ArrowLeft")));
        CHECK(f.host.surface().key(key("ArrowLeft")));
        f.type("!");
        CHECK(f.state() == R"(["hel!lo",4,4])");
    }

    TEST_CASE("Backspace, Delete, Home, End and word-wise editing")
    {
        InputFixture f;
        f.type("one two three");
        f.host.surface().key(key("Backspace", ui::Modifier::Control));
        CHECK(f.state() == R"(["one two ",8,8])");
        f.host.surface().key(key("Home"));
        f.host.surface().key(key("Delete"));
        CHECK(f.state() == R"(["ne two ",0,0])");
        f.host.surface().key(key("ArrowRight", ui::Modifier::Control));
        CHECK(f.state() == R"(["ne two ",2,2])");
        f.host.surface().key(key("End"));
        f.host.surface().key(key("Backspace"));
        CHECK(f.state() == R"(["ne two",6,6])");
    }

    TEST_CASE("Shift extends the selection, and typing replaces it")
    {
        InputFixture f;
        f.type("abcdef");
        f.host.surface().key(key("ArrowLeft", ui::Modifier::Shift));
        f.host.surface().key(key("ArrowLeft", ui::Modifier::Shift));
        CHECK(f.state() == R"(["abcdef",4,6])");
        CHECK(f.eval("input.selectionDirection").asString() == "backward");
        f.type("X");
        CHECK(f.state() == R"(["abcdX",5,5])");
        f.host.surface().key(key("a", ui::Modifier::Control));
        CHECK(f.state() == R"(["abcdX",0,5])");
    }

    TEST_CASE("copy, cut and paste go through the clipboard")
    {
        InputFixture f;
        f.type("copy me");
        f.host.surface().key(key("a", ui::Modifier::Control));
        f.host.surface().key(key("x", ui::Modifier::Control));
        CHECK(f.state() == R"(["",0,0])");
        CHECK(f.host.surface().clipboard().readText() == "copy me");
        f.host.surface().key(key("v", ui::Modifier::Control));
        f.host.surface().key(key("v", ui::Modifier::Control));
        CHECK(f.state() == R"(["copy mecopy me",14,14])");
        f.host.surface().clipboard().writeText("line\nbreaks");
        f.host.surface().key(key("v", ui::Modifier::Control));
        CHECK(f.eval("input.value").asString() == "copy mecopy meline breaks");
        f.log();
        // The Web-shaped API reaches the same clipboard.
        f.run(std::string(imports)
              + "clipboard.writeText('async').then(() => clipboard.readText()).then((t) => { "
                "globalThis.result = t; });");
        REQUIRE(f.tickUntil("globalThis.result === 'async'"));
    }

    TEST_CASE("change on Enter and on blur, once per new value")
    {
        InputFixture f;
        f.type("a");
        f.log();
        f.host.surface().key(key("Enter"));
        f.host.surface().key(key("Enter"));
        CHECK(f.log() == "change:a");
        f.type("b");
        f.run(std::string(imports) + "input.blur();");
        CHECK(f.log() == "insertText:b change:ab");
    }

    TEST_CASE("listeners can take over: preventDefault stops the edit")
    {
        InputFixture f;
        f.run(std::string(imports) + R"(
            input.addEventListener('keydown', (e) => { if (e.key === 'x') e.preventDefault(); });
            input.addEventListener('beforeinput', (e) => { if (e.data === 'y') e.preventDefault(); });
        )");
        f.type("axyb");
        CHECK(f.eval("input.value").asString() == "ab");
    }

    TEST_CASE("selection indices are UTF-16, like the Web, whatever the text")
    {
        InputFixture f;
        f.run(std::string(imports) + "input.value = 'aé😀b';");
        CHECK(f.state() == R"(["aé😀b",5,5])");
        f.host.surface().key(key("ArrowLeft"));
        f.host.surface().key(key("Backspace"));
        CHECK(f.eval("JSON.stringify([input.value, input.selectionStart])").asString() == R"(["aéb",2])");
        f.run(std::string(imports) + "input.setSelectionRange(1, 2);");
        CHECK(f.host.surface().find(f.host.surface().focused())->selection().end() == 3); // after é: 3 bytes
    }

    TEST_CASE("pressing places the caret; dragging selects; the input takes focus")
    {
        InputFixture f;
        f.run(std::string(imports) + "input.value = 'abcdefghij'; input.blur();");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 34, 10, 1, 0)); // after "abc"
        CHECK(f.eval("input.focused").asBoolean());
        CHECK(f.state() == R"(["abcdefghij",3,3])");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Move, 78, 10, 1, -1)); // after "abcdefg"
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Up, 78, 10, 0, 0));
        CHECK(f.state() == R"(["abcdefghij",3,7])");
    }

    TEST_CASE("a placeholder sizes an empty input, and only inputs have one")
    {
        InputFixture f;
        CHECK(f.run(std::string(imports) + R"(
            const auto = createTextInput({ placeholder: 'Search', style: { fontSize: 20 } });
            root.appendChild(auto);
            globalThis.result = JSON.stringify([auto.layout.width, auto.layout.height, auto.focusable]);
        )")
                  .asString()
              == "[67,24,true]");
        CHECK(f.error(std::string(imports) + "createView().placeholder = 'x';")
              == "TypeError: placeholder belongs to input nodes");
    }
}

TEST_SUITE("soundor:ui scrolling, frames and presses")
{
    TEST_CASE("the wheel scrolls the nearest scroll view, unless prevented")
    {
        WebFixture f(approximateText());
        f.host.surface().setSize({ 100, 100 });
        f.run(std::string(imports) + R"(
            globalThis.log = [];
            globalThis.scroller = createScrollView({ height: 50 });
            const inner = createView({ height: 200 });
            scroller.appendChild(inner);
            root.appendChild(scroller);
            scroller.addEventListener('scroll', () => log.push('scroll ' + scroller.scrollTop));
        )");
        CHECK(f.host.surface().wheel({ .position = { 10, 10 }, .deltaY = 1, .unit = ui::WheelInput::Unit::Line }));
        CHECK(f.eval("log.join()").asString() == "scroll 40");
        CHECK(f.host.surface().wheel({ .position = { 10, 10 }, .deltaY = 500 }));
        CHECK(f.eval("scroller.scrollTop").asNumber() == 150);
        // At the end: nothing to scroll, so the host may have the wheel.
        CHECK_FALSE(f.host.surface().wheel({ .position = { 10, 10 }, .deltaY = 10 }));
        f.run(std::string(imports) + "scroller.addEventListener('wheel', (e) => e.preventDefault());");
        CHECK(f.host.surface().wheel({ .position = { 10, 10 }, .deltaY = -10 }));
        CHECK(f.eval("scroller.scrollTop").asNumber() == 150);
        // Pointer targets follow the scrolled content.
        CHECK(f.host.surface().hitTest({ 10, 10 }) != f.host.surface().root().id());
    }

    TEST_CASE("requestAnimationFrame runs once per frame, before drawing")
    {
        WebFixture f;
        f.run(R"(
            globalThis.frames = [];
            const tick = (time) => { frames.push(typeof time); if (frames.length < 3) requestAnimationFrame(tick); };
            requestAnimationFrame(tick);
            const cancelled = requestAnimationFrame(() => frames.push('cancelled'));
            cancelAnimationFrame(cancelled);
        )");
        CHECK(f.eval("frames.length").asNumber() == 0);
        f.host.tick();
        CHECK(f.eval("frames.join()").asString() == "number");
        f.host.tick();
        f.host.tick();
        f.host.tick();
        CHECK(f.eval("frames.join()").asString() == "number,number,number");
    }

    TEST_CASE("pressable reports presses from the pointer and the keyboard")
    {
        WebFixture f(approximateText());
        f.host.surface().setSize({ 100, 100 });
        f.run(std::string(imports) + R"(
            globalThis.log = [];
            globalThis.button = createView({ width: 50, height: 50 });
            root.appendChild(button);
            globalThis.stop = pressable(button, {
              onPress: (e) => log.push('press:' + e.type),
              onStateChange: ({ pressed, hovered, focused }) =>
                log.push((pressed ? 'P' : 'p') + (hovered ? 'H' : 'h') + (focused ? 'F' : 'f')),
            });
        )");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 10, 10, 1, 0));
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Up, 10, 10, 0, 0));
        CHECK(f.eval("log.splice(0).join(' ')").asString() == "pHf PHf PHF pHF press:click");
        CHECK(f.eval("button.focused").asBoolean());
        CHECK(f.host.surface().key(key("Enter")));
        CHECK(f.eval("log.splice(0).join(' ')").asString() == "press:keydown");
        f.run(std::string(imports) + "stop();");
        CHECK_FALSE(f.host.surface().key(key("Enter")));
    }
}

TEST_SUITE("soundor:ui pressable")
{
    // A 50×50 pressable at the top left with a 30 ms long press, logged.
    struct PressFixture : WebFixture
    {
        PressFixture() : WebFixture(approximateText())
        {
            host.surface().setSize({ 100, 100 });
            run(std::string(imports) + R"(
                globalThis.log = [];
                globalThis.button = createView({ width: 50, height: 50 });
                root.appendChild(button);
                globalThis.stop = pressable(button, {
                  delayLongPress: 30,
                  onPress: (e) => log.push('press'),
                  onLongPress: (e) => log.push('long:' + e.type + '@' + e.locationX),
                  onPressOut: () => log.push('out'),
                });
            )");
        }

        void press(ui::PointerInput::Phase phase, float x, float y, unsigned buttons = 1, int button = 0)
        {
            host.surface().pointer(pointer(phase, x, y, buttons, button));
        }

        std::string log() { return eval("log.splice(0).join(' ')").asString(); }
    };

    TEST_CASE("holding the primary button is a long press, and then not a press")
    {
        PressFixture f;
        f.press(ui::PointerInput::Phase::Down, 10, 10);
        CHECK(f.tickUntil("log.length > 0"));
        CHECK(f.log() == "long:pointerdown@10");
        // Held further, with the pointer captured outside: no second one.
        f.press(ui::PointerInput::Phase::Move, 15, 12);
        f.tickFor(std::chrono::milliseconds(60));
        f.press(ui::PointerInput::Phase::Up, 12, 12, 0, 0);
        CHECK(f.log() == "out");
        // The next press is an ordinary one again.
        f.press(ui::PointerInput::Phase::Down, 10, 10);
        f.press(ui::PointerInput::Phase::Up, 10, 10, 0, 0);
        CHECK(f.log() == "out press");
    }

    TEST_CASE("a short press, a cancel, moving away or another button is no long press")
    {
        PressFixture f;
        f.press(ui::PointerInput::Phase::Down, 10, 10);
        f.press(ui::PointerInput::Phase::Up, 10, 10, 0, 0);
        f.tickFor(std::chrono::milliseconds(60));
        CHECK(f.log() == "out press");

        f.press(ui::PointerInput::Phase::Down, 10, 10);
        f.press(ui::PointerInput::Phase::Cancel, 10, 10, 0, -1);
        f.tickFor(std::chrono::milliseconds(60));
        CHECK(f.log() == "out");

        // Captured: the drag still reaches the node, which gives up the long press.
        f.press(ui::PointerInput::Phase::Down, 10, 10);
        f.press(ui::PointerInput::Phase::Move, 80, 10);
        f.tickFor(std::chrono::milliseconds(60));
        f.press(ui::PointerInput::Phase::Up, 80, 10, 0, 0);
        CHECK(f.log() == "out");

        f.press(ui::PointerInput::Phase::Down, 10, 10, 2, 2);
        f.tickFor(std::chrono::milliseconds(60));
        f.press(ui::PointerInput::Phase::Up, 10, 10, 0, 2);
        CHECK(f.log().empty());
    }

    TEST_CASE("undoing pressable, mid-press, stops the long press")
    {
        PressFixture f;
        f.press(ui::PointerInput::Phase::Down, 10, 10);
        f.run(std::string(imports) + "stop();");
        f.tickFor(std::chrono::milliseconds(60));
        CHECK(f.log().empty());
    }

    TEST_CASE("the state follows focus and blur")
    {
        PressFixture f;
        f.run(std::string(imports) + R"(
            stop();
            globalThis.states = [];
            const other = createView();
            other.focusable = true;
            root.appendChild(other);
            pressable(button, { onStateChange: (state) => states.push(JSON.stringify(state)) });
            button.focus();
            other.focus();
            globalThis.result = states.join(' ');
        )");
        CHECK(f.eval("result").asString()
              == R"({"pressed":false,"hovered":false,"focused":true} )"
                 R"({"pressed":false,"hovered":false,"focused":false})");
    }
}

TEST_SUITE("CSS colors")
{
    TEST_CASE("hex, rgb(), hsl(), names and transparent")
    {
        using ui::Color;
        CHECK(ui::parseColor("#f00") == Color { 255, 0, 0, 255 });
        CHECK(ui::parseColor("#FF000080") == Color { 255, 0, 0, 128 });
        CHECK(ui::parseColor("#1234") == Color { 0x11, 0x22, 0x33, 0x44 });
        CHECK(ui::parseColor("rgb(0, 128, 255)") == Color { 0, 128, 255, 255 });
        CHECK(ui::parseColor("rgba(0,0,0,0.5)") == Color { 0, 0, 0, 128 });
        CHECK(ui::parseColor("rgba(0,0,0,.5)") == Color { 0, 0, 0, 128 });
        CHECK(ui::parseColor("rgb(2.55e2, -10, +20)") == Color { 255, 0, 20, 255 });
        CHECK(ui::parseColor("rgb(100% 0% 0% / 50%)") == Color { 255, 0, 0, 128 });
        CHECK(ui::parseColor("hsl(120, 100%, 50%)") == Color { 0, 255, 0, 255 });
        CHECK(ui::parseColor("hsl(240deg 100% 50% / 0.25)") == Color { 0, 0, 255, 64 });
        CHECK(ui::parseColor("RebeccaPurple") == Color { 0x66, 0x33, 0x99, 255 });
        CHECK(ui::parseColor("transparent") == Color {});
        for (const char* invalid : { "", "#12", "#123456789", "#ggg", "rgb(1,2)", "hsl(1, 2, 3)", "notacolor",
                                     "rgb(a,b,c)", "rgb(1.,,2,3)", "rgb(1e,2,3)", "rgb(-,2,3)" })
            CHECK_MESSAGE(! ui::parseColor(invalid), invalid);
    }

    TEST_CASE("invalid colors in styles are TypeErrors naming the property")
    {
        WebFixture f;
        CHECK(f.error("import { createView } from 'soundor:ui'; createView({ backgroundColor: 'reddish' });")
              == "TypeError: style.backgroundColor: expected a CSS color, got 'reddish'");
    }
}
