// The AccessKit backend: Soundor's semantics in AccessKit's terms, and the
// platform-independent part of the adapters (activation, the request queue,
// incremental updates), with the platform replaced by a recorder.

#include "../web/WebTestSupport.h"
#include "a11y/accesskit/AccessKitPlatform.h"
#include "a11y/accesskit/Mapping.h"

#include <soundor/a11y/Platform.h>

#include <memory>
#include <string>
#include <utility>
#include <vector>

using namespace soundor;
using namespace soundor::a11y;
using test::WebFixture;

namespace
{
    // An AccessKit node, freed with the test.
    struct Owned
    {
        explicit Owned(accesskit_node* created) : node(created) {}
        ~Owned() { accesskit_node_free(node); }
        Owned(const Owned&) = delete;
        Owned& operator=(const Owned&) = delete;
        accesskit_node* node;
    };

    std::string take(char* text)
    {
        std::string out = text != nullptr ? text : "";
        if (text != nullptr)
            accesskit_string_free(text);
        return out;
    }

    Node knob()
    {
        Node node;
        node.id = 7;
        node.role = Role::Adjustable;
        node.label = "Gain";
        node.hint = "Drag up or down";
        node.value = { -60, 12, -3.5, "-3.5 dB" };
        node.bounds = { 10, 20, 30, 40 };
        node.actions = { { Action::Increment, "increment", {} },
                         { Action::Decrement, "decrement", {} },
                         { Action::Custom, "reset", "Reset gain" },
                         { Action::Escape, "escape", {} },
                         { Action::SetValue, "setValue", {} } };
        return node;
    }

    // An adapter whose platform is this recorder: it takes every update as
    // AccessKit's debug text.
    struct RecordingPlatform final : detail::AccessKitPlatform
    {
        RecordingPlatform() : AccessKitPlatform("Test Plugin") {}

        void setFocused(bool) override {}
        void accept(bool taking) { takes = taking; }

        std::vector<std::string> updates;

    protected:
        void send(detail::Pending* pending) override
        {
            if (! takes)
                return;
            accesskit_tree_update* update = detail::buildUpdate(pending);
            updates.push_back(take(accesskit_tree_update_debug(update)));
            accesskit_tree_update_free(update);
        }

    private:
        bool takes = true;
    };

    RuntimeHost::Options approximateText()
    {
        RuntimeHost::Options options;
        options.textEngine = ui::approximateTextEngine();
        return options;
    }

    struct PlatformFixture : WebFixture
    {
        PlatformFixture() : WebFixture(approximateText())
        {
            host.surface().setSize({ 200, 100 });
            run(R"(
                import { root, createView, createText } from 'soundor:ui';
                globalThis.log = [];
                globalThis.value = -3.5;
                globalThis.knob = createView({ width: 40, height: 40 });
                globalThis.describe = () => {
                    knob.accessibility = {
                        role: 'adjustable', label: 'Gain', value: { min: -60, max: 12, now: value },
                        actions: [{ name: 'increment' }, { name: 'decrement' }, { name: 'reset', label: 'Reset' }],
                    };
                };
                describe();
                knob.addEventListener('accessibilityaction', (event) => {
                    log.push(event.actionName + (event.value === undefined ? '' : ':' + event.value));
                    // The control's own state, as a pointer drag would change it.
                    if (event.actionName === 'increment') value += 0.5;
                    if (event.actionName === 'decrement') value -= 0.5;
                    describe();
                    event.preventDefault();
                });
                root.appendChild(knob);
                root.appendChild(createText('Label'));
            )");
        }

        void activate() { detail::activate(detail::tokenPointer(platform.token())); }
        void request(accesskit_action action, NodeId target,
                     std::variant<std::monostate, std::int32_t, std::string, double> data = {})
        {
            detail::deliver(detail::tokenPointer(platform.token()), { action, target, std::move(data) });
        }

        NodeId knobId()
        {
            const NodeId root = host.accessibility().tree().root();
            return host.accessibility().tree().find(root)->children.at(0);
        }

        RecordingPlatform platform;
    };
} // namespace

