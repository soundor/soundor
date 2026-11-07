#include "../web/WebTestSupport.h"

#include <soundor/a11y/SurfaceSemantics.h>

#include <memory>
#include <sstream>
#include <string>
#include <variant>

using namespace soundor;
using test::WebFixture;

namespace
{
    constexpr const char* imports = "import { root, overlayRoot, createView, createText, createImage, "
                                    "createTextInput, pressable } from 'soundor:ui';\n";

    // A platform adapter that only keeps the tree, as a real one would.
    struct FakeAdapter final : a11y::Adapter
    {
        void update(const a11y::TreeUpdate& changes) override
        {
            tree.apply(changes);
            last = changes;
            ++updates;
        }

        a11y::Tree tree;
        a11y::TreeUpdate last;
        int updates = 0;
    };

    std::string roleOf(a11y::Role role)
    {
        switch (role)
        {
            case a11y::Role::Group:
                return "group";
            case a11y::Role::TextInput:
                return "textinput";
            case a11y::Role::ScrollView:
                return "scrollview";
            case a11y::Role::View:
                return "view";
            default:
                return std::string(a11y::roleName(role));
        }
    }

    // A tree in one line: `role "label" {state} =value [children]`.
    void describe(const a11y::Tree& tree, a11y::NodeId id, std::ostringstream& out)
    {
        const a11y::Node* node = tree.find(id);
        REQUIRE(node != nullptr);
        out << roleOf(node->role);
        if (! node->label.empty())
            out << " \"" << node->label << '"';
        if (node->state.disabled)
            out << " {disabled}";
        if (node->state.checked == a11y::Checked::True)
            out << " {checked}";
        if (node->state.checked == a11y::Checked::Mixed)
            out << " {mixed}";
        if (node->value.now)
            out << " =" << *node->value.now;
        if (! node->value.text.empty())
            out << " =\"" << node->value.text << '"';
        if (node->children.empty())
            return;
        out << " [";
        for (std::size_t i = 0; i < node->children.size(); ++i)
        {
            if (i > 0)
                out << ", ";
            describe(tree, node->children[i], out);
        }
        out << ']';
    }

    RuntimeHost::Options approximateText()
    {
        RuntimeHost::Options options;
        options.textEngine = ui::approximateTextEngine();
        return options;
    }

    struct A11yFixture : WebFixture
    {
        A11yFixture() : WebFixture(approximateText()) { host.surface().setSize({ 200, 100 }); }

        a11y::SurfaceSemantics& semantics() { return host.accessibility(); }

        // Runs `body`, then brings the adapter's tree up to date.
        void build(const std::string& body)
        {
            run(std::string(imports) + body);
            sync();
        }

        void sync() { adapter.update(semantics().update(adapter.updates == 0)); }

        std::string tree() const
        {
            std::ostringstream out;
            describe(adapter.tree, adapter.tree.root(), out);
            return out.str();
        }

        // The element labelled `label` in the adapter's tree; noNode if none.
        a11y::NodeId element(const std::string& label) { return find(adapter.tree.root(), label); }

        a11y::NodeId find(a11y::NodeId id, const std::string& label)
        {
            const a11y::Node* at = adapter.tree.find(id);
            if (at == nullptr)
                return a11y::noNode;
            if (at->label == label)
                return id;
            for (const a11y::NodeId child : at->children)
                if (const a11y::NodeId found = find(child, label); found != a11y::noNode)
                    return found;
            return a11y::noNode;
        }

        const a11y::Node& node(const std::string& label)
        {
            const a11y::Node* found = adapter.tree.find(element(label));
            REQUIRE(found != nullptr);
            return *found;
        }

        bool perform(const std::string& name, a11y::Action action, std::string custom = {},
                     std::variant<std::monostate, double, std::string> value = {})
        {
            return host.performAccessibilityAction({ element(name), action, std::move(custom), std::move(value) });
        }

        FakeAdapter adapter;
    };

} // namespace

