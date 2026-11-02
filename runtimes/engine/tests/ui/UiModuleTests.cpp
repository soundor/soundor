#include "../support/Modules.h"
#include "../web/WebTestSupport.h"

#include <algorithm>
#include <string>

using namespace soundor;
using test::WebFixture;

namespace
{
    constexpr const char* imports = "import { root, createView, createText, createScrollView, focusedNode, "
                                    "viewSize, UiNode, PointerEvent, KeyboardEvent } from 'soundor:ui';\n";

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
    // Layout with the approximate text engine, so sizes do not depend on
    // the machine's fonts.
    RuntimeHost::Options approximateText()
    {
        RuntimeHost::Options options;
        options.textEngine = ui::approximateTextEngine();
        return options;
    }

    struct UiFixture : WebFixture
    {
        UiFixture() : WebFixture(approximateText())
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
        CHECK(f.error(std::string(imports) + "createText('x').appendChild(createView());")
                  .find("only views can have children")
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
        CHECK(f.error(std::string(imports) + "a.text = 'x';") == "TypeError: only text and input nodes have text");
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

    TEST_CASE("style properties are written one at a time, and lengths in CSS pixels")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            a.style = { width: 40, height: 20 };
            a.style.width = '30px';
            a.style.marginLeft = 5;
            const kept = a.style.height;
            delete a.style.height;
            a.style.backgroundColor = '';
            globalThis.result = JSON.stringify([a.style, kept, { ...a.style }, a.layout.width, a.layout.x,
                                                Object.keys(a.style)]);
        )");
        CHECK(f.eval("result").asString()
              == R"([{"width":30,"marginLeft":5},20,{"width":30,"marginLeft":5},30,5,["width","marginLeft"]])");
        CHECK(f.error(std::string(imports) + "a.style.width = 'wide';").find("style.width") != std::string::npos);
    }

