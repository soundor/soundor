#include "a11y/linux/Mapping.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
{
    RoleInfo role(Role input)
    {
        switch (input)
        {
            case Role::None:
            case Role::Group:
                return { 99, "grouping" };
            case Role::Text:
                return { 116, "static" };
            case Role::Image:
                return { 27, "image" };
            case Role::Button:
            case Role::KeyboardKey:
                return { 43, "push button" };
            case Role::Link:
                return { 88, "link" };
            case Role::Adjustable:
                return { 51, "slider" };
            case Role::CheckBox:
                return { 7, "check box" };
            case Role::Switch:
            case Role::ToggleButton:
                return { 62, "toggle button" };
            case Role::Radio:
                return { 44, "radio button" };
            case Role::RadioGroup:
                return { 99, "grouping" };
            case Role::ProgressBar:
                return { 42, "progress bar" };
            case Role::Search:
                return { 79, "entry" };
            case Role::ComboBox:
                return { 11, "combo box" };
            case Role::Menu:
                return { 33, "menu" };
            case Role::MenuBar:
                return { 34, "menu bar" };
            case Role::MenuItem:
                return { 35, "menu item" };
            case Role::ScrollBar:
                return { 48, "scroll bar" };
            case Role::SpinButton:
                return { 52, "spin button" };
            case Role::Tab:
                return { 37, "page tab" };
            case Role::TabList:
                return { 38, "page tab list" };
            case Role::Header:
                return { 83, "heading" };
            case Role::Summary:
                return { 99, "grouping" };
            case Role::Timer:
                return { 115, "timer" };
            case Role::Toolbar:
                return { 63, "tool bar" };
            case Role::Alert:
                return { 2, "alert" };
            case Role::Dialog:
                return { 16, "dialog" };
            case Role::TextInput:
                return { 79, "entry" };
            case Role::ScrollView:
                return { 49, "scroll pane" };
            case Role::View:
                return { 23, "frame" };
        }
        return { 67, "unknown" };
    }
    std::array<std::uint32_t, 2> states(const Node& node, bool focused, bool active)
    {
        std::array<std::uint32_t, 2> result {};
        const auto set = [&](unsigned bit, bool on)
        {
            if (on)
                result[bit / 32] |= std::uint32_t { 1 } << (bit % 32);
        };
        set(1, active);
        set(3, node.state.busy);
        set(4, node.state.checked == Checked::True);
        set(5, node.state.expanded == false);
        set(7, node.role == Role::TextInput && ! node.state.readOnly && node.supports(Action::SetValue));
        set(8, ! node.state.disabled);
        set(9, node.state.expanded.has_value());
        set(10, node.state.expanded == true);
        set(11, node.focusable);
        set(12, focused);
        set(16, node.modal);
        set(20, (node.role == Role::ToggleButton || node.role == Role::Switch) && node.state.checked == Checked::True);
        set(22, node.state.selected.has_value());
        set(23, node.state.selected == true);
        set(24, ! node.state.disabled);
        set(25, true); // SurfaceSemantics already filters hidden elements.
        set(30, true);
        set(32, node.state.checked == Checked::Mixed);
        set(41, node.state.checked != Checked::Unset);
        set(43, node.state.readOnly); // ATSPI_STATE_READ_ONLY
        return result;
    }

    Rect bounds(const Node& node, const Tree& tree, const ViewGeometry& geometry, std::uint32_t coordinates)
    {
        Rect result { node.bounds.x * geometry.scale, node.bounds.y * geometry.scale,
                      node.bounds.width * geometry.scale, node.bounds.height * geometry.scale };
        if (coordinates == 0) // screen: screen is the surface's origin, not the peer's.
        {
            result.x += geometry.screen.x;
            result.y += geometry.screen.y;
        }
        else if (coordinates == 1) // native window
        {
            result.x += geometry.x;
            result.y += geometry.y;
        }
        else if (const Node* parent = tree.find(tree.parent(node.id))) // parent
        {
            result.x -= parent->bounds.x * geometry.scale;
            result.y -= parent->bounds.y * geometry.scale;
        }
        return result;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
