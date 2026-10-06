#include <soundor/a11y/SurfaceSemantics.h>

#include <algorithm>
#include <atomic>
#include <string>
#include <string_view>
#include <unordered_set>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
{
    namespace
    {
        // Ids are unique in the process, across surfaces and reloads: a request
        // for a node of a tree that has gone can never reach another's.
        NodeId newNodeId() noexcept
        {
            static std::atomic<NodeId> last { noNode };
            return ++last;
        }

        bool displayed(const ui::Node& node) noexcept
        {
            return node.style().display != ui::Display::None;
        }

        // Adds a piece of text to a label, a space between pieces.
        void appendText(std::string& label, std::string_view text)
        {
            constexpr std::string_view space = " \t\r\n";
            const auto first = text.find_first_not_of(space);
            if (first == std::string_view::npos)
                return;
            text = text.substr(first, text.find_last_not_of(space) - first + 1);
            if (! label.empty())
                label += ' ';
            label += text;
        }

        Role roleByType(ui::NodeType type) noexcept
        {
            switch (type)
            {
                case ui::NodeType::Text:
                    return Role::Text;
                case ui::NodeType::Image:
                    return Role::Image;
                case ui::NodeType::Input:
                    return Role::TextInput;
                case ui::NodeType::Scroll:
                    return Role::ScrollView;
                case ui::NodeType::View:
                    return Role::Group;
            }
            return Role::Group;
        }

        // Whether a node is an element of the semantic tree, or passes its
        // children's elements up.
        bool isElement(const ui::Node& node)
        {
            const Properties& properties = node.accessibility();
            if (properties.accessible.has_value())
                return *properties.accessible;
            if (properties.modal)
                return true;
            if (properties.role.has_value())
                return *properties.role != Role::None;
            if (! properties.label.empty())
                return true;
            switch (node.type())
            {
                case ui::NodeType::Text:
                    return ! node.text().empty();
                case ui::NodeType::Input:
                    return true;
                case ui::NodeType::View:
                case ui::NodeType::Image: // decorative unless said otherwise
                case ui::NodeType::Scroll:
                    return false;
            }
            return false;
        }

        void offer(Node& element, Action action)
        {
            if (! element.supports(action))
                element.actions.push_back({ action, std::string(actionName(action)), {} });
        }
    } // namespace

    // One pass over the surface: the elements it has now.
    struct SurfaceSemantics::Build
    {
        SurfaceSemantics& owner;
        ui::Surface& surface;
        // Nodes read at their accessibility parent, by that parent.
        std::unordered_map<ui::NodeId, std::vector<ui::Node*>> owned;
        std::unordered_set<ui::NodeId> relocated;
        std::unordered_map<NodeId, Node> nodes;
        std::unordered_map<ui::NodeId, NodeId> elements;
        // Every element in reading order (an element before its children).
        std::vector<NodeId> order;

        // The node `node` is read under: its accessibility parent, or parent.
        const ui::Node* readParent(const ui::Node& node)
        {
            if (node.accessibilityParent() != ui::noNode)
                if (const ui::Node* parent = surface.find(node.accessibilityParent()))
                    return parent;
            return node.parent();
        }

        // An accessibility parent counts when it is in the view and does not
        // lead back to the node (it would never be read).
        bool readsElsewhere(const ui::Node& node)
        {
            const ui::Node* parent = surface.find(node.accessibilityParent());
            if (parent == nullptr || ! surface.isConnected(parent->id()))
                return false;
            std::unordered_set<const ui::Node*> seen { &node };
            for (const ui::Node* at = parent; at != nullptr; at = readParent(*at))
                if (! seen.insert(at).second)
                    return false;
            return true;
        }

        void indexOwnership(ui::Node& node)
        {
            if (node.accessibilityParent() != ui::noNode && readsElsewhere(node))
            {
                owned[node.accessibilityParent()].push_back(&node);
                relocated.insert(node.id());
            }
            for (ui::Node* child : node.children())
                indexOwnership(*child);
        }

        // The children `node` is read with: its own, less those read
        // elsewhere, then those read here.
        template <typename Visit>
        void forEachChild(const ui::Node& node, Visit&& visit)
        {
            for (ui::Node* child : node.children())
                if (! relocated.contains(child->id()))
                    visit(*child);
            if (const auto found = owned.find(node.id()); found != owned.end())
                for (ui::Node* child : found->second)
                    visit(*child);
        }

        // The text an element read as a whole is labelled with: its
        // descendants' labels, or their text.
        void collectText(const ui::Node& node, std::string& label)
        {
            forEachChild(node,
                         [&](ui::Node& child)
                         {
                             if (! displayed(child))
                                 return;
                             if (! child.accessibility().label.empty())
                             {
                                 appendText(label, child.accessibility().label);
                                 return;
                             }
                             if (child.type() == ui::NodeType::Text)
                                 appendText(label, child.text());
                             collectText(child, label);
                         });
        }

        void visit(ui::Node& node, std::vector<NodeId>& into)
        {
            if (! displayed(node))
                return;
            if (! isElement(node))
            {
                forEachChild(node, [&](ui::Node& child) { visit(child, into); });
                return;
            }
            const Properties& properties = node.accessibility();
            Node element;
            const auto known = owner.elements.find(node.id());
            element.id = known != owner.elements.end() ? known->second : newNodeId();
            element.role = properties.role.has_value() && *properties.role != Role::None ? *properties.role
                           : properties.modal                                            ? Role::Dialog
                                                                                         : roleByType(node.type());
            element.label = properties.label;
            element.hint = properties.hint;
            element.state = properties.state;
            element.value = properties.value;
            element.actions = properties.actions;
            element.modal = properties.modal;
            element.focusable = node.focusable();
            const ui::Rect box = surface.bounds(node.id());
            element.bounds = { box.x, box.y, box.width, box.height };
            if (node.type() == ui::NodeType::Text && element.label.empty())
                appendText(element.label, node.text());
            if (node.type() == ui::NodeType::Input)
            {
                // What the input holds, whatever plugin code said.
                element.value.text = node.text();
                element.placeholder = node.placeholder();
                offer(element, Action::SetValue);
            }
            if (element.focusable)
                offer(element, Action::Focus);

            order.push_back(element.id);
            const bool whole =
                isLeafRole(element.role) || (properties.accessible == true && element.role == Role::Group);
            if (whole)
            {
                if (element.label.empty())
                    collectText(node, element.label);
            }
            else
                forEachChild(node, [&](ui::Node& child) { visit(child, element.children); });

            into.push_back(element.id);
            elements.emplace(node.id(), element.id);
            nodes.emplace(element.id, std::move(element));
        }

        // Keeps `id` and everything under it.
        void keep(NodeId id, std::unordered_set<NodeId>& kept)
        {
            kept.insert(id);
            for (const NodeId child : nodes.at(id).children)
                keep(child, kept);
        }

        void run()
        {
            surface.layout();
            indexOwnership(surface.root());
            indexOwnership(surface.overlay());

            Node root;
            root.id = owner.rootId;
            root.role = Role::View;
            root.bounds = { 0, 0, surface.size().width, surface.size().height };
            visit(surface.root(), root.children);
            visit(surface.overlay(), root.children);

            // Only the last modal element shown is read, with what it holds.
            const auto modal =
                std::find_if(order.rbegin(), order.rend(), [&](NodeId id) { return nodes.at(id).modal; });
            if (modal != order.rend())
            {
                std::unordered_set<NodeId> kept;
                keep(*modal, kept);
                root.children = { *modal };
                std::erase_if(nodes, [&](const auto& entry) { return ! kept.contains(entry.first); });
                std::erase_if(elements, [&](const auto& entry) { return ! kept.contains(entry.second); });
                std::erase_if(order, [&](NodeId id) { return ! kept.contains(id); });
            }
            nodes.emplace(root.id, std::move(root));
        }

        // The element holding keyboard focus: the focused node's, or that of
        // the nearest node it is read under.
        NodeId focus()
        {
            const ui::NodeId focused = surface.focused();
            if (focused == ui::noNode)
                return noNode;
            std::unordered_set<const ui::Node*> seen;
            for (const ui::Node* at = surface.find(focused); at != nullptr && seen.insert(at).second;
                 at = readParent(*at))
                if (const auto found = elements.find(at->id()); found != elements.end())
                    return found->second;
            return owner.rootId;
        }
    };

    SurfaceSemantics::SurfaceSemantics(ui::Surface& target) : surface(target), rootId(newNodeId()) {}

    TreeUpdate SurfaceSemantics::update(bool full)
    {
        const ui::NodeId focused = surface.focused();
        if (built && ! full && surface.revision() == builtRevision && focused == builtFocus)
            return {};

        Build build { *this, surface, {}, {}, {}, {}, {} };
        build.run();

        TreeUpdate changes;
        changes.root = rootId;
        changes.full = full || ! built;
        changes.focus = build.focus();
        // In reading order, the root first.
        const auto add = [&](NodeId id)
        {
            const Node& node = build.nodes.at(id);
            const Node* before = current.find(id);
            if (changes.full || before == nullptr || *before != node)
                changes.nodes.push_back(node);
        };
        add(rootId);
        for (const NodeId id : build.order)
            add(id);
        for (const auto& [id, source] : sources)
            if (! build.nodes.contains(id))
                changes.removed.push_back(id);
        std::ranges::sort(changes.removed);

        current.apply(changes);
        elements = std::move(build.elements);
        sources.clear();
        for (const auto& [source, id] : elements)
            sources.emplace(id, source);
        builtRevision = surface.revision();
        builtFocus = focused;
        built = true;
        return changes;
    }

    NodeId SurfaceSemantics::elementOf(ui::NodeId node) const noexcept
    {
        const auto found = elements.find(node);
        return found == elements.end() ? noNode : found->second;
    }

    bool SurfaceSemantics::perform(const ActionRequest& request)
    {
        const auto source = sources.find(request.target);
        const Node* element = current.find(request.target);
        if (source == sources.end() || element == nullptr || ! surface.isConnected(source->second))
            return false;
        const bool custom = request.action == Action::Custom;
        std::string name = custom ? request.name : std::string(actionName(request.action));
        if (name.empty() || (custom && actionFromName(name) != Action::Custom))
            return false;
        if (custom ? ! element->supports(std::string_view(name)) : ! element->supports(request.action))
            return false;
        if (element->state.disabled && request.action != Action::Focus && request.action != Action::Blur)
            return false;
        return surface.accessibilityAction(source->second, std::move(name), request.value);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