TEST_SUITE("a11y AccessKit mapping")
{
    TEST_CASE("every role plugin code can name has an AccessKit role")
    {
        const std::pair<Role, accesskit_role> expected[] = {
            { Role::Text, ACCESSKIT_ROLE_LABEL },
            { Role::Image, ACCESSKIT_ROLE_IMAGE },
            { Role::Button, ACCESSKIT_ROLE_BUTTON },
            { Role::Link, ACCESSKIT_ROLE_LINK },
            { Role::Adjustable, ACCESSKIT_ROLE_SLIDER },
            { Role::CheckBox, ACCESSKIT_ROLE_CHECK_BOX },
            { Role::Switch, ACCESSKIT_ROLE_SWITCH },
            { Role::ToggleButton, ACCESSKIT_ROLE_BUTTON },
            { Role::Radio, ACCESSKIT_ROLE_RADIO_BUTTON },
            { Role::RadioGroup, ACCESSKIT_ROLE_RADIO_GROUP },
            { Role::ProgressBar, ACCESSKIT_ROLE_PROGRESS_INDICATOR },
            { Role::Search, ACCESSKIT_ROLE_SEARCH },
            { Role::ComboBox, ACCESSKIT_ROLE_COMBO_BOX },
            { Role::Menu, ACCESSKIT_ROLE_MENU },
            { Role::MenuBar, ACCESSKIT_ROLE_MENU_BAR },
            { Role::MenuItem, ACCESSKIT_ROLE_MENU_ITEM },
            { Role::ScrollBar, ACCESSKIT_ROLE_SCROLL_BAR },
            { Role::SpinButton, ACCESSKIT_ROLE_SPIN_BUTTON },
            { Role::Tab, ACCESSKIT_ROLE_TAB },
            { Role::TabList, ACCESSKIT_ROLE_TAB_LIST },
            { Role::Header, ACCESSKIT_ROLE_HEADING },
            { Role::Summary, ACCESSKIT_ROLE_GROUP },
            { Role::KeyboardKey, ACCESSKIT_ROLE_BUTTON },
            { Role::Timer, ACCESSKIT_ROLE_TIMER },
            { Role::Toolbar, ACCESSKIT_ROLE_TOOLBAR },
            { Role::Alert, ACCESSKIT_ROLE_ALERT },
            { Role::Dialog, ACCESSKIT_ROLE_DIALOG },
            { Role::Group, ACCESSKIT_ROLE_GROUP },
            { Role::TextInput, ACCESSKIT_ROLE_TEXT_INPUT },
            { Role::ScrollView, ACCESSKIT_ROLE_SCROLL_VIEW },
            { Role::View, ACCESSKIT_ROLE_PANE },
        };
        for (const auto& [role, accesskit] : expected)
        {
            CAPTURE(static_cast<int>(role));
            CHECK(detail::toAccessKit(role) == accesskit);
        }
        // Every public name, round trip.
        for (int i = static_cast<int>(Role::Text); i <= static_cast<int>(Role::Dialog); ++i)
            CHECK(roleFromName(roleName(static_cast<Role>(i))) == static_cast<Role>(i));
    }

    TEST_CASE("an adjustable: label, hint, fractional range, value text, bounds and actions")
    {
        const Owned node(detail::toAccessKit(knob(), {}, false));
        CHECK(accesskit_node_role(node.node) == ACCESSKIT_ROLE_SLIDER);
        CHECK(take(accesskit_node_label(node.node)) == "Gain");
        CHECK(take(accesskit_node_description(node.node)) == "Drag up or down");
        CHECK(take(accesskit_node_value(node.node)) == "-3.5 dB");
        CHECK(accesskit_node_numeric_value(node.node).value == -3.5);
        CHECK(accesskit_node_min_numeric_value(node.node).value == -60);
        CHECK(accesskit_node_max_numeric_value(node.node).value == 12);
        const accesskit_opt_rect bounds = accesskit_node_bounds(node.node);
        REQUIRE(bounds.has_value);
        CHECK(bounds.value.x0 == 10);
        CHECK(bounds.value.y1 == 60);
        CHECK(accesskit_node_supports_action(node.node, ACCESSKIT_ACTION_INCREMENT));
        CHECK(accesskit_node_supports_action(node.node, ACCESSKIT_ACTION_DECREMENT));
        CHECK(accesskit_node_supports_action(node.node, ACCESSKIT_ACTION_SET_VALUE));
        CHECK(accesskit_node_supports_action(node.node, ACCESSKIT_ACTION_CUSTOM_ACTION));
        CHECK_FALSE(accesskit_node_supports_action(node.node, ACCESSKIT_ACTION_CLICK));
        accesskit_custom_actions* custom = accesskit_node_custom_actions(node.node);
        REQUIRE(custom->length == 1);
        CHECK(accesskit_custom_action_id(custom->values[0]) == 2);
        CHECK(take(accesskit_custom_action_description(custom->values[0])) == "Reset gain");
        accesskit_custom_actions_free(custom);
    }

    TEST_CASE("states")
    {
        Node node;
        node.role = Role::CheckBox;
        node.label = "Sync";
        node.state = { true, true, Checked::Mixed, false, true };
        node.modal = true;
        const Owned mapped(detail::toAccessKit(node, {}, false));
        CHECK(accesskit_node_is_disabled(mapped.node));
        CHECK(accesskit_node_is_busy(mapped.node));
        CHECK(accesskit_node_is_modal(mapped.node));
        CHECK(accesskit_node_toggled(mapped.node).value == ACCESSKIT_TOGGLED_MIXED);
        CHECK(accesskit_node_is_selected(mapped.node).has_value);
        CHECK_FALSE(accesskit_node_is_selected(mapped.node).value);
        CHECK(accesskit_node_is_expanded(mapped.node).value);

        node.state = {};
        const Owned plain(detail::toAccessKit(node, {}, false));
        CHECK_FALSE(accesskit_node_is_disabled(plain.node));
        CHECK_FALSE(accesskit_node_toggled(plain.node).has_value);
        CHECK_FALSE(accesskit_node_is_selected(plain.node).has_value);
    }

    TEST_CASE("text is read as its value; inputs by label, text and placeholder")
    {
        Node text;
        text.role = Role::Text;
        text.label = "Hello";
        const Owned label(detail::toAccessKit(text, {}, false));
        CHECK(take(accesskit_node_value(label.node)) == "Hello");
        CHECK(take(accesskit_node_label(label.node)).empty());

        Node input;
        input.role = Role::TextInput;
        input.label = "Preset";
        input.placeholder = "Untitled";
        input.actions = { { Action::Focus, "focus", {} }, { Action::SetValue, "setValue", {} } };
        const Owned field(detail::toAccessKit(input, {}, false));
        CHECK(accesskit_node_role(field.node) == ACCESSKIT_ROLE_TEXT_INPUT);
        CHECK(take(accesskit_node_label(field.node)) == "Preset");
        CHECK(take(accesskit_node_value(field.node)).empty());
        CHECK(take(accesskit_node_placeholder(field.node)) == "Untitled");
        CHECK(accesskit_node_supports_action(field.node, ACCESSKIT_ACTION_FOCUS));
    }

    TEST_CASE("the root is named after the plugin and placed in the view")
    {
        Node root;
        root.role = Role::View;
        root.bounds = { 0, 0, 200, 100 };
        root.children = { 3, 4 };
        const Owned mapped(detail::toAccessKit(root, { "Delay", 2, 5, 6 }, true));
        CHECK(accesskit_node_role(mapped.node) == ACCESSKIT_ROLE_PANE);
        CHECK(take(accesskit_node_label(mapped.node)) == "Delay");
        const accesskit_node_ids children = accesskit_node_children(mapped.node);
        REQUIRE(children.length == 2);
        CHECK(children.values[1] == 4);
        const accesskit_affine* transform = accesskit_node_transform(mapped.node);
        REQUIRE(transform != nullptr);
        CHECK(transform->_0[0] == 2);
        CHECK(transform->_0[3] == 2);
        CHECK(transform->_0[4] == 5);
        CHECK(transform->_0[5] == 6);
    }

    TEST_CASE("AccessKit's requests in Soundor's terms")
    {
        Tree tree;
        TreeUpdate update;
        update.full = true;
        update.root = 1;
        Node root;
        root.id = 1;
        root.role = Role::View;
        root.children = { 7 };
        update.nodes = { root, knob() };
        tree.apply(update);

        using Data = std::variant<std::monostate, std::int32_t, std::string, double>;
        const auto convert = [&](accesskit_action action, NodeId target, Data data = {})
        { return detail::toSoundor({ action, target, std::move(data) }, tree); };
        // A conversion that must succeed.
        const auto convertTo = [&](accesskit_action action, NodeId target, Data data = {})
        {
            const auto converted = convert(action, target, std::move(data));
            REQUIRE(converted.has_value());
            return converted.value_or(ActionRequest {});
        };

        CHECK(convertTo(ACCESSKIT_ACTION_CLICK, 7).action == Action::Activate);
        CHECK(convertTo(ACCESSKIT_ACTION_INCREMENT, 7).action == Action::Increment);
        CHECK(convertTo(ACCESSKIT_ACTION_DECREMENT, 7).action == Action::Decrement);
        CHECK(convertTo(ACCESSKIT_ACTION_FOCUS, 7).action == Action::Focus);
        CHECK(convertTo(ACCESSKIT_ACTION_BLUR, 7).action == Action::Blur);
        CHECK(convertTo(ACCESSKIT_ACTION_EXPAND, 7).action == Action::Expand);
        CHECK(convertTo(ACCESSKIT_ACTION_COLLAPSE, 7).action == Action::Collapse);
        CHECK(std::get<double>(convertTo(ACCESSKIT_ACTION_SET_VALUE, 7, 2.25).value) == 2.25);
        CHECK(std::get<std::string>(convertTo(ACCESSKIT_ACTION_SET_VALUE, 7, std::string("hi")).value) == "hi");
        CHECK_FALSE(convert(ACCESSKIT_ACTION_SET_VALUE, 7).has_value());
        const ActionRequest custom = convertTo(ACCESSKIT_ACTION_CUSTOM_ACTION, 7, std::int32_t { 2 });
        CHECK(custom.action == Action::Custom);
        CHECK(custom.name == "reset");
        // Ids that are not a custom action of that node, and nodes that are gone.
        CHECK_FALSE(convert(ACCESSKIT_ACTION_CUSTOM_ACTION, 7, std::int32_t { 0 }).has_value());
        CHECK_FALSE(convert(ACCESSKIT_ACTION_CUSTOM_ACTION, 7, std::int32_t { 99 }).has_value());
        CHECK_FALSE(convert(ACCESSKIT_ACTION_CUSTOM_ACTION, 8, std::int32_t { 2 }).has_value());
        CHECK_FALSE(convert(ACCESSKIT_ACTION_SCROLL_DOWN, 7).has_value());
    }
}

