#include "a11y/accesskit/Mapping.h"

#include <cstddef>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    namespace
    {
        // A custom action's id: its place among the node's actions.
        bool isCustom(const ActionDescriptor& action) noexcept
        {
            return action.action == Action::Custom || action.action == Action::LongPress;
        }

        std::string describe(const ActionDescriptor& action)
        {
            if (! action.label.empty())
                return action.label;
            return action.action == Action::LongPress ? "Long press" : action.name;
        }

        accesskit_rect rectOf(const Rect& rect) noexcept
        {
            return { rect.x, rect.y, static_cast<double>(rect.x) + rect.width,
                     static_cast<double>(rect.y) + rect.height };
        }
    } // namespace

    accesskit_role toAccessKit(Role role) noexcept
    {
        switch (role)
        {
            case Role::None:
                return ACCESSKIT_ROLE_GENERIC_CONTAINER;
            case Role::Text:
                return ACCESSKIT_ROLE_LABEL;
            case Role::Image:
                return ACCESSKIT_ROLE_IMAGE;
            case Role::Button:
            case Role::ToggleButton: // a button with a toggled state
            case Role::KeyboardKey:
                return ACCESSKIT_ROLE_BUTTON;
            case Role::Link:
                return ACCESSKIT_ROLE_LINK;
            case Role::Adjustable:
                return ACCESSKIT_ROLE_SLIDER;
            case Role::CheckBox:
                return ACCESSKIT_ROLE_CHECK_BOX;
            case Role::Switch:
                return ACCESSKIT_ROLE_SWITCH;
            case Role::Radio:
                return ACCESSKIT_ROLE_RADIO_BUTTON;
            case Role::RadioGroup:
                return ACCESSKIT_ROLE_RADIO_GROUP;
            case Role::ProgressBar:
                return ACCESSKIT_ROLE_PROGRESS_INDICATOR;
            case Role::Search:
                return ACCESSKIT_ROLE_SEARCH;
            case Role::ComboBox:
                return ACCESSKIT_ROLE_COMBO_BOX;
            case Role::Menu:
                return ACCESSKIT_ROLE_MENU;
            case Role::MenuBar:
                return ACCESSKIT_ROLE_MENU_BAR;
            case Role::MenuItem:
                return ACCESSKIT_ROLE_MENU_ITEM;
            case Role::ScrollBar:
                return ACCESSKIT_ROLE_SCROLL_BAR;
            case Role::SpinButton:
                return ACCESSKIT_ROLE_SPIN_BUTTON;
            case Role::Tab:
                return ACCESSKIT_ROLE_TAB;
            case Role::TabList:
                return ACCESSKIT_ROLE_TAB_LIST;
            case Role::Header:
                return ACCESSKIT_ROLE_HEADING;
            case Role::Summary:
            case Role::Group:
                return ACCESSKIT_ROLE_GROUP;
            case Role::Timer:
                return ACCESSKIT_ROLE_TIMER;
            case Role::Toolbar:
                return ACCESSKIT_ROLE_TOOLBAR;
            case Role::Alert:
                return ACCESSKIT_ROLE_ALERT;
            case Role::Dialog:
                return ACCESSKIT_ROLE_DIALOG;
            case Role::TextInput:
                return ACCESSKIT_ROLE_TEXT_INPUT;
            case Role::ScrollView:
                return ACCESSKIT_ROLE_SCROLL_VIEW;
            case Role::View:
                return ACCESSKIT_ROLE_PANE;
        }
        return ACCESSKIT_ROLE_GENERIC_CONTAINER;
    }

    std::optional<accesskit_action> toAccessKit(Action action) noexcept
    {
        switch (action)
        {
            case Action::Activate:
                return ACCESSKIT_ACTION_CLICK;
            case Action::Increment:
                return ACCESSKIT_ACTION_INCREMENT;
            case Action::Decrement:
                return ACCESSKIT_ACTION_DECREMENT;
            case Action::Expand:
                return ACCESSKIT_ACTION_EXPAND;
            case Action::Collapse:
                return ACCESSKIT_ACTION_COLLAPSE;
            case Action::Focus:
                return ACCESSKIT_ACTION_FOCUS;
            case Action::Blur:
                return ACCESSKIT_ACTION_BLUR;
            case Action::SetValue:
                return ACCESSKIT_ACTION_SET_VALUE;
            case Action::LongPress:
            case Action::Escape:
            case Action::Custom:
                return std::nullopt;
        }
        return std::nullopt;
    }

    accesskit_node* toAccessKit(const Node& node, const Presentation& presentation, bool root)
    {
        accesskit_node* out = accesskit_node_new(toAccessKit(node.role));

        // Static text is read as its value; everything else by its label.
        if (node.role == Role::Text)
            accesskit_node_set_value(out, node.label.c_str());
        else if (! node.label.empty())
            accesskit_node_set_label(out, node.label.c_str());
        else if (root && ! presentation.name.empty())
            accesskit_node_set_label(out, presentation.name.c_str());
        if (! node.hint.empty())
            accesskit_node_set_description(out, node.hint.c_str());
        if (! node.placeholder.empty())
            accesskit_node_set_placeholder(out, node.placeholder.c_str());
        if (node.role != Role::Text && (! node.value.text.empty() || node.role == Role::TextInput))
            accesskit_node_set_value(out, node.value.text.c_str());
        if (node.value.now)
            accesskit_node_set_numeric_value(out, *node.value.now);
        if (node.value.min)
            accesskit_node_set_min_numeric_value(out, *node.value.min);
        if (node.value.max)
            accesskit_node_set_max_numeric_value(out, *node.value.max);

        const State& state = node.state;
        if (state.disabled)
            accesskit_node_set_disabled(out);
        if (state.busy)
            accesskit_node_set_busy(out);
        if (state.selected)
            accesskit_node_set_selected(out, *state.selected);
        if (state.expanded)
            accesskit_node_set_expanded(out, *state.expanded);
        switch (state.checked)
        {
            case Checked::Unset:
                break;
            case Checked::False:
                accesskit_node_set_toggled(out, ACCESSKIT_TOGGLED_FALSE);
                break;
            case Checked::True:
                accesskit_node_set_toggled(out, ACCESSKIT_TOGGLED_TRUE);
                break;
            case Checked::Mixed:
                accesskit_node_set_toggled(out, ACCESSKIT_TOGGLED_MIXED);
                break;
        }
        if (node.modal)
            accesskit_node_set_modal(out);

        accesskit_node_set_bounds(out, rectOf(node.bounds));
        if (root)
            accesskit_node_set_transform(
                out, { { presentation.scale, 0, 0, presentation.scale, presentation.dx, presentation.dy } });
        if (! node.children.empty())
            accesskit_node_set_children(out, node.children.size(), node.children.data());

        std::vector<accesskit_custom_action*> custom;
        for (std::size_t i = 0; i < node.actions.size(); ++i)
        {
            const ActionDescriptor& action = node.actions[i];
            if (isCustom(action))
            {
                accesskit_custom_action* entry = accesskit_custom_action_new(static_cast<std::int32_t>(i));
                accesskit_custom_action_set_description(entry, describe(action).c_str());
                custom.push_back(entry);
            }
            else if (const auto mapped = toAccessKit(action.action))
                accesskit_node_add_action(out, *mapped);
        }
        if (! custom.empty())
        {
            accesskit_node_add_action(out, ACCESSKIT_ACTION_CUSTOM_ACTION);
            accesskit_node_set_custom_actions(out, custom.size(), custom.data());
            for (accesskit_custom_action* entry : custom)
                accesskit_custom_action_free(entry);
        }
        return out;
    }

    accesskit_tree_update* toAccessKit(const TreeUpdate& changes, const Tree& tree, const Presentation& presentation,
                                       bool withRoot)
    {
        const NodeId root = tree.root();
        const NodeId focus = changes.focus != noNode ? changes.focus : root;
        accesskit_tree_update* out = accesskit_tree_update_with_capacity_and_focus(changes.nodes.size() + 1, focus);
        bool rootSent = false;
        for (const Node& node : changes.nodes)
        {
            rootSent = rootSent || node.id == root;
            accesskit_tree_update_push_node(out, node.id, toAccessKit(node, presentation, node.id == root));
        }
        if (withRoot && ! rootSent)
            if (const Node* node = tree.find(root))
                accesskit_tree_update_push_node(out, root, toAccessKit(*node, presentation, true));
        if (changes.full)
        {
            accesskit_tree_info* info = accesskit_tree_info_new(root);
            accesskit_tree_info_set_toolkit_name(info, "Soundor");
            accesskit_tree_update_set_tree_info(out, info);
        }
        return out;
    }

    PlatformRequest copyRequest(const accesskit_action_request& request)
    {
        PlatformRequest out;
        out.action = request.action;
        out.target = request.target_node;
        if (request.data.has_value)
        {
            const accesskit_action_data& data = request.data.value;
            switch (data.tag)
            {
                case ACCESSKIT_ACTION_DATA_CUSTOM_ACTION:
                    out.data = data.custom_action;
                    break;
                case ACCESSKIT_ACTION_DATA_VALUE:
                    out.data = std::string(data.value != nullptr ? data.value : "");
                    break;
                case ACCESSKIT_ACTION_DATA_NUMERIC_VALUE:
                    out.data = data.numeric_value;
                    break;
                default:
                    break;
            }
        }
        return out;
    }

    std::optional<ActionRequest> toSoundor(const PlatformRequest& request, const Tree& tree)
    {
        ActionRequest out;
        out.target = request.target;
        switch (request.action)
        {
            case ACCESSKIT_ACTION_CLICK:
                out.action = Action::Activate;
                break;
            case ACCESSKIT_ACTION_INCREMENT:
                out.action = Action::Increment;
                break;
            case ACCESSKIT_ACTION_DECREMENT:
                out.action = Action::Decrement;
                break;
            case ACCESSKIT_ACTION_EXPAND:
                out.action = Action::Expand;
                break;
            case ACCESSKIT_ACTION_COLLAPSE:
                out.action = Action::Collapse;
                break;
            case ACCESSKIT_ACTION_FOCUS:
                out.action = Action::Focus;
                break;
            case ACCESSKIT_ACTION_BLUR:
                out.action = Action::Blur;
                break;
            case ACCESSKIT_ACTION_SET_VALUE:
                out.action = Action::SetValue;
                if (const auto* text = std::get_if<std::string>(&request.data))
                    out.value = *text;
                else if (const auto* number = std::get_if<double>(&request.data))
                    out.value = *number;
                else
                    return std::nullopt;
                break;
            case ACCESSKIT_ACTION_CUSTOM_ACTION:
            {
                // Its id is its place among the actions the platform was shown.
                const auto* id = std::get_if<std::int32_t>(&request.data);
                const Node* node = tree.find(request.target);
                if (id == nullptr || node == nullptr || *id < 0 || static_cast<std::size_t>(*id) >= node->actions.size()
                    || ! isCustom(node->actions[static_cast<std::size_t>(*id)]))
                    return std::nullopt;
                const ActionDescriptor& action = node->actions[static_cast<std::size_t>(*id)];
                out.action = action.action;
                if (action.action == Action::Custom)
                    out.name = action.name;
                break;
            }
            default:
                return std::nullopt;
        }
        return out;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
