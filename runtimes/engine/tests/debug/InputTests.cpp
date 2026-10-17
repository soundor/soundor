#include "../web/WebTestSupport.h"

#include <soundor/debug/Inspector.h>

#include <string>
#include <vector>

using namespace soundor;

namespace
{
    // A plugin UI made with soundor:ui, logging what its listeners receive:
    // a "reset" button with a "label" inside, a text input, a scroll view,
    // and a floating overlay node over the bottom-right corner.
    constexpr const char* plugin = R"(
        import { root, overlayRoot, createView, createTextInput, createScrollView } from 'soundor:ui';
        globalThis.log = [];
        const record = (name) => (event) => globalThis.log.push(
            name + ':' + event.type + (event.shiftKey ? '+shift' : '') + (event.key ? '=' + event.key : ''));
        const reset = createView({ position: 'absolute', left: 0, top: 0, width: 40, height: 30 });
        reset.debugId = 'reset';
        for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'click', 'pointerenter', 'pointerleave'])
            reset.addEventListener(type, record('reset'));
        const label = createView({ width: 10, height: 10 });
        reset.appendChild(label);
        root.appendChild(reset);
        const input = createTextInput({ style: { position: 'absolute', left: 0, top: 40, width: 60, height: 20 } });
        input.debugId = 'input';
        input.addEventListener('keydown', record('input'));
        input.addEventListener('keyup', record('input'));
        root.appendChild(input);
        const scroll = createScrollView({ position: 'absolute', left: 0, top: 70, width: 50, height: 20 });
        scroll.appendChild(createView({ width: 50, height: 200 }));
        root.appendChild(scroll);
        const cover = createView({ position: 'absolute', left: 80, top: 0, width: 40, height: 100 });
        overlayRoot.appendChild(cover);
        globalThis.nodes = { reset, input, scroll, cover };
        globalThis.result = true;
    )";

    struct Fixture : test::WebFixture
    {
        std::vector<std::string> messages;
        debug::Inspector inspector { [this](std::string message) { messages.push_back(std::move(message)); } };
        unsigned sequence = 0;
        Fixture()
        {
            host.surface().setSize({ 120, 100 });
            run(plugin);
        }
        // Sends a request as a runtime bridge receives it; its response.
        std::string send(const std::string& method, const std::string& params)
        {
            const auto value =
                debug::Value::parse(R"({"type":"request","id":"r)" + std::to_string(++sequence) + R"(","method":")"
                                    + method + R"(","generation":1,"params":)" + params + "}");
            const auto command = value ? debug::Command::parse(*value) : std::nullopt;
            if (! command)
            {
                FAIL("not a command: " << method);
                return {};
            }
            inspector.execute(host, *command);
            return messages.back();
        }
        std::string log()
        {
            const auto value = eval("globalThis.log.join(' ')").asString();
            eval("globalThis.log.length = 0");
            return value;
        }
        std::string js(const std::string& expression) { return eval(expression).asString(); }
        ui::NodeId id(const std::string& name)
        {
            std::vector<const ui::Node*> queue { &host.surface().root(), &host.surface().overlay() };
            for (std::size_t at = 0; at < queue.size(); ++at)
            {
                if (queue[at]->debugId() == name)
                    return queue[at]->id();
                for (const auto* child : queue[at]->children())
                    queue.push_back(child);
            }
            return ui::noNode;
        }
    };
} // namespace

