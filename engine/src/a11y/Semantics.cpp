#include <soundor/a11y/Semantics.h>

#include <algorithm>
#include <array>
#include <string>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
{
    namespace
    {
        // By Role, up to Option: the names plugin code uses.
        constexpr std::array<std::string_view, 30> roleNames {
            "none",       "text",     "image",        "button",  "link",       "adjustable",
            "checkbox",   "switch",   "togglebutton", "radio",   "radiogroup", "progressbar",
            "search",     "combobox", "menu",         "menubar", "menuitem",   "scrollbar",
            "spinbutton", "tab",      "tablist",      "header",  "summary",    "keyboardkey",
            "timer",      "toolbar",  "alert",        "dialog",  "listbox",    "option",
        };
        static_assert(roleNames.size() == static_cast<std::size_t>(Role::Option) + 1);

        // By Action, up to SetValue.
        constexpr std::array<std::string_view, 10> actionNames {
            "activate", "increment", "decrement", "longpress", "expand",
            "collapse", "escape",    "focus",     "blur",      "setValue",
        };
        static_assert(actionNames.size() == static_cast<std::size_t>(Action::Custom));
    } // namespace

    std::string appleKeyShortcuts(std::string_view keyShortcuts)
    {
        // Modifiers in the order macOS writes them, and the keys it draws.
        static constexpr std::array<std::pair<std::string_view, std::string_view>, 4> modifiers { {
            { "Control", "\xE2\x8C\x83" },
            { "Alt", "\xE2\x8C\xA5" },
            { "Shift", "\xE2\x87\xA7" },
            { "Meta", "\xE2\x8C\x98" },
        } };
        static constexpr std::array<std::pair<std::string_view, std::string_view>, 10> keys { {
            { "ArrowUp", "\xE2\x86\x91" },
            { "ArrowDown", "\xE2\x86\x93" },
            { "ArrowLeft", "\xE2\x86\x90" },
            { "ArrowRight", "\xE2\x86\x92" },
            { "Enter", "\xE2\x86\xA9" },
            { "Escape", "\xE2\x8E\x8B" },
            { "Tab", "\xE2\x87\xA5" },
            { "Backspace", "\xE2\x8C\xAB" },
            { "Delete", "\xE2\x8C\xA6" },
            { "Plus", "+" },
        } };
        std::string out;
        std::size_t at = 0;
        while (at < keyShortcuts.size())
        {
            const std::size_t start = keyShortcuts.find_first_not_of(" \t\n", at);
            if (start == std::string_view::npos)
                break;
            const std::size_t end = std::min(keyShortcuts.find_first_of(" \t\n", start), keyShortcuts.size());
            const std::string_view shortcut = keyShortcuts.substr(start, end - start);
            at = end;
            // Its parts; a "+" where a part should be is the key "+"
            // ("Control++").
            std::vector<std::string_view> parts;
            std::size_t from = 0;
            for (std::size_t i = 0; i < shortcut.size(); ++i)
            {
                if (shortcut[i] != '+')
                    continue;
                parts.push_back(i > from ? shortcut.substr(from, i - from) : shortcut.substr(i, 1));
                from = i + 1;
            }
            if (from < shortcut.size())
                parts.push_back(shortcut.substr(from));
            std::string held;
            std::string pressed;
            for (const auto& [name, symbol] : modifiers)
                if (std::ranges::find(parts, name) != parts.end())
                    held += symbol;
            for (const std::string_view part : parts)
            {
                if (std::ranges::any_of(modifiers, [&](const auto& modifier) { return modifier.first == part; }))
                    continue;
                const auto named = std::ranges::find_if(keys, [&](const auto& key) { return key.first == part; });
                if (named != keys.end())
                    pressed += named->second;
                else if (part.size() == 1 && part.front() >= 'a' && part.front() <= 'z')
                    pressed += static_cast<char>(part.front() - 'a' + 'A');
                else
                    pressed += part;
            }
            if (held.empty() && pressed.empty())
                continue;
            if (! out.empty())
                out += ", ";
            out += held;
            out += pressed;
        }
        return out;
    }

    std::string hintWithKeyShortcuts(const std::string& hint, std::string_view keyShortcuts)
    {
        std::string shortcuts = appleKeyShortcuts(keyShortcuts);
        if (shortcuts.empty())
            return hint;
        if (hint.empty())
            return shortcuts;
        return hint + " (" + shortcuts + ")";
    }

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
            case Role::Option:
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
            case Role::ListBox:
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
