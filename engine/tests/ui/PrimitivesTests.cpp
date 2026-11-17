#include "../web/WebTestSupport.h"
#include "ui/Color.h"

#include <chrono>
#include <string>

using namespace soundor;
using test::WebFixture;

namespace
{
    constexpr const char* imports =
        "import { root, createView, createTextInput, pressable, clipboard } from 'soundor:ui';\n";

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
            globalThis.scroller = createView({ overflow: 'scroll', height: 50 });
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

    TEST_CASE("the wheel with Control is a zoom: plugin code gets it, and nothing scrolls")
    {
        WebFixture f(approximateText());
        f.host.surface().setSize({ 100, 100 });
        f.run(std::string(imports) + R"(
            globalThis.log = [];
            globalThis.scroller = createView({ overflow: 'scroll', height: 50 });
            scroller.appendChild(createView({ height: 200 }));
            root.appendChild(scroller);
            scroller.addEventListener('wheel', (e) => log.push('wheel ' + e.ctrlKey + ' ' + e.deltaY));
        )");
        const ui::WheelInput pinch { .position = { 10, 10 }, .deltaY = 40, .modifiers = ui::Modifier::Control };
        // Not handled: the host may have it.
        CHECK_FALSE(f.host.surface().wheel(pinch));
        CHECK(f.eval("log.join()").asString() == "wheel true 40");
        CHECK(f.eval("scroller.scrollTop").asNumber() == 0);
        // Plugin code that takes it, to zoom something of its own, says so.
        f.run(std::string(imports) + "scroller.addEventListener('wheel', (e) => e.preventDefault());");
        CHECK(f.host.surface().wheel(pinch));
        CHECK(f.eval("scroller.scrollTop").asNumber() == 0);
    }

