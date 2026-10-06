#pragma once

#include <soundor/Config.h>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
{
    // Soundor's own accessibility semantics: what assistive technology (a
    // screen reader, switch control) perceives of a plugin view. Platform
    // adapters (AccessKit, the Apple bridge) translate these types into their
    // platform's; nothing here belongs to a platform or a plugin framework.

    // Identifies a semantic node for as long as it exists. Never reused within
    // a process, so a request naming a node that has gone finds nothing.
    using NodeId = std::uint64_t;
    inline constexpr NodeId noNode = 0;

    enum class Role : std::uint8_t
    {
        // The roles plugin code can name (`accessibilityRole`).
        None, // no role: not an element unless made accessible
        Text,
        Image,
        Button,
        Link,
        Adjustable, // a slider, knob or fader
        CheckBox,
        Switch,
        ToggleButton,
        Radio,
        RadioGroup,
        ProgressBar,
        Search,
        ComboBox,
        Menu,
        MenuBar,
        MenuItem,
        ScrollBar,
        SpinButton,
        Tab,
        TabList,
        Header,
        Summary,
        KeyboardKey,
        Timer,
        Toolbar,
        Alert,
        Dialog,

        // Roles the runtime gives by itself.
        Group,     // an element without a role of its own
        TextInput, // a text input node
        ScrollView,
        View, // the plugin view: the root of the tree
    };

    // The role's name in `accessibilityRole`, or empty for the runtime's own.
    [[nodiscard]] std::string_view roleName(Role role) noexcept;
    // The role `accessibilityRole` names.
    [[nodiscard]] std::optional<Role> roleFromName(std::string_view name) noexcept;

    // Whether an element of this role is read as a whole: its descendants are
    // its content (its label, when it has none), not elements of their own.
    [[nodiscard]] bool isLeafRole(Role role) noexcept;

    enum class Checked : std::uint8_t
    {
        Unset, // not something that can be checked
        False,
        True,
        Mixed,
    };

    struct State
    {
        bool disabled = false;
        bool busy = false;
        Checked checked = Checked::Unset;
        // Unset: not something that can be selected / expanded.
        std::optional<bool> selected;
        std::optional<bool> expanded;

        friend bool operator==(const State&, const State&) = default;
    };

    // A range's value (an adjustable, a progress bar), or a textual one.
    // Fractional: audio parameters rarely are integers.
    struct Value
    {
        std::optional<double> min;
        std::optional<double> max;
        std::optional<double> now;
        // How to read the value ("-3.5 dB"); a text input's text.
        std::string text;

        friend bool operator==(const Value&, const Value&) = default;
    };

    enum class Action : std::uint8_t
    {
        Activate,
        Increment,
        Decrement,
        LongPress,
        Expand,
        Collapse,
        Escape,
        // Requests keyboard focus. Assistive technology moving its own cursor
        // (VoiceOver, Narrator) is not this: that changes nothing in the view.
        Focus,
        Blur,
        SetValue, // with a number (a range) or a string (a text input)
        Custom,   // named by the plugin
    };

    // The action's name in `accessibilityActions` ("activate", "setValue").
    [[nodiscard]] std::string_view actionName(Action action) noexcept;
    // The standard action `name` is, or Custom.
    [[nodiscard]] Action actionFromName(std::string_view name) noexcept;

    // An action an element responds to.
    struct ActionDescriptor
    {
        Action action = Action::Custom;
        std::string name;  // the action's name, standard or custom
        std::string label; // how to present a custom action; may be empty

        friend bool operator==(const ActionDescriptor&, const ActionDescriptor&) = default;
    };

    // What plugin code says about one node of its view (`node.accessibility`).
    // The runtime fills in the rest from the node itself: its type, text,
    // focusability and place in the tree.
    struct Properties
    {
        // true: the node is an element; false: it is not (its descendants may
        // be); unset: decided by its type and the other properties.
        std::optional<bool> accessible;
        std::optional<Role> role;
        std::string label;
        std::string hint;
        State state;
        Value value;
        std::vector<ActionDescriptor> actions;
        // While shown, only this element (and what it owns) is perceived.
        bool modal = false;

        friend bool operator==(const Properties&, const Properties&) = default;
    };

    // In the view's logical pixels, relative to its top-left corner.
    struct Rect
    {
        float x = 0;
        float y = 0;
        float width = 0;
        float height = 0;

        friend bool operator==(const Rect&, const Rect&) = default;
    };

    // A semantic node: an element assistive technology perceives.
    struct Node
    {
        NodeId id = noNode;
        Role role = Role::Group;
        std::string label;
        std::string hint;
        std::string placeholder; // text inputs: shown while empty
        State state;
        Value value;
        std::vector<ActionDescriptor> actions;
        Rect bounds;
        bool focusable = false;
        bool modal = false;
        std::vector<NodeId> children;

        [[nodiscard]] bool supports(Action action) const noexcept;
        [[nodiscard]] bool supports(std::string_view name) const noexcept;

        friend bool operator==(const Node&, const Node&) = default;
    };

    // The changes to a tree, for a platform adapter: the nodes created or
    // changed (whole), and those removed. The first update after an adapter
    // attaches has every node.
    struct TreeUpdate
    {
        std::vector<Node> nodes;
        std::vector<NodeId> removed;
        NodeId root = noNode;
        // The element with keyboard focus (or holding the node that has it);
        // noNode when nothing has focus.
        NodeId focus = noNode;
        // Every node of the tree is in `nodes`: the adapter drops what it had.
        bool full = false;

        [[nodiscard]] bool empty() const noexcept { return nodes.empty() && removed.empty() && ! full; }
    };

    // A whole tree, kept up to date by updates: what an adapter answers
    // platform queries from.
    class Tree
    {
    public:
        void apply(const TreeUpdate& update);

        [[nodiscard]] const Node* find(NodeId id) const noexcept;
        [[nodiscard]] NodeId root() const noexcept { return rootId; }
        [[nodiscard]] NodeId focus() const noexcept { return focusId; }
        [[nodiscard]] std::size_t size() const noexcept { return nodes.size(); }
        // The node whose children include `id` (noNode for the root).
        [[nodiscard]] NodeId parent(NodeId id) const noexcept;

    private:
        std::unordered_map<NodeId, Node> nodes;
        std::unordered_map<NodeId, NodeId> parents;
        NodeId rootId = noNode;
        NodeId focusId = noNode;
    };

    // An action assistive technology asks of an element.
    struct ActionRequest
    {
        NodeId target = noNode;
        Action action = Action::Activate;
        // Custom actions: the name; standard ones may leave it empty.
        std::string name;
        std::variant<std::monostate, double, std::string> value;
    };

    // A platform's accessibility: it receives the tree's changes on the UI
    // thread, and hands the platform's requests back as ActionRequests on the
    // UI thread too (marshalled there first if the platform asks elsewhere).
    class Adapter
    {
    public:
        virtual ~Adapter() = default;
        virtual void update(const TreeUpdate& update) = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
