#include "../web/WebTestSupport.h"

#include <string>

using namespace soundor;
using test::WebFixture;

namespace
{
    constexpr const char* imports = "import { root, createView, createText, focusedNode, viewSize, UiNode, "
                                    "PointerEvent, KeyboardEvent } from 'soundor:ui';\n";

    ui::PointerInput pointer(ui::PointerInput::Phase phase, float x, float y, unsigned buttons, int button)
    {
        ui::PointerInput input;
        input.phase = phase;
        input.position = { x, y };
        input.buttons = buttons;
        input.button = button;
        return input;
    }

    // A 200×100 view with two 100×100 boxes side by side (a, b) exposed as
    // globals, and an event log.
    struct UiFixture : WebFixture
    {
        UiFixture()
        {
            host.surface().setSize({ 200, 100 });
            run(std::string(imports) + R"(
                globalThis.log = [];
                const record = (event) => log.push(event.type + '@' + event.currentTarget.name +
                    (event.eventPhase === 1 ? ':capture' : event.eventPhase === 3 ? ':bubble' : ''));
                root.name = 'root';
                root.style = { flexDirection: 'row' };
                globalThis.a = createView({ width: 100, height: 100 });
                globalThis.b = createView({ width: 100, height: 100 });
                a.name = 'a';
                b.name = 'b';
                root.appendChild(a);
                root.appendChild(b);
                globalThis.record = record;
            )");
        }

        std::string log() { return eval("log.splice(0).join(' ')").asString(); }
    };
} // namespace