TEST_SUITE("a11y semantics")
{
    TEST_CASE("names roles and actions as plugin code does")
    {
        CHECK(a11y::roleFromName("adjustable") == a11y::Role::Adjustable);
        CHECK(a11y::roleFromName("dialog") == a11y::Role::Dialog);
        CHECK(! a11y::roleFromName("slider").has_value());
        CHECK(! a11y::roleFromName("group").has_value());
        CHECK(a11y::roleName(a11y::Role::ToggleButton) == "togglebutton");
        CHECK(a11y::roleName(a11y::Role::TextInput).empty());
        CHECK(a11y::actionFromName("increment") == a11y::Action::Increment);
        CHECK(a11y::actionFromName("setValue") == a11y::Action::SetValue);
        CHECK(a11y::actionFromName("bypass") == a11y::Action::Custom);
        CHECK(a11y::actionName(a11y::Action::LongPress) == "longpress");
        CHECK(a11y::isLeafRole(a11y::Role::Button));
        CHECK_FALSE(a11y::isLeafRole(a11y::Role::Dialog));
    }

    TEST_CASE("text is read by default; views and images are not")
    {
        A11yFixture f;
        f.build(R"(
            const box = createView();
            box.appendChild(createText('Gain'));
            box.appendChild(createImage());
            root.appendChild(box);
        )");
        CHECK(f.tree() == R"(view [text "Gain"])");
    }

    TEST_CASE("exposes roles, labels, hints, states, values and actions")
    {
        A11yFixture f;
        f.build(R"(
            globalThis.knob = createView({ left: 10, top: 20, width: 30, height: 40, position: 'absolute' });
            knob.accessibility = {
                role: 'adjustable', label: 'Gain', hint: 'Drag up or down',
                state: { busy: true, expanded: false, selected: true },
                value: { min: -60, max: 12, now: -3.5, text: '-3.5 dB' },
                actions: [{ name: 'increment' }, { name: 'decrement' }, { name: 'reset', label: 'Reset gain' }],
            };
            root.appendChild(knob);
        )");
        CHECK(f.tree() == R"(view [adjustable "Gain" =-3.5 ="-3.5 dB"])");
        const a11y::Node& knob = f.adapter.tree.find(f.adapter.tree.find(f.adapter.tree.root())->children.at(0))[0];
        CHECK(knob.hint == "Drag up or down");
        CHECK(knob.state.busy);
        CHECK(knob.state.expanded == false);
        CHECK(knob.state.selected == true);
        CHECK(knob.value.min == -60);
        CHECK(knob.value.max == 12);
        CHECK(knob.bounds == a11y::Rect { 10, 20, 30, 40 });
        REQUIRE(knob.actions.size() == 3);
        CHECK(knob.actions[0].action == a11y::Action::Increment);
        CHECK(knob.actions[1].action == a11y::Action::Decrement);
        CHECK(knob.actions[2].action == a11y::Action::Custom);
        CHECK(knob.actions[2].name == "reset");
        CHECK(knob.actions[2].label == "Reset gain");
        CHECK(knob.supports("reset"));
        CHECK_FALSE(knob.supports(a11y::Action::Activate));
    }

    TEST_CASE("checked states")
    {
        A11yFixture f;
        f.build(R"(
            for (const checked of [true, false, 'mixed']) {
                const box = createView();
                box.accessibility = { role: 'checkbox', label: String(checked), state: { checked } };
                root.appendChild(box);
            }
            const toggle = createView();
            toggle.accessibility = { role: 'switch', label: 'Bypass', state: { checked: true, disabled: true } };
            root.appendChild(toggle);
        )");
        CHECK(f.tree()
              == R"(view [checkbox "true" {checked}, checkbox "false", checkbox "mixed" {mixed}, )"
                 R"(switch "Bypass" {disabled} {checked}])");
    }

    TEST_CASE("an element read as a whole takes its descendants' text as its label")
    {
        A11yFixture f;
        f.build(R"(
            const button = createView();
            button.accessibility = { role: 'button' };
            const row = createView();
            row.appendChild(createText('Reset'));
            const icon = createImage();
            icon.accessibility = { label: 'all' };
            row.appendChild(icon);
            button.appendChild(row);
            button.appendChild(createText('  parameters '));
            root.appendChild(button);

            const labelled = createView();
            labelled.accessibility = { role: 'button', label: 'Close' };
            labelled.appendChild(createText('X'));
            root.appendChild(labelled);

            const group = createView();
            group.accessibility = { accessible: true };
            group.appendChild(createText('Input'));
            group.appendChild(createText('-12 dB'));
            root.appendChild(group);
        )");
        CHECK(f.tree() == R"(view [button "Reset all parameters", button "Close", group "Input -12 dB"])");
    }

    TEST_CASE("containers keep their elements")
    {
        A11yFixture f;
        f.build(R"(
            const bar = createView();
            bar.accessibility = { role: 'toolbar', label: 'Transport' };
            for (const name of ['Play', 'Stop']) {
                const button = createView();
                button.accessibility = { role: 'button' };
                button.appendChild(createText(name));
                bar.appendChild(button);
            }
            root.appendChild(bar);
        )");
        CHECK(f.tree() == R"(view [toolbar "Transport" [button "Play", button "Stop"]])");
    }

    TEST_CASE("accessible false removes the node, not its descendants")
    {
        A11yFixture f;
        f.build(R"(
            const box = createView();
            box.accessibility = { accessible: false, role: 'button', label: 'Hidden' };
            box.appendChild(createText('Still here'));
            root.appendChild(box);
            const text = createText('Not read');
            text.accessibility = { accessible: false };
            root.appendChild(text);
            const none = createView();
            none.accessibility = { role: 'none' };
            none.appendChild(createText('Through'));
            root.appendChild(none);
        )");
        CHECK(f.tree() == R"(view [text "Still here", text "Through"])");
    }

    TEST_CASE("images are read when labelled or given a role")
    {
        A11yFixture f;
        f.build(R"(
            const logo = createImage();
            logo.accessibility = { label: 'Soundor' };
            root.appendChild(logo);
            const meter = createImage();
            meter.accessibility = { role: 'image', label: 'Meter' };
            root.appendChild(meter);
            const decorative = createImage();
            root.appendChild(decorative);
        )");
        CHECK(f.tree() == R"(view [image "Soundor", image "Meter"])");
    }

    TEST_CASE("text inputs are read with their text, placeholder and editing actions")
    {
        A11yFixture f;
        f.build(std::string(R"(
            const input = createTextInput({ value: 'Init', placeholder: 'Preset name' });
            input.accessibility = { label: 'Preset', value: { text: 'ignored' } };
            root.appendChild(input);
            globalThis.input = input;
        )"));
        CHECK(f.tree() == R"(view [textinput "Preset" ="Init"])");
        const a11y::Node& input = f.node("Preset");
        CHECK(input.placeholder == "Preset name");
        CHECK(input.focusable);
        CHECK(input.supports(a11y::Action::Focus));
        CHECK(input.supports(a11y::Action::SetValue));
    }

    TEST_CASE("hidden and detached nodes are not read")
    {
        A11yFixture f;
        f.build(R"(
            const hidden = createView({ display: 'none' });
            hidden.appendChild(createText('Inside hidden'));
            root.appendChild(hidden);
            const gone = createText('Hidden itself');
            gone.style = { display: 'none' };
            root.appendChild(gone);
            const faint = createText('Transparent');
            faint.style = { opacity: 0 };
            root.appendChild(faint);
            createText('Detached');
        )");
        CHECK(f.tree() == R"(view [text "Transparent"])");
    }

    TEST_CASE("the overlay is read after the content")
    {
        A11yFixture f;
        f.build(R"(
            overlayRoot.appendChild(createText('Overlay'));
            root.appendChild(createText('Content'));
        )");
        CHECK(f.tree() == R"(view [text "Content", text "Overlay"])");
    }

    TEST_CASE("ids stay while the element does, and are never reused")
    {
        A11yFixture f;
        f.build(std::string(R"(
            const label = createText('Gain');
            root.appendChild(label);
            globalThis.label = label;
        )"));
        const a11y::NodeId first = f.element("Gain");
        CHECK(first != a11y::noNode);
        f.run(std::string(imports) + "label.text = 'Volume'; root.appendChild(createView());");
        f.sync();
        CHECK(f.element("Volume") == first);
        f.run(std::string(imports) + "label.remove();");
        f.sync();
        CHECK(f.element("Volume") == a11y::noNode);
        REQUIRE(f.adapter.last.removed.size() == 1);
        CHECK(f.adapter.last.removed[0] == first);
        f.run(std::string(imports) + "root.appendChild(label);");
        f.sync();
        CHECK(f.element("Volume") > first);
    }

    TEST_CASE("updates carry only what changed")
    {
        A11yFixture f;
        f.build(std::string(R"(
            const knob = createView({ width: 20, height: 20 });
            knob.accessibility = { role: 'adjustable', label: 'Gain', value: { now: 0 } };
            root.appendChild(knob);
            root.appendChild(createText('Other'));
            globalThis.knob = knob;
        )"));
        CHECK(f.adapter.last.full);
        CHECK(f.adapter.last.nodes.size() == 3);

        // Nothing changed: nothing to send, nothing recomputed.
        CHECK(f.semantics().update().empty());

        f.run(std::string(imports)
              + "knob.accessibility = { role: 'adjustable', label: 'Gain', value: { now: 0.25 } };");
        f.sync();
        CHECK_FALSE(f.adapter.last.full);
        REQUIRE(f.adapter.last.nodes.size() == 1);
        CHECK(f.adapter.last.nodes[0].id == f.element("Gain"));
        CHECK(f.adapter.last.nodes[0].value.now == 0.25);
        CHECK(f.adapter.last.removed.empty());

        // The same accessibility again: no change at all.
        f.run(std::string(imports)
              + "knob.accessibility = { role: 'adjustable', label: 'Gain', value: { now: 0.25 } };");
        CHECK(f.semantics().update().empty());

        // A move changes the bounds; a new child, its parent's children.
        f.run(std::string(imports) + "knob.style = { width: 20, height: 20, marginLeft: 5 };");
        f.sync();
        REQUIRE(f.adapter.last.nodes.size() == 1);
        CHECK(f.adapter.last.nodes[0].bounds.x == 5);
        f.run(std::string(imports) + "root.appendChild(createText('New'));");
        f.sync();
        CHECK(f.adapter.last.nodes.size() == 2); // the root and the new text
        CHECK(f.tree() == R"(view [adjustable "Gain" =0.25, text "Other", text "New"])");
    }

    TEST_CASE("actions reach the node's listeners, with fractional values")
    {
        A11yFixture f;
        f.build(std::string(R"(
            globalThis.log = [];
            const knob = createView({ width: 20, height: 20 });
            knob.accessibility = {
                role: 'adjustable', label: 'Gain', value: { min: -60, max: 12, now: -3.5 },
                actions: [{ name: 'increment' }, { name: 'setValue' }, { name: 'reset' }],
            };
            knob.addEventListener('accessibilityaction', (event) => {
                log.push(`${event.actionName}:${event.value}:${event.target === knob}`);
                event.preventDefault();
            });
            root.addEventListener('accessibilityaction', (event) => log.push('bubbled'));
            root.appendChild(knob);
            globalThis.knob = knob;
        )"));
        CHECK(f.perform("Gain", a11y::Action::Increment));
        CHECK(f.perform("Gain", a11y::Action::SetValue, {}, -2.25));
        CHECK(f.perform("Gain", a11y::Action::Custom, "reset"));
        CHECK(f.eval("log.join(' ')").asString()
              == "increment:undefined:true bubbled setValue:-2.25:true bubbled reset:undefined:true bubbled");

        // What the element does not offer is refused before reaching it.
        CHECK_FALSE(f.perform("Gain", a11y::Action::Decrement));
        CHECK_FALSE(f.perform("Gain", a11y::Action::Custom, "other"));
        CHECK_FALSE(f.perform("Gain", a11y::Action::Custom, "increment"));
        CHECK(f.eval("log.length").asNumber() == 6);
    }

    TEST_CASE("requests for elements that have gone are refused safely")
    {
        A11yFixture f;
        f.build(std::string(R"(
            globalThis.log = [];
            const button = createView();
            button.accessibility = { role: 'button', label: 'Go', actions: [{ name: 'activate' }] };
            button.addEventListener('accessibilityaction', () => log.push('acted'));
            root.appendChild(button);
            globalThis.button = button;
        )"));
        const a11y::NodeId id = f.element("Go");
        // Gone from the view, but the tree has not been updated yet.
        f.run(std::string(imports) + "button.remove();");
        CHECK_FALSE(f.host.performAccessibilityAction({ id, a11y::Action::Activate }));
        f.sync();
        CHECK_FALSE(f.host.performAccessibilityAction({ id, a11y::Action::Activate }));
        // Released natively, and an id that never was.
        f.run("globalThis.button = undefined;");
        f.host.runtime().collectGarbage();
        CHECK_FALSE(f.host.performAccessibilityAction({ id, a11y::Action::Activate }));
        CHECK_FALSE(f.host.performAccessibilityAction({ id + 1000, a11y::Action::Activate }));
        CHECK_FALSE(f.host.performAccessibilityAction({ f.adapter.tree.root(), a11y::Action::Activate }));
        CHECK(f.eval("log.length").asNumber() == 0);
    }

    TEST_CASE("disabled elements refuse actions other than focus")
    {
        A11yFixture f;
        f.build(std::string(R"(
            globalThis.log = [];
            const button = createView();
            button.accessibility = { role: 'button', label: 'Go', state: { disabled: true },
                                     actions: [{ name: 'activate' }] };
            button.addEventListener('accessibilityaction', () => log.push('acted'));
            root.appendChild(button);
            globalThis.button = button;
        )"));
        CHECK_FALSE(f.perform("Go", a11y::Action::Activate));
        CHECK(f.eval("log.length").asNumber() == 0);
    }

    TEST_CASE("activate presses a pressable as a click does")
    {
        A11yFixture f;
        f.build(std::string(R"(
            globalThis.log = [];
            const button = createView({ width: 20, height: 20 });
            button.accessibility = { role: 'button', label: 'Go',
                                     actions: [{ name: 'activate' }, { name: 'longpress' }] };
            pressable(button, {
                onPress: (event) => log.push(`press:${event.type}:${event.actionName}`),
                onLongPress: (event) => log.push(`long:${event.actionName}`),
            });
            root.appendChild(button);
            globalThis.button = button;
        )"));
        CHECK(f.perform("Go", a11y::Action::Activate));
        CHECK(f.perform("Go", a11y::Action::LongPress));
        CHECK(f.eval("log.join(' ')").asString() == "press:accessibilityaction:activate long:longpress");
        // Pressing does not move keyboard focus.
        CHECK(f.host.surface().focused() == ui::noNode);
    }

    TEST_CASE("focus is a request for keyboard focus; the tree reports where it is")
    {
        A11yFixture f;
        f.build(std::string(R"(
            const input = createTextInput();
            input.accessibility = { label: 'Name' };
            root.appendChild(input);
            const button = createView();
            button.accessibility = { role: 'button', label: 'Inner' };
            button.focusable = true;
            const inner = createView();
            inner.focusable = true;
            button.appendChild(inner);
            root.appendChild(button);
            globalThis.input = input;
            globalThis.button = button;
            globalThis.inner = inner;
        )"));
        CHECK(f.adapter.last.focus == a11y::noNode);
        CHECK(f.perform("Name", a11y::Action::Focus));
        CHECK(f.eval("input.focused").asBoolean());
        f.sync();
        CHECK(f.adapter.tree.focus() == f.element("Name"));

        // A focused node that is no element is reported as the element it is in.
        f.run("inner.focus();");
        f.sync();
        CHECK(f.adapter.tree.focus() == f.element("Inner"));
        CHECK_FALSE(f.perform("Inner", a11y::Action::Blur)); // not offered
    }

    TEST_CASE("text inputs take their text and focus from assistive technology")
    {
        A11yFixture f;
        f.build(std::string(R"(
            globalThis.log = [];
            const input = createTextInput({ value: 'Old' });
            input.accessibility = { label: 'Name' };
            input.addEventListener('input', (event) => log.push(`input:${event.inputType}:${input.value}`));
            input.addEventListener('change', () => log.push(`change:${input.value}`));
            root.appendChild(input);
            globalThis.input = input;
        )"));
        CHECK(f.perform("Name", a11y::Action::SetValue, {}, std::string("New\nname")));
        CHECK(f.eval("log.join(' ')").asString() == "input:insertReplacementText:New name change:New name");
        CHECK_FALSE(f.perform("Name", a11y::Action::SetValue, {}, 3.0));
        f.sync();
        CHECK(f.node("Name").value.text == "New name");
    }

    TEST_CASE("keyboard focus moves only when asked: activating an input, not reading text")
    {
        A11yFixture f;
        f.build(std::string(R"(
            const input = createTextInput();
            input.accessibility = { label: 'Name' };
            root.appendChild(input);
            root.appendChild(createText('Static'));
            const other = createTextInput();
            other.accessibility = { label: 'Other' };
            root.appendChild(other);
            globalThis.input = input;
            globalThis.other = other;
        )"));
        f.run("other.focus();");
        // Reading the tree, however often, leaves keyboard focus alone.
        for (int i = 0; i < 3; ++i)
            f.sync();
        CHECK(f.eval("other.focused").asBoolean());
        // Text cannot be focused: the request is refused, focus stays.
        CHECK_FALSE(f.perform("Static", a11y::Action::Focus));
        CHECK_FALSE(f.perform("Static", a11y::Action::Activate));
        CHECK(f.eval("other.focused").asBoolean());
        // Activating an input starts editing it.
        CHECK(f.node("Name").supports(a11y::Action::Activate));
        CHECK(f.perform("Name", a11y::Action::Activate));
        CHECK(f.eval("input.focused").asBoolean());
        f.sync();
        CHECK(f.adapter.tree.focus() == f.element("Name"));
    }

    TEST_CASE("a modal element hides everything else, and the last one shown wins")
    {
        A11yFixture f;
        f.build(R"(
            root.appendChild(createText('Background'));
            globalThis.first = createView();
            first.accessibility = { modal: true, label: 'Settings' };
            first.appendChild(createText('First'));
            overlayRoot.appendChild(first);
        )");
        CHECK(f.tree() == R"(view [dialog "Settings" [text "First"]])");

        f.run(std::string(imports) + R"(
            globalThis.second = createView();
            second.accessibility = { modal: true, role: 'alert', label: 'Sure?' };
            second.appendChild(createText('Second'));
            overlayRoot.appendChild(second);
        )");
        f.sync();
        CHECK(f.tree() == R"(view [alert "Sure?" [text "Second"]])");

        f.run("second.remove();");
        f.sync();
        CHECK(f.tree() == R"(view [dialog "Settings" [text "First"]])");
        f.run("first.style = { display: 'none' };");
        f.sync();
        CHECK(f.tree() == R"(view [text "Background"])");
    }

    TEST_CASE("an accessibility parent reads overlay content where it belongs")
    {
        A11yFixture f;
        f.build(R"(
            root.appendChild(createText('Background'));
            // A modal in the overlay, and a menu a portal inside it opened in
            // another overlay entry.
            const modal = createView();
            modal.accessibility = { modal: true, label: 'Preset' };
            modal.appendChild(createText('Name'));
            overlayRoot.appendChild(modal);
            const menu = createView();
            menu.accessibility = { role: 'menu' };
            const item = createView();
            item.accessibility = { role: 'menuitem', label: 'Save' };
            menu.appendChild(item);
            overlayRoot.appendChild(menu);
            menu.accessibilityParent = modal;
            globalThis.menu = menu;
            globalThis.modal = modal;
        )");
        CHECK(f.tree() == R"(view [dialog "Preset" [text "Name", menu [menuitem "Save"]]])");

        // Without the modal, the menu is still read with it.
        f.run("modal.accessibility = { label: 'Preset', role: 'summary' };");
        f.sync();
        CHECK(f.tree() == R"(view [text "Background", summary "Preset" [text "Name", menu [menuitem "Save"]]])");

        // Its parent hidden or gone, so is it.
        f.run("modal.style = { display: 'none' };");
        f.sync();
        CHECK(f.tree() == R"(view [text "Background"])");
        f.run("modal.remove();");
        f.sync();
        CHECK(f.tree() == R"(view [text "Background", menu [menuitem "Save"]])");
    }

    TEST_CASE("accessibility parents that loop are ignored")
    {
        A11yFixture f;
        f.build(R"(
            const a = createView();
            const b = createView();
            a.appendChild(createText('A'));
            b.appendChild(createText('B'));
            overlayRoot.appendChild(a);
            overlayRoot.appendChild(b);
            a.accessibilityParent = b;
            b.accessibilityParent = a;
            // A parent inside the node itself.
            const outer = createView();
            const inner = createView();
            outer.appendChild(inner);
            outer.appendChild(createText('Outer'));
            root.appendChild(outer);
            outer.accessibilityParent = inner;
        )");
        CHECK(f.tree() == R"(view [text "Outer", text "A", text "B"])");
    }

    TEST_CASE("plugin code is told about invalid accessibility")
    {
        A11yFixture f;
        f.build("globalThis.node = createView();");
        CHECK(f.error(std::string(imports) + "node.accessibility = { role: 'slider' };")
                  .find("accessibility.role: unknown role 'slider'")
              != std::string::npos);
        CHECK(f.error(std::string(imports) + "node.accessibility = { label: 3 };")
                  .find("accessibility.label: expected a string, got number")
              != std::string::npos);
        CHECK(f.error(std::string(imports) + "node.accessibility = { state: { checked: 'yes' } };")
                  .find("accessibility.state.checked: expected a boolean or 'mixed'")
              != std::string::npos);
        CHECK(f.error(std::string(imports) + "node.accessibility = { value: { now: NaN } };")
                  .find("accessibility.value.now: expected a finite number")
              != std::string::npos);
        CHECK(f.error(std::string(imports) + "node.accessibility = { actions: [{ name: '' }] };")
                  .find("accessibility.actions[0].name: must not be empty")
              != std::string::npos);
        CHECK(f.error(std::string(imports) + "node.accessibilityParent = {};").find("must be a UiNode")
              != std::string::npos);
        CHECK(f.error(std::string(imports) + "node.accessibilityParent = node;").find("its own accessibility parent")
              != std::string::npos);
        // What was given is kept, frozen.
        f.run(std::string(imports) + R"(
            node.accessibility = { role: 'button', state: { disabled: true }, actions: [{ name: 'activate' }] };
            globalThis.result = JSON.stringify([node.accessibility, Object.isFrozen(node.accessibility),
                Object.isFrozen(node.accessibility.state), Object.isFrozen(node.accessibility.actions[0])]);
        )");
        CHECK(f.eval("result").asString()
              == R"([{"role":"button","state":{"disabled":true},"actions":[{"name":"activate"}]},true,true,true])");
    }
}
