#pragma once

// Soundor's semantics in AccessKit's terms, and AccessKit's requests in
// Soundor's. The only place besides the adapters that sees accesskit.h;
// nothing of AccessKit leaves src/a11y/accesskit.

#include <soundor/a11y/Semantics.h>

#if defined(_WIN32)
    // accesskit.h includes windows.h.
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #ifndef WIN32_LEAN_AND_MEAN
        #define WIN32_LEAN_AND_MEAN
    #endif
#endif
#include <accesskit.h>

#include <cstdint>
#include <optional>
#include <string>
#include <variant>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    // How the tree is presented in the native view.
    struct Presentation
    {
        std::string name; // the root's label: the plugin's name
        // Logical pixels to the view's units: x' = x * scale + dx.
        double scale = 1;
        double dx = 0;
        double dy = 0;
    };

    [[nodiscard]] accesskit_role toAccessKit(Role role) noexcept;
    // The AccessKit action a standard Soundor one is, if any (Escape and
    // LongPress have none: LongPress is offered as a custom action).
    [[nodiscard]] std::optional<accesskit_action> toAccessKit(Action action) noexcept;

    // A node in AccessKit's terms; the caller owns it.
    [[nodiscard]] accesskit_node* toAccessKit(const Node& node, const Presentation& presentation, bool root);

    // An AccessKit update for `changes`, which `tree` already includes; the
    // caller owns it. `withRoot`: the root goes along even if unchanged (its
    // presentation changed).
    [[nodiscard]] accesskit_tree_update* toAccessKit(const TreeUpdate& changes, const Tree& tree,
                                                     const Presentation& presentation, bool withRoot);

    // An AccessKit request as plain data: what the platform's thread hands to
    // the UI thread.
    struct PlatformRequest
    {
        accesskit_action action = ACCESSKIT_ACTION_CLICK;
        NodeId target = noNode;
        // A custom action's id, a text value or a numeric one.
        std::variant<std::monostate, std::int32_t, std::string, double> data;
    };

    [[nodiscard]] PlatformRequest copyRequest(const accesskit_action_request& request);

    // The Soundor request `request` is, against the tree the platform was
    // shown; nothing when Soundor has no such action.
    [[nodiscard]] std::optional<ActionRequest> toSoundor(const PlatformRequest& request, const Tree& tree);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