    TEST_CASE("scrolling from code fires scroll on the next tick, once, before the frame's callbacks")
    {
        WebFixture f(approximateText());
        f.host.surface().setSize({ 100, 100 });
        f.run(std::string(imports) + R"(
            globalThis.log = [];
            globalThis.scroller = createView({ overflow: 'scroll', height: 50 });
            scroller.appendChild(createView({ height: 200 }));
            root.appendChild(scroller);
            scroller.addEventListener('scroll', () => log.push('scroll ' + scroller.scrollTop));
            requestAnimationFrame(() => log.push('frame'));
            scroller.scrollTop = 20;
            scroller.scrollTo({ top: 30 });
            scroller.scrollBy({ top: 10 });
            log.push('after');
        )");
        CHECK(f.eval("log.join()").asString() == "after");
        f.host.tick();
        CHECK(f.eval("log.join()").asString() == "after,scroll 40,frame");
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 3);
        // Where it already is: it did not move.
        f.run(std::string(imports) + "scroller.scrollTop = 40;");
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 3);
        // Taken away before it could be told.
        f.run(std::string(imports) + "scroller.scrollTop = 0; scroller.remove();");
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 3);
    }

    TEST_CASE("a view scrolls the axes its style says, and nothing else does")
    {
        WebFixture f(approximateText());
        f.host.surface().setSize({ 100, 100 });
        f.run(std::string(imports) + R"(
            globalThis.log = [];
            globalThis.list = createView({ overflowY: 'scroll', height: 50, width: 50 });
            list.appendChild(createView({ height: 200, width: 300, flexShrink: 0 }));
            root.appendChild(list);
            list.addEventListener('scroll', () => log.push('scroll ' + list.scrollLeft + ' ' + list.scrollTop));
            list.scrollTo({ left: 50, top: 30 });
        )");
        CHECK(f.eval("list.scrollLeft").asNumber() == 0);
        CHECK(f.eval("list.scrollTop").asNumber() == 30);
        // Sideways it does not scroll, so the host may have that wheel.
        CHECK_FALSE(f.host.surface().wheel({ .position = { 10, 10 }, .deltaX = 20 }));
        CHECK(f.host.surface().wheel({ .position = { 10, 10 }, .deltaY = 20 }));
        CHECK(f.eval("list.scrollTop").asNumber() == 50);
        // The axis over the shorthand, whatever the order.
        f.run(std::string(imports)
              + "list.style = { overflowX: 'hidden', overflow: 'scroll', height: 50, width: 50 };"
                "list.scrollTo({ left: 50 });");
        CHECK(f.eval("list.scrollLeft").asNumber() == 0);
        // A view that does not scroll, and a node that cannot: nothing moves,
        // nothing throws, as in browsers.
        f.run(std::string(imports) + R"(
            globalThis.plain = createView({ height: 50 });
            plain.appendChild(createView({ height: 200 }));
            root.appendChild(plain);
            plain.scrollTo(0, 40);
            plain.scrollTop = 40;
            globalThis.input = createTextInput({ style: { overflow: 'scroll' } });
            input.scrollTo(0, 40);
        )");
        CHECK(f.eval("plain.scrollTop").asNumber() == 0);
        CHECK(f.eval("input.scrollTop").asNumber() == 0);
    }

    TEST_CASE("a view that stops scrolling goes back to its start, and says so")
    {
        WebFixture f(approximateText());
        f.host.surface().setSize({ 100, 100 });
        f.run(std::string(imports) + R"(
            globalThis.log = [];
            globalThis.list = createView({ overflow: 'scroll', height: 50 });
            list.appendChild(createView({ height: 200 }));
            root.appendChild(list);
            list.scrollTop = 40;
            list.addEventListener('scroll', () => log.push('scroll ' + list.scrollTop));
        )");
        f.host.tick();
        CHECK(f.eval("log.join()").asString() == "scroll 40");
        f.run(std::string(imports) + "list.style = { overflow: 'hidden', height: 50 };");
        CHECK(f.eval("list.scrollTop").asNumber() == 0);
        f.host.tick();
        CHECK(f.eval("log.join()").asString() == "scroll 40,scroll 0");
        // And it scrolls again from there.
        f.run(std::string(imports) + "list.style = { overflow: 'scroll', height: 50 }; list.scrollTop = 10;");
        CHECK(f.eval("list.scrollTop").asNumber() == 10);
    }

    TEST_CASE("a smooth scroll moves frame by frame, and a wheel stops it")
    {
        WebFixture f(approximateText());
        double time = 0;
        f.host.surface().animations().setClock([&time] { return time; });
        f.host.surface().setSize({ 100, 100 });
        f.run(std::string(imports) + R"(
            globalThis.log = [];
            globalThis.list = createView({ overflow: 'scroll', height: 50 });
            list.appendChild(createView({ height: 400 }));
            root.appendChild(list);
            list.addEventListener('scroll', () => log.push(Math.round(list.scrollTop)));
            list.scrollTo({ top: 200, behavior: 'smooth' });
        )");
        // Not yet: it starts on the next frame.
        CHECK(f.eval("list.scrollTop").asNumber() == 0);
        time = ui::smoothScrollMilliseconds / 2;
        f.host.tick();
        // Eased in and out: halfway at half the time.
        CHECK(f.eval("list.scrollTop").asNumber() == doctest::Approx(100));
        time = ui::smoothScrollMilliseconds;
        f.host.tick();
        CHECK(f.eval("list.scrollTop").asNumber() == 200);
        CHECK(f.eval("log.join()").asString() == "100,200");
        time += 100;
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 2);

        // scrollBy goes from where it is; a wheel stops it there.
        f.run(std::string(imports) + "list.scrollBy({ top: 100, behavior: 'smooth' });");
        time += ui::smoothScrollMilliseconds / 2;
        f.host.tick();
        CHECK(f.eval("list.scrollTop").asNumber() == doctest::Approx(250));
        CHECK(f.host.surface().wheel({ .position = { 10, 10 }, .deltaY = 10 }));
        time += ui::smoothScrollMilliseconds;
        f.host.tick();
        CHECK(f.eval("list.scrollTop").asNumber() == doctest::Approx(260));

        // An instant scroll stops it too.
        f.run(std::string(imports) + "list.scrollTo({ top: 0, behavior: 'smooth' }); list.scrollTop = 300;");
        time += ui::smoothScrollMilliseconds;
        f.host.tick();
        CHECK(f.eval("list.scrollTop").asNumber() == 300);

        // With reduced motion asked for, it is there at once.
        f.host.surface().animations().setReducedMotion(true);
        f.run(std::string(imports) + "list.scrollTo({ top: 10, behavior: 'smooth' });");
        CHECK(f.eval("list.scrollTop").asNumber() == 10);
        f.host.surface().animations().setReducedMotion(false);

        CHECK(f.eval(R"((() => { try { list.scrollTo({ top: 0, behavior: 'fast' }); return 'none'; }
                                 catch (e) { return e.constructor.name; } })())")
                  .asString()
              == "TypeError");
    }

    TEST_CASE("scrollIntoView aligns a node in each view around it that scrolls")
    {
        WebFixture f(approximateText());
        f.host.surface().setSize({ 200, 200 });
        f.run(std::string(imports) + R"(
            globalThis.list = createView({ overflowY: 'scroll', height: 50, padding: 5 });
            globalThis.items = [];
            for (let i = 0; i < 10; ++i) {
              const item = createView({ height: 20, flexShrink: 0 });
              items.push(item);
              list.appendChild(item);
            }
            root.appendChild(list);
            globalThis.at = (call) => { call(); return list.scrollTop; };
        )");
        // The item at 100 (105 with the padding) in a view 40 high inside it.
        CHECK(f.eval("at(() => items[5].scrollIntoView())").asNumber() == 100);
        CHECK(f.eval("at(() => items[5].scrollIntoView(false))").asNumber() == 80);
        CHECK(f.eval("at(() => items[5].scrollIntoView({ block: 'center' }))").asNumber() == 90);
        // Nearest: already showing, it stays; above, to the start; below, to the end.
        CHECK(f.eval("at(() => items[5].scrollIntoView({ block: 'nearest' }))").asNumber() == 90);
        CHECK(f.eval("at(() => items[1].scrollIntoView({ block: 'nearest' }))").asNumber() == 20);
        CHECK(f.eval("at(() => items[8].scrollIntoView({ block: 'nearest' }))").asNumber() == 140);
        // Clamped to the content: 200 and the padding below it, 40 showing.
        CHECK(f.eval("at(() => items[9].scrollIntoView())").asNumber() == 165);
        CHECK(f.eval("at(() => items[0].scrollIntoView())").asNumber() == 0);

        // Nested: the outer view brings in where the inner one put it.
        f.run(std::string(imports) + R"(
            globalThis.outer = createView({ overflowY: 'scroll', height: 100 });
            outer.appendChild(createView({ height: 300, flexShrink: 0 }));
            list.remove();
            outer.appendChild(list);
            root.appendChild(outer);
            items[9].scrollIntoView({ block: 'end' });
        )");
        CHECK(f.eval("list.scrollTop").asNumber() == 160);
        // There the item ends 345 down the outer view's content.
        CHECK(f.eval("outer.scrollTop").asNumber() == 245);
        CHECK(f.eval(R"((() => { try { items[0].scrollIntoView({ block: 'top' }); return 'none'; }
                                 catch (e) { return e.constructor.name; } })())")
                  .asString()
              == "TypeError");
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
              onStateChange: ({ pressed, hovered, focused, focusVisible }) =>
                log.push((pressed ? 'P' : 'p') + (hovered ? 'H' : 'h') + (focused ? 'F' : 'f') +
                         (focusVisible ? 'V' : 'v')),
            });
        )");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 10, 10, 1, 0));
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Up, 10, 10, 0, 0));
        CHECK(f.eval("log.splice(0).join(' ')").asString() == "pHfv PHfv PHFv pHFv press:click");
        CHECK(f.eval("button.focused").asBoolean());
        CHECK(f.host.surface().key(key("Enter")));
        // A key shows the focus a press gave.
        CHECK(f.eval("log.splice(0).join(' ')").asString() == "pHFV press:keydown");
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
              == R"({"pressed":false,"hovered":false,"focused":true,"focusVisible":true} )"
                 R"({"pressed":false,"hovered":false,"focused":false,"focusVisible":false})");
    }
}

