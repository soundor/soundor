#include <soundor/a11y/Semantics.h>

#include <algorithm>
#include <array>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
{
    namespace
    {
        // By Role, up to Dialog: the names plugin code uses.
        constexpr std::array<std::string_view, 28> roleNames {
            "none",   "text",         "image",       "button",     "link",        "adjustable", "checkbox",
            "switch", "togglebutton", "radio",       "radiogroup", "progressbar", "search",     "combobox",
            "menu",   "menubar",      "menuitem",    "scrollbar",  "spinbutton",  "tab",        "tablist",
            "header", "summary",      "keyboardkey", "timer",      "toolbar",     "alert",      "dialog",
        };
        static_assert(roleNames.size() == static_cast<std::size_t>(Role::Dialog) + 1);

        // By Action, up to SetValue.
        constexpr std::array<std::string_view, 10> actionNames {
            "activate", "increment", "decrement", "longpress", "expand",
            "collapse", "escape",    "focus",     "blur",      "setValue",
        };
        static_assert(actionNames.size() == static_cast<std::size_t>(Action::Custom));
    } // namespace

    std::string_view roleName(Role role) noexcept
    {
        const auto index = static_cast<std::size_t>(role);
        return index < roleNames.size() ? roleNames[index] : std::string_view {};
    }

    std::optional<Role> roleFromName(std::string_view name) noexcept
    {
        const auto found = std::ranges::find(roleNames, name);
        if (found == roleNames.end())
            return std::nullopt;
        return static_cast<Role>(found - roleNames.begin());
    }

    bool isLeafRole(Role role) noexcept
    {
        switch (role)
        {
            case Role::Text:
            case Role::Image:
            case Role::Button:
            case Role::Link:
            case Role::Adjustable:
            case Role::CheckBox:
            case Role::Switch:
            case Role::ToggleButton:
            case Role::Radio:
            case Role::ProgressBar:
            case Role::ComboBox:
            case Role::MenuItem:
            case Role::ScrollBar:
            case Role::SpinButton:
            case Role::Tab:
            case Role::Header:
            case Role::KeyboardKey:
            case Role::Timer:
            case Role::TextInput:
                return true;
            case Role::None:
            case Role::RadioGroup:
            case Role::Search:
            case Role::Menu:
            case Role::MenuBar:
            case Role::TabList:
            case Role::Summary:
            case Role::Toolbar:
            case Role::Alert:
            case Role::Dialog:
            case Role::Group:
            case Role::ScrollView:
            case Role::View:
                return false;
        }
        return false;
    }

    std::string_view actionName(Action action) noexcept
    {
        const auto index = static_cast<std::size_t>(action);
        return index < actionNames.size() ? actionNames[index] : std::string_view {};
    }

    Action actionFromName(std::string_view name) noexcept
    {
        const auto found = std::ranges::find(actionNames, name);
        return found == actionNames.end() ? Action::Custom : static_cast<Action>(found - actionNames.begin());
    }

    bool Node::supports(Action action) const noexcept
    {
        return action != Action::Custom
               && std::ranges::any_of(actions,
                                      [&](const ActionDescriptor& offered) { return offered.action == action; });
    }

    bool Node::supports(std::string_view name) const noexcept
    {
        return std::ranges::any_of(actions, [&](const ActionDescriptor& offered) { return offered.name == name; });
    }

    // ── Tree ─────────────────────────────────────────────────────────────────

    void Tree::apply(const TreeUpdate& update)
    {
        if (update.full)
        {
            nodes.clear();
            parents.clear();
        }
        for (const NodeId id : update.removed)
        {
            nodes.erase(id);
            parents.erase(id);
        }
        for (const Node& node : update.nodes)
        {
            // A node's old children may have moved elsewhere or gone: forget
            // them as its children before recording the new ones.
            if (const auto old = nodes.find(node.id); old != nodes.end())
                for (const NodeId child : old->second.children)
                    if (const auto parent = parents.find(child); parent != parents.end() && parent->second == node.id)
                        parents.erase(parent);
            for (const NodeId child : node.children)
                parents[child] = node.id;
            nodes.insert_or_assign(node.id, node);
        }
        if (update.root != noNode)
            rootId = update.root;
        focusId = update.focus;
    }

    const Node* Tree::find(NodeId id) const noexcept
    {
        const auto found = nodes.find(id);
        return found == nodes.end() ? nullptr : &found->second;
    }

    NodeId Tree::parent(NodeId id) const noexcept
    {
        const auto found = parents.find(id);
        return found == parents.end() ? noNode : found->second;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