    TEST_CASE("assigning what a style already is does not reach native code")
    {
        UiFixture f;
        f.run(std::string(imports) + "a.style = { width: 40, height: 20, opacity: 0.5 };");
        const auto calls = [&] { return f.host.statistics().runtime.ui.calls; };
        const auto before = calls();
        f.run(std::string(imports) + R"(
            a.style = { width: 40, height: 20, opacity: 0.5 };
            a.style = { opacity: 0.5, height: '20px', width: 40 }; // another order, CSS pixels
            a.style.width = 40;
            a.style.width = '40px';
            a.style.margin = null; // not there to remove
            delete a.style.padding;
        )");
        CHECK(calls() == before);

        // A change still goes through, and a failed one still changes nothing.
        f.run(std::string(imports) + "a.style.opacity = 0.25;");
        CHECK(calls() == before + 1);
        CHECK(f.error(std::string(imports) + "a.style.width = 'wide';").find("style.width") != std::string::npos);
        CHECK(f.run(std::string(imports) + "globalThis.result = JSON.stringify(a.style);").asString()
              == R"({"width":40,"height":20,"opacity":0.25})");
        f.run(std::string(imports) + "a.style = {};");
        CHECK(f.run(std::string(imports) + "globalThis.result = Object.keys(a.style).length;").asNumber() == 0);
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

    TEST_CASE("pointer positions: pageX/Y on the view, locationX/Y in the target, logical at any scale")
    {
        UiFixture f;
        f.host.surface().setScale(2);
        f.run(std::string(imports) + R"(
            const scroller = createScrollView({ width: 100, height: 100, padding: 10 });
            globalThis.item = createView({ height: 300, marginTop: 20, marginLeft: 5 });
            scroller.appendChild(item);
            b.appendChild(scroller);
            scroller.scrollTop = 25;
            item.addEventListener('pointerdown', (e) => {
              globalThis.result = JSON.stringify([e.pageX, e.pageY, e.locationX, e.locationY,
                e.clientX === e.pageX, e.offsetY === e.locationY, item.layout, item.getBoundingClientRect()]);
            });
        )");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 130, 40, 1, 0));
        CHECK(f.eval("result").asString()
              == R"([130,40,15,35,true,true,{"x":15,"y":30,"width":75,"height":300},)"
                 R"({"x":115,"y":5,"width":75,"height":300}])");
    }

    TEST_CASE("raw surface focus remains when hidden and clears when detached")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            a.focusable = true;
            a.focus();
            a.style.display = 'none';
            globalThis.focusStayedWhenHidden = focusedNode() === a;
            a.remove();
            globalThis.focusClearedWhenDetached = focusedNode() === null;
        )");
        CHECK(f.eval("focusStayedWhenHidden").asBoolean());
        CHECK(f.eval("focusClearedWhenDetached").asBoolean());
    }

    TEST_CASE("target propagation stopping preserves same-node listeners unless stopped immediately")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            const orders = [];
            for (const mode of ['normal', 'ancestor', 'target capture', 'target bubble',
                                'immediate capture', 'immediate bubble', 'prevent']) {
                const parent = createView(), child = createView(), order = [];
                root.appendChild(parent);
                parent.appendChild(child);
                parent.addEventListener('click', event => {
                    order.push('parent capture');
                    if (mode === 'ancestor') event.stopPropagation();
                }, true);
                if (mode === 'ancestor') parent.addEventListener('click', () => order.push('parent capture 2'), true);
                child.addEventListener('click', event => {
                    order.push('child capture 1');
                    if (mode === 'target capture') event.stopPropagation();
                    if (mode === 'immediate capture') event.stopImmediatePropagation();
                }, true);
                child.addEventListener('click', () => order.push('child capture 2'), true);
                child.addEventListener('click', event => {
                    order.push('child bubble 1');
                    if (mode === 'target bubble') event.stopPropagation();
                    if (mode === 'immediate bubble') event.stopImmediatePropagation();
                    if (mode === 'prevent') event.preventDefault();
                });
                child.addEventListener('click', () => order.push('child bubble 2'));
                parent.addEventListener('click', () => order.push('parent bubble'));
                const event = new PointerEvent('click', { bubbles: true, cancelable: true });
                const accepted = child.dispatchEvent(event);
                orders.push(order.join(','));
                if (accepted !== !event.defaultPrevented || event.defaultPrevented !== (mode === 'prevent'))
                    throw new Error('incorrect cancellation state');
                parent.remove();
            }
            globalThis.result = JSON.stringify(orders);
        )");
        CHECK(
            f.eval("result").asString()
            == R"(["parent capture,child capture 1,child capture 2,child bubble 1,child bubble 2,parent bubble","parent capture,parent capture 2","parent capture,child capture 1,child capture 2,child bubble 1,child bubble 2","parent capture,child capture 1,child capture 2,child bubble 1,child bubble 2","parent capture,child capture 1","parent capture,child capture 1,child capture 2,child bubble 1","parent capture,child capture 1,child capture 2,child bubble 1,child bubble 2,parent bubble"])");
    }

    TEST_CASE("the secondary button fires contextmenu, which captures and bubbles")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            for (const node of [root, b]) {
              node.addEventListener('contextmenu', record);
              node.addEventListener('contextmenu', record, true);
            }
            b.addEventListener('contextmenu', (e) => {
              globalThis.result = JSON.stringify([e instanceof PointerEvent, e.cancelable, e.button, e.buttons,
                e.pageX, e.locationY, e.pointerType, e.ctrlKey]);
              e.preventDefault();
            });
        )");
        auto input = pointer(ui::PointerInput::Phase::Down, 150, 40, 2, 2);
        input.modifiers = ui::Modifier::Control;
        f.host.surface().pointer(input);
        CHECK(f.log() == "contextmenu@root:capture contextmenu@b contextmenu@b contextmenu@root:bubble");
        CHECK(f.eval("result").asString() == R"([true,true,2,2,150,40,"mouse",true])");
    }

    TEST_CASE("overlayRoot: a second root whose events bubble to it, not to root")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            import { overlayRoot } from 'soundor:ui';
            globalThis.overlayRoot = overlayRoot;
            overlayRoot.name = 'overlay';
            globalThis.menu = createView({ position: 'absolute', left: 120, top: 30, width: 40, height: 40 });
            menu.name = 'menu';
            overlayRoot.appendChild(menu);
            for (const node of [root, overlayRoot, menu, b]) node.addEventListener('pointerdown', record);
            globalThis.result = JSON.stringify([overlayRoot.isConnected, menu.isConnected, overlayRoot.parent,
              menu.getBoundingClientRect(), overlayRoot.layout, root.contains(menu)]);
        )");
        CHECK(f.eval("result").asString()
              == R"([true,true,null,{"x":120,"y":30,"width":40,"height":40},)"
                 R"({"x":0,"y":0,"width":200,"height":100},false])");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 130, 40, 1, 0));
        CHECK(f.log() == "pointerdown@menu pointerdown@overlay:bubble");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Up, 130, 40, 0, 0));
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 110, 80, 1, 0));
        CHECK(f.log() == "pointerdown@b pointerdown@root:bubble");
        CHECK(f.error(std::string(imports) + "import { overlayRoot } from 'soundor:ui'; b.appendChild(overlayRoot);")
                  .find("cannot be a child")
              != std::string::npos);
    }

    TEST_CASE("zIndex must be an integer")
    {
        UiFixture f;
        CHECK(f.error(std::string(imports) + "a.style = { zIndex: 1.5 };")
              == "TypeError: style.zIndex: expected an integer, got 1.5");
        CHECK(f.error(std::string(imports) + "a.style = { zIndex: '2' };")
              == "TypeError: style.zIndex: expected an integer, got '2'");
        CHECK(f.run(std::string(imports) + "a.style = { zIndex: -3 }; globalThis.result = a.style.zIndex;").asNumber()
              == -3);
    }

    TEST_CASE("the cursor style reaches the surface")
    {
        UiFixture f;
        f.run(std::string(imports) + "a.style = { width: 100, height: 100, cursor: 'ns-resize' };");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Move, 10, 10, 0, -1));
        CHECK(f.host.surface().cursor() == ui::Cursor::NsResize);
        CHECK(f.error(std::string(imports) + "a.style = { cursor: 'hand' };")
              == "TypeError: style.cursor: expected one of 'auto', 'default', 'none', 'pointer', 'text', "
                 "'crosshair', 'move', 'ew-resize', 'ns-resize', 'nesw-resize', 'nwse-resize', got 'hand'");
    }

    TEST_CASE("a node appearing under a still pointer is entered at the next tick")
    {
        UiFixture f;
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Move, 10, 10, 0, -1));
        f.run(std::string(imports) + R"(
            globalThis.result = [];
            const cover = createView({ width: 50, height: 50 });
            cover.addEventListener('pointerenter', (event) => result.push(event.type, event.offsetX));
            cover.addEventListener('pointermove', (event) => result.push(event.type));
            a.appendChild(cover);
        )");
        CHECK(f.eval("JSON.stringify(result)").asString() == "[]");
        f.host.tick();
        CHECK(f.eval("JSON.stringify(result)").asString() == R"(["pointerenter",10])");
    }

    TEST_CASE("a node locks the pointer pressing it, and events carry movement")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            import { exitPointerLock, pointerLockNode } from 'soundor:ui';
            globalThis.steps = [];
            a.style = { width: 100, height: 100 };
            a.addEventListener('pointerdown', () => {
              a.requestPointerLock().then(() => steps.push('locked', pointerLockNode() === a));
            });
            a.addEventListener('pointermove', (event) =>
              steps.push(event.clientX, event.movementX, event.movementY));
            // The release still comes under the lock, which ends after it.
            a.addEventListener('pointerup', () => steps.push('up', pointerLockNode() === a));
            globalThis.refuse = () => {
              steps.push(pointerLockNode());
              b.requestPointerLock().catch((error) => steps.push(error.name));
            };
            globalThis.exit = exitPointerLock;
        )");
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 10, 10, 1, 0));
        f.host.runtime().runPendingJobs();
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Move, 250, 4, 1, -1));
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Up, 250, 4, 0, 0));
        f.run("refuse(); exit();");
        f.host.runtime().runPendingJobs();
        CHECK(f.eval("JSON.stringify(steps)").asString()
              == R"(["locked",true,10,240,-6,"up",true,null,"NotAllowedError"])");
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

    TEST_CASE("focus shows when the keyboard moved it, or a key is pressed after a press")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            for (const node of [a, b]) {
              node.focusable = true;
              node.addEventListener('focus', (e) => log.push('focus@' + e.target.name + ':' + e.focusVisible));
              node.addEventListener('focusvisiblechange',
                  (e) => log.push('visible@' + e.target.name + ':' + e.focusVisible));
            }
        )");
        auto& surface = f.host.surface();
        // Pressed: focused, not shown.
        surface.pointer(pointer(ui::PointerInput::Phase::Down, 10, 10, 1, 0));
        surface.pointer(pointer(ui::PointerInput::Phase::Up, 10, 10, 0, 0));
        CHECK(f.log() == "focus@a:false");
        CHECK(f.eval("[a.focused, a.focusVisible].join()").asString() == "true,false");
        // A modifier on its own, or a shortcut, is not using the keyboard.
        surface.key({ .down = true, .key = "Shift", .repeat = false, .modifiers = ui::Modifier::Shift });
        surface.key({ .down = true, .key = "c", .repeat = false, .modifiers = ui::Modifier::Control });
        CHECK(f.log() == "");
        surface.key({ .down = true, .key = "ArrowUp", .repeat = false, .modifiers = 0 });
        CHECK(f.log() == "visible@a:true");
        CHECK(f.eval("a.focusVisible").asBoolean());
        // Tab moves it, shown.
        surface.key({ .down = true, .key = "Tab", .repeat = false, .modifiers = 0 });
        CHECK(f.log() == "visible@a:false focus@b:true visible@b:true");
        CHECK(f.eval("[a.focusVisible, b.focusVisible].join()").asString() == "false,true");
        // Focus moved by code shows as the last input would have.
        surface.pointer(pointer(ui::PointerInput::Phase::Down, 300, 300, 1, 0));
        surface.pointer(pointer(ui::PointerInput::Phase::Up, 300, 300, 0, 0));
        f.run("a.focus();");
        CHECK(f.log() == "visible@b:false focus@a:false");
        // Assistive technology moves focus as the keyboard does.
        surface.pointer(pointer(ui::PointerInput::Phase::Down, 300, 300, 1, 0));
        surface.pointer(pointer(ui::PointerInput::Phase::Up, 300, 300, 0, 0));
        CHECK(surface.accessibilityAction(surface.hitTest({ 150, 50 }), "focus"));
        CHECK(f.log() == "focus@b:true visible@b:true");
    }

    TEST_CASE("a text input shows focus however it got it; pressable reports focusVisible")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            import { pressable, createTextInput } from 'soundor:ui';
            globalThis.states = [];
            pressable(a, { onStateChange: (state) => states.push(state.focused + '/' + state.focusVisible) });
            globalThis.field = createTextInput();
            root.appendChild(field);
        )");
        auto& surface = f.host.surface();
        surface.pointer(pointer(ui::PointerInput::Phase::Down, 10, 10, 1, 0));
        surface.pointer(pointer(ui::PointerInput::Phase::Up, 10, 10, 0, 0));
        surface.key({ .down = true, .key = "x", .repeat = false, .modifiers = 0 });
        f.run("field.focus();");
        // Hovered and pressed (false/false), focused by the press, released, a key.
        CHECK(f.eval("states.join(' ')").asString()
              == "false/false false/false true/false true/false true/true false/false");
        CHECK(f.eval("field.focusVisible").asBoolean());
        surface.pointer(pointer(ui::PointerInput::Phase::Down, 10, 10, 1, 0));
        f.run("field.focus();");
        CHECK(f.eval("field.focusVisible").asBoolean());
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
        // The two roots, a, b and kept remain.
        std::size_t alive = 0;
        for (ui::NodeId id = 1; id < 400; ++id)
            alive += f.host.surface().find(id) != nullptr ? 1U : 0U;
        CHECK(alive == 5);
    }

    TEST_CASE("a new runtime starts with a new, empty surface")
    {
        RuntimeHost::Options options;
        auto first = std::make_unique<RuntimeHost>(options);
        REQUIRE(
            first->context()
                .evaluateModule(soundor::test::module(
                                    "import { root, createView } from 'soundor:ui'; root.appendChild(createView());"),
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
              == R"({"width":200,"height":100,"scale":2,"safeArea":{"x":0,"y":0,"width":200,"height":100}})");
    }

    TEST_CASE("the safe area is the whole view unless the backend says otherwise")
    {
        UiFixture f;
        f.host.surface().setSafeArea(ui::Rect { 30, 0, 140, 100 });
        f.run(std::string(imports) + R"(
            globalThis.viewSize = viewSize;
            globalThis.first = viewSize();
            globalThis.result = JSON.stringify(first.safeArea);
            globalThis.frozen = Object.isFrozen(first) && Object.isFrozen(first.safeArea);
        )");
        CHECK(f.eval("result").asString() == R"({"x":30,"y":0,"width":140,"height":100})");
        CHECK(f.eval("frozen").asBoolean());
        // A new safe area alone is a new snapshot; the same one is not.
        f.host.surface().setSafeArea(ui::Rect { 30, 0, 140, 100 });
        CHECK(f.eval("viewSize() === first").asBoolean());
        f.host.surface().setSafeArea(std::nullopt);
        CHECK(f.eval("JSON.stringify(viewSize().safeArea)").asString() == R"({"x":0,"y":0,"width":200,"height":100})");
        CHECK(f.eval("viewSize() !== first").asBoolean());
    }

    TEST_CASE("editorSize is the editor's, apart from the view's, and frozen until it changes")
    {
        UiFixture f;
        f.run(R"(
            import { editorSize, viewSize } from 'soundor:ui';
            globalThis.viewSize = viewSize;
            globalThis.read = editorSize;
            globalThis.first = editorSize();
        )");
        // Before the backend says: nothing shown yet.
        CHECK(f.eval("JSON.stringify(first)").asString() == R"({"width":0,"height":0,"resizable":false})");
        CHECK(f.eval("Object.isFrozen(first) && read() === first").asBoolean());
        // An editor that scales: twice the view's size.
        f.host.surface().setEditorSize({ 400, 200 });
        CHECK(f.eval("JSON.stringify(read())").asString() == R"({"width":400,"height":200,"resizable":false})");
        CHECK(f.eval("read() === read() && read() !== first").asBoolean());
        CHECK(f.eval("viewSize().width").asNumber() == 200);
        // The backend saying requests can resize it is a new snapshot too.
        f.eval("globalThis.second = read()");
        f.host.surface().setEditorResizable(true);
        CHECK(f.eval("read() !== second && read().resizable").asBoolean());
    }

    TEST_CASE("requestEditorSize asks the backend for a whole size, only where it can be asked for")
    {
        UiFixture f;
        f.run(R"(
            import { requestEditorSize, editorSize } from 'soundor:ui';
            globalThis.request = requestEditorSize;
            globalThis.asked = (w, h) => {
              const size = requestEditorSize(w, h);
              return size === null ? 'null' : `${size.width}x${size.height}:${Object.isFrozen(size)}`;
            };
            globalThis.read = editorSize;
        )");
        auto& surface = f.host.surface();
        // A fixed editor: nothing is asked.
        CHECK(f.eval("request(500, 400) === null").asBoolean());
        CHECK_FALSE(surface.takeEditorSizeRequest().has_value());

        surface.setEditorResizable(true);
        surface.setEditorSize({ 400, 300 });
        CHECK(f.eval("asked(500.4, 399.5)").asString() == "500x400:true");
        // The latest request is the one taken, rounded to whole pixels.
        CHECK(f.eval("asked(640.6, 480.2)").asString() == "641x480:true");
        const auto taken = surface.takeEditorSizeRequest().value_or(ui::Size {});
        CHECK(taken.width == 641);
        CHECK(taken.height == 480);
        CHECK_FALSE(surface.takeEditorSizeRequest().has_value());
        // Asking is not getting: the size is the backend's until it says.
        CHECK(f.eval("read().width").asNumber() == 400);
        // A size no screen has is held to what converts (0x3FFFFFFF, as a
        // float 2^30), never overflowing;
        // none at all, or less, to a pixel.
        CHECK(f.eval("asked(1e300, 0)").asString() == "1073741824x1:true");
        CHECK(f.eval("asked(-40, -0.4)").asString() == "1x1:true");

        // The backend's hold: what it returns is what is asked, and taken.
        surface.setEditorSizeHold([](ui::Size size) { return ui::Size { std::max(size.width, 300.0F), 200 }; });
        CHECK(f.eval("asked(-40, 900)").asString() == "300x200:true");
        CHECK(surface.takeEditorSizeRequest().value_or(ui::Size {}).width == 300);

        const auto fails = [&](const char* call) { return f.error(std::string(imports) + call); };
        CHECK(fails("import { requestEditorSize } from 'soundor:ui'; requestEditorSize('500', 400);")
                  .find("TypeError: requestEditorSize(): width must be a number, got string")
              != std::string::npos);
        CHECK(fails("import { requestEditorSize } from 'soundor:ui'; requestEditorSize(500);")
                  .find("TypeError: requestEditorSize(): height must be a number, got undefined")
              != std::string::npos);
        CHECK(fails("import { requestEditorSize } from 'soundor:ui'; requestEditorSize(Infinity, 400);")
                  .find("RangeError: requestEditorSize(): width must be a finite number, got Infinity")
              != std::string::npos);
        CHECK(fails("import { requestEditorSize } from 'soundor:ui'; requestEditorSize(500, NaN);")
                  .find("RangeError: requestEditorSize(): height must be a finite number, got NaN")
              != std::string::npos);
        CHECK_FALSE(surface.takeEditorSizeRequest().has_value());
    }

    TEST_CASE("pointer events say where the pointer is on the screen, in the editor's pixels")
    {
        UiFixture f;
        f.run(R"(
            globalThis.seen = [];
            a.addEventListener('pointerdown', (event) => seen.push([event.clientX, event.screenX, event.screenY]));
        )");
        auto input = pointer(ui::PointerInput::Phase::Down, 10, 20, 1, 0);
        input.screen = ui::Point { 1210, 820 };
        f.host.surface().pointer(input);
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Up, 10, 20, 0, 0));
        // A backend that does not know: the view's position.
        f.host.surface().pointer(pointer(ui::PointerInput::Phase::Down, 30, 40, 1, 0));
        CHECK(f.eval("JSON.stringify(seen)").asString() == "[[10,1210,820],[30,30,40]]");
    }

    TEST_CASE("subscribeEditorSize tells each subscriber once per change, apart from the view's")
    {
        UiFixture f;
        f.run(R"(
            import { subscribeEditorSize, subscribeViewSize, editorSize } from 'soundor:ui';
            globalThis.log = [];
            subscribeEditorSize((size) => {
                log.push(`editor ${size.width}x${size.height}`);
                if (size !== editorSize()) log.push('not the snapshot');
            });
            globalThis.unsubscribe = subscribeEditorSize(() => log.push('b'));
            subscribeViewSize((size) => log.push(`view ${size.width}x${size.height}`));
            subscribeEditorSize(() => { throw new Error('editor listener failed'); });
        )");
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 0);

        // The editor resized, the view not (an editor that scales): only
        // editor subscribers hear of it, once for many changes.
        f.host.surface().setEditorSize({ 300, 150 });
        f.host.surface().setEditorSize({ 400, 200 });
        f.host.tick();
        CHECK(f.eval("JSON.stringify(log.splice(0))").asString() == R"(["editor 400x200","b"])");
        f.host.surface().setEditorSize({ 400, 200 });
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 0);

        // Both at once, and an unsubscribed listener hears nothing.
        f.eval("unsubscribe()");
        f.host.surface().setEditorSize({ 500, 250 });
        f.host.surface().setSize({ 250, 125 });
        f.host.tick();
        CHECK(f.eval("JSON.stringify(log.splice(0))").asString() == R"(["view 250x125","editor 500x250"])");
        // Whether it can be asked for is part of it.
        f.host.surface().setEditorResizable(true);
        f.host.tick();
        f.host.tick();
        CHECK(f.eval("JSON.stringify(log.splice(0))").asString() == R"(["editor 500x250"])");
        bool reported = false;
        for (const auto& [level, message] : f.logs)
            reported = reported || message.find("editor listener failed") != std::string::npos;
        CHECK(reported);
        CHECK(
            f.error(std::string(imports) + "import { subscribeEditorSize } from 'soundor:ui'; subscribeEditorSize(1);")
                .find("subscribeEditorSize() expects a function")
            != std::string::npos);
    }

    TEST_CASE("subscribeViewSize tells of a new safe area")
    {
        UiFixture f;
        f.run(R"(
            import { subscribeViewSize } from 'soundor:ui';
            globalThis.told = [];
            subscribeViewSize((size) => told.push(size.safeArea.x));
        )");
        f.host.surface().setSafeArea(ui::Rect { 20, 0, 160, 100 });
        f.host.tick();
        f.host.tick();
        CHECK(f.eval("JSON.stringify(told)").asString() == "[20]");
    }

    TEST_CASE("viewSize is the same frozen object until the size or scale changes")
    {
        UiFixture f;
        f.run(std::string(imports) + R"(
            globalThis.first = viewSize();
            globalThis.result = first === viewSize() && Object.isFrozen(first);
        )");
        CHECK(f.eval("result").asBoolean());
        f.host.surface().setSize({ 300, 100 });
        f.run(std::string(imports) + R"(
            const second = viewSize();
            globalThis.result = second !== first && second === viewSize() && second.width === 300;
        )");
        CHECK(f.eval("result").asBoolean());
    }

    TEST_CASE("subscribeViewSize tells each subscriber once per change, before the frame")
    {
        UiFixture f;
        f.run(R"(
            import { subscribeViewSize, viewSize, root, createView } from 'soundor:ui';
            globalThis.log = [];
            globalThis.unsubscribeB = undefined;
            subscribeViewSize((size) => {
                log.push(`a ${size.width}x${size.height}@${size.scale}`);
                // A layout that depends on the size, decided before the frame.
                if (size !== viewSize()) log.push('a: not the snapshot');
            });
            unsubscribeB = subscribeViewSize((size) => log.push(`b ${size.width}x${size.height}`));
            requestAnimationFrame(() => log.push('frame'));
        )");
        // The size it started with is no change.
        f.host.tick();
        CHECK(f.eval("JSON.stringify(log)").asString() == R"(["frame"])");

        f.eval("log.length = 0; requestAnimationFrame(() => log.push('frame'))");
        f.host.surface().setSize({ 300, 100 });
        f.host.tick();
        CHECK(f.eval("JSON.stringify(log)").asString() == R"(["a 300x100@1","b 300x100","frame"])");

        // Nothing for a tick without a change, nor for the same size again.
        f.eval("log.length = 0");
        f.host.tick();
        f.host.surface().setSize({ 300, 100 });
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 0);

        // Height, then scale; many changes between ticks are one.
        f.host.surface().setSize({ 300, 250 });
        f.host.surface().setSize({ 320, 260 });
        f.host.surface().setSize({ 340, 270 });
        f.host.tick();
        f.host.surface().setScale(2);
        f.host.tick();
        CHECK(f.eval("JSON.stringify(log)").asString() == R"(["a 340x270@1","b 340x270","a 340x270@2","b 340x270"])");

        // A size that changes and changes back before a tick is no change.
        f.eval("log.length = 0; unsubscribeB()");
        f.host.surface().setSize({ 500, 500 });
        f.host.surface().setSize({ 340, 270 });
        f.host.tick();
        CHECK(f.eval("log.length").asNumber() == 0);
        f.host.surface().setSize({ 400, 270 });
        f.host.tick();
        CHECK(f.eval("JSON.stringify(log)").asString() == R"(["a 400x270@2"])");
    }

    TEST_CASE("subscribers are told of a size plugin code read before the tick")
    {
        UiFixture f;
        f.run(R"(
            import { subscribeViewSize, viewSize } from 'soundor:ui';
            globalThis.read = viewSize;
            globalThis.told = [];
            subscribeViewSize((size) => told.push(size.width));
        )");
        f.host.surface().setSize({ 480, 100 });
        // A render or an event handler reads the new size first.
        CHECK(f.eval("read().width").asNumber() == 480);
        f.host.tick();
        CHECK(f.eval("JSON.stringify(told)").asString() == "[480]");
    }

    TEST_CASE("a subscriber that throws is reported, and the others are still told")
    {
        UiFixture f;
        f.run(R"(
            import { subscribeViewSize } from 'soundor:ui';
            globalThis.told = 0;
            subscribeViewSize(() => { throw new Error('listener failed'); });
            subscribeViewSize(() => { told += 1; });
        )");
        f.host.surface().setSize({ 250, 100 });
        f.host.tick();
        CHECK(f.eval("told").asNumber() == 1);
        bool reported = false;
        for (const auto& [level, message] : f.logs)
            reported = reported || message.find("listener failed") != std::string::npos;
        CHECK(reported);
        CHECK(f.error(std::string(imports) + "import { subscribeViewSize } from 'soundor:ui'; subscribeViewSize(1);")
                  .find("subscribeViewSize() expects a function")
              != std::string::npos);
    }

    TEST_CASE("each runtime's subscribers hear of its own view only, and a new runtime starts afresh")
    {
        const auto subscribe = [](RuntimeHost& host)
        {
            REQUIRE(host.context()
                        .evaluateModule(soundor::test::module(R"(
                            import { subscribeViewSize } from 'soundor:ui';
                            globalThis.sizes = [];
                            subscribeViewSize((size) => sizes.push(size.width));
                        )"),
                                        "/size.js")
                        .ok());
        };
        const auto sizes = [](RuntimeHost& host)
        { return host.context().evaluateScript("JSON.stringify(sizes)").value().asString(); };
        RuntimeHost::Options options;
        auto first = std::make_unique<RuntimeHost>(options);
        RuntimeHost other(options);
        subscribe(*first);
        subscribe(other);
        first->surface().setSize({ 640, 480 });
        first->tick();
        other.tick();
        CHECK(sizes(*first) == "[640]");
        CHECK(sizes(other) == "[]");

        // A reload (soundor dev): the old runtime and its subscribers go; the
        // new one's are told the size its backend gives it.
        first.reset();
        RuntimeHost reloaded(options);
        subscribe(reloaded);
        reloaded.surface().setSize({ 640, 480 });
        reloaded.tick();
        CHECK(sizes(reloaded) == "[640]");
    }

    TEST_CASE("a reloaded runtime reads the editor's size as it starts, and is told of changes")
    {
        RuntimeHost::Options options;
        auto first = std::make_unique<RuntimeHost>(options);
        first->surface().setEditorSize({ 800, 600 });
        first.reset();
        RuntimeHost reloaded(options);
        reloaded.surface().setEditorSize({ 800, 600 });
        REQUIRE(reloaded.context()
                    .evaluateModule(soundor::test::module(R"(
                        import { editorSize, subscribeEditorSize } from 'soundor:ui';
                        globalThis.start = editorSize().width;
                        globalThis.told = [];
                        subscribeEditorSize((size) => told.push(size.width));
                    )"),
                                    "/editor.js")
                    .ok());
        reloaded.tick();
        CHECK(reloaded.context().evaluateScript("start").value().asNumber() == 800);
        CHECK(reloaded.context().evaluateScript("told.length").value().asNumber() == 0);
        reloaded.surface().setEditorSize({ 900, 600 });
        reloaded.tick();
        CHECK(reloaded.context().evaluateScript("JSON.stringify(told)").value().asString() == "[900]");
    }
}