TEST_SUITE("Native DevTools input")
{
    TEST_CASE("a click reaches the application's listeners through normal dispatch")
    {
        Fixture f;
        const auto response = f.send("Input.dispatchPointer", R"({"action":"click","x":5,"y":5})");
        CHECK(response.find(R"("handled":true)") != std::string::npos);
        // The deepest node under the point is the label, inside reset.
        CHECK(f.log() == "reset:pointerenter reset:pointerdown reset:pointerup reset:click");
        CHECK(f.inspector.holdingInput() == false);
    }

    TEST_CASE("hover enters and leaves; a press and release elsewhere is a drag, not a click")
    {
        Fixture f;
        f.send("Input.dispatchPointer", R"({"action":"move","x":20,"y":10})");
        CHECK(f.log() == "reset:pointerenter");
        f.send("Input.dispatchPointer", R"({"action":"down"})");
        CHECK(f.inspector.holdingInput());
        // Captured: the press keeps its target while the pointer moves away.
        f.send("Input.dispatchPointer", R"({"action":"move","x":100,"y":90})");
        f.send("Input.dispatchPointer", R"({"action":"up"})");
        CHECK(f.log() == "reset:pointerdown reset:pointerup reset:pointerleave");
        CHECK_FALSE(f.inspector.holdingInput());
    }

    TEST_CASE("buttons and modifiers are those of the request and of held keys")
    {
        Fixture f;
        f.send("Input.dispatchKey", R"({"action":"down","key":"Shift"})");
        f.log();
        f.send("Input.dispatchPointer", R"({"action":"click","x":5,"y":5,"button":"right"})");
        // The secondary button is no click.
        CHECK(f.log() == "reset:pointerenter+shift reset:pointerdown+shift reset:pointerup+shift");
        CHECK(f.send("Input.dispatchPointer", R"({"action":"up"})").find("INVALID_REQUEST") != std::string::npos);
    }

    TEST_CASE("keys and text go to the focused input, typing as a keyboard would")
    {
        Fixture f;
        f.send("Input.focus", R"({"node":{"generation":1,"id":")" + std::to_string(f.id("input")) + R"("}})");
        CHECK(f.host.surface().focused() == f.id("input"));
        f.send("Input.typeText", R"({"text":"hé"})");
        CHECK(f.js("globalThis.nodes.input.value") == "h\xc3\xa9");
        CHECK(f.log() == "input:keydown=h input:keyup=h input:keydown=\xc3\xa9 input:keyup=\xc3\xa9");
        // A shortcut types nothing.
        f.send("Input.dispatchKey", R"({"action":"press","key":"x","modifiers":["Control"]})");
        CHECK(f.js("globalThis.nodes.input.value") == "h\xc3\xa9");
        f.send("Input.dispatchKey", R"({"action":"press","key":"Backspace"})");
        CHECK(f.js("globalThis.nodes.input.value") == "h");
        CHECK(f.send("Input.dispatchKey", R"({"action":"up","key":"q"})").find("INVALID_REQUEST") != std::string::npos);
    }

    TEST_CASE("only focusable nodes take focus")
    {
        Fixture f;
        const auto response =
            f.send("Input.focus", R"({"node":{"generation":1,"id":")" + std::to_string(f.id("reset")) + R"("}})");
        CHECK(response.find("NOT_ACTIONABLE") != std::string::npos);
    }

    TEST_CASE("the wheel scrolls through the default action")
    {
        Fixture f;
        f.send("Input.dispatchWheel", R"({"x":10,"y":80,"deltaX":0,"deltaY":30})");
        CHECK(f.eval("globalThis.nodes.scroll.scrollTop").asNumber() == 30);
    }

    TEST_CASE("hit testing reports what covers a point, overlays first, without input")
    {
        Fixture f;
        const auto under = f.send("UI.hitTest", R"({"x":5,"y":5})");
        CHECK(under.find(R"("path":[")" + std::to_string(f.host.surface().root().id())) != std::string::npos);
        CHECK(under.find(std::to_string(f.id("reset"))) != std::string::npos);
        const auto covered = f.send("UI.hitTest", R"({"x":100,"y":10})");
        CHECK(covered.find(std::to_string(f.host.surface().overlay().id())) != std::string::npos);
        CHECK(f.log().empty());
    }

    TEST_CASE("reset ends held input without a click, and leaves the real mouse alone")
    {
        Fixture f;
        // The real mouse hovers the input.
        CHECK(f.host.surface().pointer({ .phase = ui::PointerInput::Phase::Move, .position = { 5, 45 } }));
        f.send("Input.dispatchPointer", R"({"action":"down","x":5,"y":5})");
        f.send("Input.dispatchKey", R"({"action":"down","key":"Shift"})");
        f.log();
        f.inspector.execute(f.host, { .method = "resetControl" });
        CHECK_FALSE(f.inspector.holdingInput());
        CHECK(f.log() == "reset:pointercancel reset:pointerleave");
        // The next press starts over; nothing is still held.
        f.send("Input.dispatchPointer", R"({"action":"click","x":5,"y":5})");
        CHECK(f.log() == "reset:pointerenter reset:pointerdown reset:pointerup reset:click");
        // The real pointer still hovers the input: its state was not touched.
        CHECK(f.host.surface().pointer({ .phase = ui::PointerInput::Phase::Move, .position = { 6, 45 } }));
    }

    TEST_CASE("a reload forgets synthetic input without dispatching to the new host")
    {
        Fixture f;
        f.send("Input.dispatchPointer", R"({"action":"down","x":5,"y":5})");
        f.log();
        f.inspector.tick(f.host, 2);
        CHECK_FALSE(f.inspector.holdingInput());
        CHECK(f.log().empty());
        CHECK(f.send("Input.dispatchPointer", R"({"action":"up"})").find("old runtime generation")
              != std::string::npos);
    }

    TEST_CASE("invalid input is refused before anything is dispatched")
    {
        Fixture f;
        CHECK(f.send("Input.dispatchPointer", R"({"action":"down"})").find("move the pointer") != std::string::npos);
        CHECK(f.send("Input.dispatchPointer", R"({"action":"jump","x":1,"y":1})").find("INVALID_REQUEST")
              != std::string::npos);
        CHECK(f.send("Input.dispatchPointer", R"({"action":"click","x":1,"y":1,"modifiers":["Hyper"]})")
                  .find("INVALID_REQUEST")
              != std::string::npos);
        CHECK(f.send("Input.typeText", R"({"text":""})").find("INVALID_REQUEST") != std::string::npos);
        CHECK(f.log().empty());
    }
}