TEST_SUITE("ResizeObserver")
{
    // Entries as `width×height` of each box, with the content box's origin.
    constexpr const char* describeEntries = R"(
        globalThis.describe = (entries) => entries.map((e) => [
          e.target.debugId,
          e.contentRect.x + ',' + e.contentRect.y + ' ' + e.contentRect.width + 'x' + e.contentRect.height,
          e.borderBoxSize[0].inlineSize + 'x' + e.borderBoxSize[0].blockSize,
          e.devicePixelContentBoxSize[0].inlineSize + 'x' + e.devicePixelContentBoxSize[0].blockSize,
        ].join(' ')).join('; ');
    )";

    TEST_CASE("tells each box's size after the frame's callbacks, and only what changed")
    {
        WebFixture f;
        f.host.surface().setSize({ 200, 200 });
        f.host.surface().setScale(1.5F);
        f.run(std::string(imports) + describeEntries + R"(
            globalThis.log = [];
            globalThis.box = createView({ width: 100, height: 40, padding: 10, borderWidth: 2 });
            box.debugId = 'box';
            globalThis.empty = createView({ width: 0, height: 0 });
            empty.debugId = 'empty';
            root.style = { alignItems: 'flex-start' };
            root.appendChild(box);
            root.appendChild(empty);
            globalThis.observer = new ResizeObserver((entries, which) => {
              log.push(describe(entries) + (which === observer ? '' : ' (another observer)'));
            });
            observer.observe(box);
            observer.observe(empty);
            requestAnimationFrame(() => log.push('frame'));
        )");
        CHECK(f.eval("log.length").asNumber() == 0);
        f.host.tick();
        // A node laid out to 0×0 is not told of at first, as in browsers.
        CHECK(f.eval("log.splice(0).join(' | ')").asString() == "frame | box 12,12 76x16 100x40 114x24");
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 0);
        f.run("box.style = { ...box.style, width: 120 }; empty.style = { width: 4, height: 4 };");
        f.host.tick();
        CHECK(f.eval("log.splice(0).join(' | ')").asString() == "box 12,12 96x16 120x40 144x24; empty 0,0 4x4 4x4 6x6");
        // A move is not a resize.
        f.run(std::string(imports) + "root.style = { alignItems: 'center' };");
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 0);
        // Taken out of the tree, it has no box.
        f.run("empty.remove();");
        f.host.tick();
        CHECK(f.eval("log.splice(0).join(' | ')").asString() == "empty 0,0 0x0 0x0 0x0");
        f.run("observer.unobserve(box); box.style = { width: 10, height: 10 };");
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 0);
        CHECK(f.logs.empty());
    }

    TEST_CASE("observes the box it is asked for, and a scale change in device pixels")
    {
        WebFixture f;
        f.host.surface().setSize({ 200, 200 });
        f.run(std::string(imports) + R"(
            globalThis.log = [];
            globalThis.box = createView({ width: 100, height: 40, padding: 10 });
            root.style = { alignItems: 'flex-start' };
            root.appendChild(box);
            const told = (name) => new ResizeObserver(() => log.push(name));
            told('content').observe(box);
            told('border').observe(box, { box: 'border-box' });
            told('device').observe(box, { box: 'device-pixel-content-box' });
        )");
        f.host.tick();
        CHECK(f.eval("log.splice(0).join()").asString() == "content,border,device");
        // Padding moves the content box, not the border box.
        f.run("box.style = { width: 100, height: 40, padding: 5 };");
        f.host.tick();
        CHECK(f.eval("log.splice(0).join()").asString() == "content,device");
        f.host.surface().setScale(2.0F);
        f.host.tick();
        CHECK(f.eval("log.splice(0).join()").asString() == "device");
    }

    TEST_CASE("tells deeper nodes a callback resized in the same frame, and shallower ones on the next")
    {
        WebFixture f;
        f.host.surface().setSize({ 200, 200 });
        f.run(std::string(imports) + R"(
            globalThis.log = [];
            globalThis.outer = createView({ width: 100, height: 100 });
            globalThis.inner = createView({ width: 50, height: 50 });
            outer.debugId = 'outer';
            inner.debugId = 'inner';
            root.style = { alignItems: 'flex-start' };
            outer.appendChild(inner);
            root.appendChild(outer);
            globalThis.observer = new ResizeObserver((entries) => {
              for (const { target, contentRect } of entries) {
                log.push(target.debugId + ' ' + contentRect.width);
                // Each resizes the other: inner is deeper, outer is not.
                if (target === outer && contentRect.width === 100) inner.style = { width: 60, height: 50 };
                if (target === inner && contentRect.width === 60) outer.style = { width: 110, height: 100 };
              }
            });
            observer.observe(outer);
            observer.observe(inner);
        )");
        f.host.tick();
        CHECK(f.eval("log.splice(0).join()").asString() == "outer 100,inner 50,inner 60");
        // Outer changed after the loop reached deeper: it waits, with an error.
        REQUIRE(f.logs.size() == 1);
        CHECK(f.logs[0].second.find("ResizeObserver loop completed with undelivered notifications.")
              != std::string::npos);
        f.host.tick();
        CHECK(f.eval("log.splice(0).join()").asString() == "outer 110");
    }

    TEST_CASE("disconnect stops it, a callback's errors are reported, and arguments are checked")
    {
        WebFixture f;
        f.host.surface().setSize({ 200, 200 });
        f.run(std::string(imports) + R"(
            globalThis.calls = 0;
            globalThis.box = createView({ width: 10, height: 10 });
            root.appendChild(box);
            globalThis.failing = new ResizeObserver(() => { ++calls; throw new Error('observer failed'); });
            failing.observe(box);
            failing.observe(box); // again: still one observation
        )");
        f.host.tick();
        CHECK(f.eval("calls").asNumber() == 1);
        REQUIRE(f.logs.size() == 1);
        CHECK(f.logs[0].second.find("observer failed") != std::string::npos);
        f.run("failing.disconnect(); box.style = { width: 20, height: 20 };");
        f.host.tick();
        CHECK(f.eval("calls").asNumber() == 1);
        CHECK(f.error("new ResizeObserver(1);").find("TypeError") != std::string::npos);
        CHECK(f.error("new ResizeObserver(() => {}).observe({});").find("not a UiNode") != std::string::npos);
        CHECK(f.error(std::string(imports) + "new ResizeObserver(() => {}).observe(root, { box: 'padding-box' });")
                  .find("not a valid box")
              != std::string::npos);
        CHECK(f.eval("typeof ResizeObserverEntry + typeof ResizeObserverSize").asString() == "functionfunction");
        CHECK_FALSE(f.eval("Object.keys(globalThis).includes('ResizeObserver')").asBoolean());
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
