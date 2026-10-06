#pragma once

#include <soundor/Config.h>
#include <soundor/a11y/Semantics.h>
#include <soundor/ui/Surface.h>

#include <cstdint>
#include <unordered_map>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
{
    // The semantic tree of a ui::Surface: which of its nodes are elements, as
    // what, in which order, and the routing of assistive technology's
    // requests back to them.
    //
    // The semantic tree is not the node tree. A node is an element only when
    // it means something (a text, a button, anything plugin code made
    // accessible); the others pass their elements up. An element read as a
    // whole (a button) takes its descendants' text as its label instead of
    // exposing them. A node with an accessibility parent (a portal's content)
    // is read there rather than where it is drawn. While a modal element is
    // shown, the tree holds only the last one.
    //
    // Everything happens on the UI thread. update() is cheap while the
    // surface has not changed; nothing is computed until it is called, so a
    // view no assistive technology reads costs nothing.
    class SurfaceSemantics
    {
    public:
        explicit SurfaceSemantics(ui::Surface& target);

        SurfaceSemantics(const SurfaceSemantics&) = delete;
        SurfaceSemantics& operator=(const SurfaceSemantics&) = delete;

        // Brings the tree up to date with the surface and returns what changed
        // since the last call. `full`: every node (an adapter that just
        // attached, or that lost its tree).
        [[nodiscard]] TreeUpdate update(bool full = false);

        // The tree as of the last update().
        [[nodiscard]] const Tree& tree() const noexcept { return current; }

        // The element a node is, as of the last update(); noNode when none.
        [[nodiscard]] NodeId elementOf(ui::NodeId node) const noexcept;

        // Delivers `request` to the element's node (an `accessibilityaction`
        // event). False, doing nothing, when the element is gone, its node is
        // no longer in the view, it does not offer the action or it is
        // disabled; otherwise whether plugin code or the runtime acted on it.
        bool perform(const ActionRequest& request);

    private:
        struct Build;

        ui::Surface& surface;
        Tree current;
        NodeId rootId;
        // The element each node is, and the reverse.
        std::unordered_map<ui::NodeId, NodeId> elements;
        std::unordered_map<NodeId, ui::NodeId> sources;
        std::uint64_t builtRevision = 0;
        ui::NodeId builtFocus = ui::noNode;
        bool built = false;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