TEST_SUITE("soundor:ui")
{
    TEST_CASE("builds a tree that native layout follows")
    {
        UiFixture f;
        CHECK(f.run(std::string(imports) + "globalThis.result = JSON.stringify(b.layout);").asString()
              == R"({"x":100,"y":0,"width":100,"height":100})");
        f.run(std::string(imports) + R"(
            const label = createText('hi', { fontSize: 20 });
            b.style = { width: 100, height: 100, padding: 10, alignItems: 'flex-start' };
            b.appendChild(label);
            globalThis.result = JSON.stringify([label.getBoundingClientRect(), label.parent === b,
                                                b.children.length, label.isConnected, label.type]);
        )");
        CHECK(f.eval("result").asString() == R"([{"x":110,"y":10,"width":22,"height":24},true,1,true,"text"])");
        CHECK(f.host.surface().hitTest({ 115, 15 }) != ui::noNode);
    }

    TEST_CASE("mirrors moves, removals and siblings")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            const c = createView();
            root.insertBefore(c, b);
            const names = () => root.children.map((n) => n.name ?? 'c').join(',');
            const steps = [names()];
            root.appendChild(a);
            steps.push(names(), a.previousSibling === b, root.firstChild === c, root.lastChild === a);
            b.appendChild(a);
            steps.push(names(), root.contains(a), a.parent === b);
            a.remove();
            steps.push(b.children.length, a.parent, a.isConnected);
            globalThis.result = JSON.stringify(steps);
        )");
        CHECK(f.eval("result").asString() == R"(["a,c,b","c,b,a",true,true,true,"c,b",true,true,0,null,false])");
    }

    TEST_CASE("rejects invalid trees and styles with clear errors")
    {
        UiFixture f;
        CHECK(f.error(std::string(imports) + "a.appendChild(a);").find("cannot contain itself") != std::string::npos);
        CHECK(f.error(std::string(imports) + "createText('x').appendChild(createView());").find("text node")
              != std::string::npos);
        CHECK(f.error(std::string(imports) + "a.appendChild({});") == "TypeError: child must be a UiNode, got Object");
        CHECK(f.error(std::string(imports) + "a.style = { width: 'wide' };")
              == "TypeError: style.width: expected a number, a percentage or 'auto', got 'wide'");
        CHECK(f.error(std::string(imports) + "a.style = { flexDirection: 'sideways' };")
              == "TypeError: style.flexDirection: expected one of 'column', 'column-reverse', 'row', "
                 "'row-reverse', got 'sideways'");
        CHECK(
            f.error(std::string(imports) + "a.style = { minWidth: 'auto' };").find("expected a number or a percentage")
            != std::string::npos);
        CHECK(f.error(std::string(imports) + "a.text = 'x';") == "TypeError: only text nodes have text");
        CHECK(f.error(std::string(imports) + "new UiNode();").find("Illegal constructor") != std::string::npos);
        // The style that failed was not applied.
        CHECK(f.run(std::string(imports) + "globalThis.result = a.style.width;").asNumber() == 100);
    }

    TEST_CASE("accepts the style shorthands and keeps unknown keys")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            a.style = { flex: 1, margin: 5, marginLeft: 10, paddingHorizontal: '10%', backgroundColor: 'red' };
            globalThis.result = JSON.stringify([a.layout, a.style.backgroundColor]);
        )");
        CHECK(f.eval("result").asString() == R"([{"x":10,"y":5,"width":85,"height":90},"red"])");
    }

    TEST_CASE("events capture and bubble along the tree")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            for (const node of [root, b]) {
              for (const type of ['pointerdown', 'click', 'pointerenter'])
                node.addEventListener(type, record), node.addEventListener(type, record, true);
            }
        )");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 150, 50, 1, 0));
        CHECK(f.log()
              == "pointerenter@root pointerenter@root pointerenter@root:capture pointerenter@b pointerenter@b "
                 "pointerdown@root:capture pointerdown@b pointerdown@b pointerdown@root:bubble");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Up, 150, 50, 0, 0));
        CHECK(f.log() == "click@root:capture click@b click@b click@root:bubble");
    }

    TEST_CASE("events are trusted Web events with positions and modifiers")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            b.addEventListener('pointerdown', (e) => {
              globalThis.result = JSON.stringify([e instanceof PointerEvent, e instanceof Event, e.isTrusted,
                e.target === b, e.clientX, e.offsetX, e.offsetY, e.button, e.buttons, e.pointerType,
                e.shiftKey, e.getModifierState('Shift'), e.composedPath().length]);
            });
        )");
        auto input = pointer(ui::PointerInput::Phase::Down, 150, 40, 1, 0);
        input.modifiers = ui::Modifier::Shift;
        f.host.surface().pointer(input);
        CHECK(f.eval("result").asString() == R"([true,true,true,true,150,50,40,0,1,"mouse",true,true,2])");
    }

    TEST_CASE("stopPropagation and preventDefault reach the surface")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            root.addEventListener('keydown', record);
            b.focusable = true;
            b.addEventListener('keydown', (e) => { if (e.key === 'x') { e.stopPropagation(); e.preventDefault(); } });
            b.focus();
        )");
        CHECK(f.host.surface().key({ .down = true, .key = "x", .repeat = false, .modifiers = 0 }));
        CHECK(f.log().empty());
        CHECK_FALSE(f.host.surface().key({ .down = true, .key = "y", .repeat = false, .modifiers = 0 }));
        CHECK(f.log() == "keydown@root:bubble");
    }

    TEST_CASE("focus moves with focus(), blur() and presses, with focus and blur events")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            for (const node of [a, b]) {
              node.focusable = true;
              node.addEventListener('focus', (e) => log.push('focus@' + e.target.name +
                  '<' + (e.relatedTarget?.name ?? '-')));
              node.addEventListener('blur', (e) => log.push('blur@' + e.target.name));
            }
            a.focus();
            b.focus();
            globalThis.result = [focusedNode() === b, b.focused, a.focused].join();
            b.blur();
        )");
        CHECK(f.eval("result").asString() == "true,true,false");
        CHECK(f.log() == "focus@a<- blur@a focus@b<a blur@b");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 10, 10, 1, 0));
        CHECK(f.log() == "focus@a<-");
    }

    TEST_CASE("text input arrives as beforeinput on the focused node")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            a.focusable = true;
            a.focus();
            a.addEventListener('beforeinput', (e) => log.push(e.inputType + ':' + e.data));
        )");
        CHECK(f.host.surface().text({ "ü" }));
        CHECK(f.log() == "insertText:ü");
    }

    TEST_CASE("listener errors are reported and do not stop other listeners")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            b.addEventListener('pointerdown', () => { throw new Error('listener broke'); });
            b.addEventListener('pointerdown', () => log.push('second'));
        )");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 150, 50, 1, 0));
        CHECK(f.log() == "second");
        bool reported = false;
        for (const auto& [level, message] : f.logs)
            reported = reported || message.find("listener broke") != std::string::npos;
        CHECK(reported);
    }

    TEST_CASE("unreachable detached nodes are released natively")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            for (let i = 0; i < 100; ++i) createView().appendChild(createText('garbage'));
            globalThis.kept = createView();
        )");
        f.host.runtime().collectGarbage();
        f.host.tick(); // finalization callbacks run as jobs
        f.host.runtime().collectGarbage();
        f.host.tick();
        // Root, a, b and kept remain.
        std::size_t alive = 0;
        for (ui::NodeId id = 1; id < 400; ++id)
            alive += f.host.surface().find(id) != nullptr ? 1U : 0U;
        CHECK(alive == 4);
    }

    TEST_CASE("a new runtime starts with a new, empty surface")
    {
        RuntimeHost::Options options;
        auto first = std::make_unique<RuntimeHost>(options);
        REQUIRE(first->context()
                    .evaluateModule("import { root, createView } from 'soundor:ui'; root.appendChild(createView());",
                                    "/a.js")
                    .ok());
        CHECK(first->surface().root().children().size() == 1);
        first.reset();
        RuntimeHost second(options);
        CHECK(second.surface().root().children().empty());
    }

    TEST_CASE("viewSize reports the surface size and scale")
    {
        UiFixture f;
        f.host.surface().setScale(2);
        CHECK(f.run(std::string(imports) + "globalThis.result = JSON.stringify(viewSize());").asString()
              == R"({"width":200,"height":100,"scale":2})");
    }
}