TEST_SUITE("a11y AccessKit adapter")
{
    TEST_CASE("does nothing until assistive technology asks, then sends the whole tree")
    {
        PlatformFixture f;
        f.platform.tick(f.host);
        CHECK_FALSE(f.platform.active());
        CHECK(f.platform.updates.empty());

        f.activate();
        CHECK(f.platform.active());
        f.platform.tick(f.host);
        REQUIRE(f.platform.updates.size() == 1);
        const std::string& full = f.platform.updates[0];
        CHECK(full.find("Soundor") != std::string::npos); // the tree's toolkit
        CHECK(full.find("Test Plugin") != std::string::npos);
        CHECK(full.find("Slider") != std::string::npos);
        CHECK(full.find("Label") != std::string::npos);

        // Nothing changed: nothing sent.
        f.platform.tick(f.host);
        CHECK(f.platform.updates.size() == 1);
    }

    TEST_CASE("increment goes through the control, and only its change comes back")
    {
        PlatformFixture f;
        f.activate();
        f.platform.tick(f.host);
        const NodeId knob = f.knobId();
        f.request(ACCESSKIT_ACTION_INCREMENT, knob);
        f.request(ACCESSKIT_ACTION_CUSTOM_ACTION, knob, std::int32_t { 2 });
        f.request(ACCESSKIT_ACTION_SET_VALUE, knob, 1.25);
        // Queued: nothing happens off the UI thread's tick.
        CHECK(f.eval("log.length").asNumber() == 0);
        f.platform.tick(f.host);
        CHECK(f.eval("log.join(' ')").asString() == "increment reset");
        CHECK(f.eval("value").asNumber() == -3);
        REQUIRE(f.platform.updates.size() == 2);
        const std::string& changed = f.platform.updates[1];
        CHECK(changed.find("Slider") != std::string::npos);
        CHECK(changed.find("Label") == std::string::npos);
        CHECK(changed.find("-3.0") != std::string::npos);
    }

    TEST_CASE("requests for nodes that have gone, or from before a reload, do nothing")
    {
        PlatformFixture f;
        f.activate();
        f.platform.tick(f.host);
        const NodeId knob = f.knobId();
        f.run("knob.remove();");
        f.request(ACCESSKIT_ACTION_INCREMENT, knob);
        f.request(ACCESSKIT_ACTION_CLICK, knob + 1000);
        f.platform.tick(f.host);
        CHECK(f.eval("log.length").asNumber() == 0);

        // A new host (a reload): the old ids mean nothing there, and it gets
        // the whole tree.
        PlatformFixture other;
        f.request(ACCESSKIT_ACTION_INCREMENT, knob);
        const auto before = f.platform.updates.size();
        f.platform.tick(other.host);
        CHECK(other.eval("log.length").asNumber() == 0);
        REQUIRE(f.platform.updates.size() == before + 1);
        CHECK(f.platform.updates.back().find("Soundor") != std::string::npos);
    }

    TEST_CASE("geometry changes send the root again")
    {
        PlatformFixture f;
        f.activate();
        f.platform.tick(f.host);
        f.platform.setGeometry({ 4, 8, 2, {} });
        f.platform.tick(f.host);
        REQUIRE(f.platform.updates.size() == 2);
        CHECK(f.platform.updates[1].find("Pane") != std::string::npos);
        CHECK(f.platform.updates[1].find("Slider") == std::string::npos);
        f.platform.setGeometry({ 4, 8, 2, {} });
        f.platform.tick(f.host);
        CHECK(f.platform.updates.size() == 2);
    }

    TEST_CASE("an update the platform did not take is sent whole next time")
    {
        PlatformFixture f;
        f.activate();
        f.platform.accept(false);
        f.platform.tick(f.host);
        CHECK(f.platform.updates.empty());
        f.platform.accept(true);
        f.platform.tick(f.host);
        REQUIRE(f.platform.updates.size() == 1);
        CHECK(f.platform.updates[0].find("Soundor") != std::string::npos);
    }

    TEST_CASE("deactivation stops updates; reactivation starts with the whole tree")
    {
        PlatformFixture f;
        f.activate();
        f.platform.tick(f.host);
        detail::deactivate(detail::tokenPointer(f.platform.token()));
        f.run("describe(value = 0);");
        f.platform.tick(f.host);
        CHECK(f.platform.updates.size() == 1);
        f.activate();
        f.platform.tick(f.host);
        REQUIRE(f.platform.updates.size() == 2);
        CHECK(f.platform.updates[1].find("Soundor") != std::string::npos);
    }

    TEST_CASE("callbacks for an adapter that is gone are ignored")
    {
        std::uintptr_t token = 0;
        {
            RecordingPlatform platform;
            token = platform.token();
        }
        CHECK(detail::activate(detail::tokenPointer(token)) == nullptr);
        detail::deactivate(detail::tokenPointer(token));
        detail::deliver(detail::tokenPointer(token), { ACCESSKIT_ACTION_CLICK, 1, {} });
        detail::deliver(detail::tokenPointer(0), { ACCESSKIT_ACTION_CLICK, 1, {} });
    }

    TEST_CASE("the platform's own adapter can be made, ticked and destroyed")
    {
        PlatformFixture f;
        // Linux: AT-SPI with no session bus here; Windows needs a window.
        auto platform = createPlatformAccessibility({ {}, "Test Plugin" });
#if defined(__linux__)
        REQUIRE(platform != nullptr);
        platform->setGeometry({ 0, 0, 1, { 0, 0, 200, 100 } });
        platform->setFocused(true);
        for (int i = 0; i < 3; ++i)
            platform->tick(f.host);
        platform.reset();
#else
        CHECK(platform == nullptr);
#endif
    }
}
