#pragma once

#include <soundor/Config.h>
#include <soundor/ui/Input.h>
#include <soundor/ui/Style.h>

#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <vector>

struct YGNode; // Yoga stays private to the runtime.
struct YGConfig;

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    using NodeId = std::uint32_t;
    inline constexpr NodeId noNode = 0;

    enum class NodeType : std::uint8_t
    {
        View,
        Text,
    };

    struct Size
    {
        float width = 0;
        float height = 0;
    };

    struct Rect
    {
        float x = 0;
        float y = 0;
        float width = 0;
        float height = 0;

        [[nodiscard]] bool contains(Point point) const noexcept
        {
            return point.x >= x && point.y >= y && point.x < x + width && point.y < y + height;
        }
    };

    // Measures text for layout. The renderer provides the real one; the
    // default approximates from the font size so layout works without fonts.
    class TextMeasurer
    {
    public:
        virtual ~TextMeasurer() = default;
        // The size of `text` set in `style`, wrapped at `maxWidth` (infinite:
        // never wrap).
        virtual Size measure(std::string_view text, const TextStyle& style, float maxWidth) = 0;
    };

    [[nodiscard]] std::shared_ptr<TextMeasurer> approximateTextMeasurer();

    class Surface;

    // A node of a Surface's tree. Read-only outside the Surface.
    class Node
    {
    public:
        Node(const Node&) = delete;
        Node& operator=(const Node&) = delete;
        ~Node();

        [[nodiscard]] NodeId id() const noexcept { return nodeId; }
        [[nodiscard]] NodeType type() const noexcept { return nodeType; }
        [[nodiscard]] Node* parent() const noexcept { return parentNode; }
        [[nodiscard]] std::span<Node* const> children() const noexcept { return childNodes; }
        [[nodiscard]] const Style& style() const noexcept { return nodeStyle; }
        [[nodiscard]] const std::string& text() const noexcept { return textContent; }
        [[nodiscard]] bool focusable() const noexcept { return canFocus; }
        // The layout box relative to the parent's, once laid out.
        [[nodiscard]] Rect frame() const noexcept;

    private:
        friend class Surface;
        friend struct NodeAccess;
        Node(Surface& owner, NodeId id, NodeType type);

        Surface& surface;
        NodeId nodeId;
        NodeType nodeType;
        YGNode* yoga;
        Node* parentNode = nullptr;
        std::vector<Node*> childNodes;
        Style nodeStyle;
        std::string textContent;
        bool canFocus = false;
    };

    // An event the Surface routes to a node, for the UI (soundor:ui) to
    // dispatch. Pointer positions are relative to the view; `offset` to the
    // target.
    struct Event
    {
        enum class Type : std::uint8_t
        {
            PointerDown,
            PointerMove,
            PointerUp,
            PointerCancel,
            PointerEnter, // does not bubble
            PointerLeave, // does not bubble
            Click,
            Wheel,
            KeyDown,
            KeyUp,
            BeforeInput,
            Focus, // does not bubble
            Blur,  // does not bubble
        };

        Type type = Type::PointerMove;
        NodeId target = noNode;
        // Focus/blur: the node losing/gaining focus. Enter/leave: the node the
        // pointer came from/went to.
        NodeId related = noNode;

        Point position;
        Point offset;
        int pointerId = 0;
        PointerType pointerType = PointerType::Mouse;
        int button = -1;
        unsigned buttons = 0;
        float pressure = 0;

        float deltaX = 0;
        float deltaY = 0;
        WheelInput::Unit deltaUnit = WheelInput::Unit::Pixel;

        std::string key;
        bool repeat = false;
        std::string text;

        Modifiers modifiers = 0;
    };

    // Delivers an event; returns true when a listener called preventDefault().
    using EventSink = std::function<bool(const Event&)>;

    // The UI of one plugin view: a tree of nodes with flexbox layout, and the
    // routing of the view's input to them (hit testing, pointer capture,
    // hover, clicks, focus and keyboard).
    //
    // The UI (soundor:ui) edits the tree; the backend sizes the surface and
    // feeds it input; the renderer reads the laid-out tree. Everything happens
    // on the UI thread.
    class Surface
    {
    public:
        struct Options
        {
            std::shared_ptr<TextMeasurer> textMeasurer;
        };

        explicit Surface(Options provided = {});
        ~Surface();

        Surface(const Surface&) = delete;
        Surface& operator=(const Surface&) = delete;

        // ── The tree ─────────────────────────────────────────────────────────

        // Throws std::invalid_argument for misuse (unknown ids, cycles,
        // children of text nodes); the tree is unchanged then.
        NodeId createNode(NodeType type);
        // Destroys a node: detaches it from its parent and its children from it.
        void releaseNode(NodeId id);
        // Inserts `child` before `before` (noNode: at the end), moving it from
        // wherever it was.
        void insertChild(NodeId parent, NodeId child, NodeId before = noNode);
        void removeChild(NodeId parent, NodeId child);
        void setStyle(NodeId id, const Style& style);
        void setText(NodeId id, std::string text);
        void setFocusable(NodeId id, bool focusable);

        [[nodiscard]] Node& root() noexcept { return *rootNode; }
        [[nodiscard]] Node* find(NodeId id) noexcept;
        // Whether `id` is in the tree (the root or a descendant of it).
        [[nodiscard]] bool isConnected(NodeId id) noexcept;

        // ── Layout ───────────────────────────────────────────────────────────

        // The view's size in logical pixels; the root fills it.
        void setSize(Size size);
        [[nodiscard]] Size size() const noexcept { return viewSize; }
        // Device pixels per logical pixel; layout snaps to device pixels.
        void setScale(float scale);
        [[nodiscard]] float scale() const noexcept { return pixelScale; }

        // Brings the layout up to date (cheap when nothing changed).
        void layout();
        // A connected node's box relative to the view, laid out.
        [[nodiscard]] Rect bounds(NodeId id);
        // The topmost node at `point` that takes pointer events, or noNode.
        [[nodiscard]] NodeId hitTest(Point point);

        // Changes since the last call: the tree, a style, a size.
        [[nodiscard]] bool takeChanges() noexcept;

        // ── Input ────────────────────────────────────────────────────────────

        void setEventSink(EventSink sink);

        // Each returns whether the UI handled the input, so a backend can pass
        // unhandled keys on to the host.
        bool pointer(const PointerInput& input);
        bool wheel(const WheelInput& input);
        bool key(const KeyInput& input);
        bool text(const TextInput& input);

        // Moves focus to `id` (focusable and connected) or nowhere (noNode),
        // dispatching blur and focus.
        void focus(NodeId id);
        [[nodiscard]] NodeId focused() noexcept;

    private:
        friend class Node;
        friend struct NodeAccess;

        struct PointerState
        {
            NodeId captured = noNode;    // the pointerdown target, while pressed
            std::vector<NodeId> hovered; // root ... deepest hovered node
        };

        [[nodiscard]] Node& get(NodeId id);
        void detach(Node& child);
        [[nodiscard]] NodeId hitTest(Node& node, Point point, Point origin);
        [[nodiscard]] std::vector<NodeId> pathTo(NodeId id);
        void updateHover(PointerState& state, const PointerInput& input, NodeId target);
        void collectFocusable(Node& node, std::vector<NodeId>& out);
        bool moveFocus(bool backwards);
        bool dispatch(const Event& event);
        Event pointerEvent(Event::Type type, NodeId target, const PointerInput& input);

        Options options;
        std::unique_ptr<YGConfig, void (*)(YGConfig*)> config;
        std::unordered_map<NodeId, std::unique_ptr<Node>> nodes;
        Node* rootNode = nullptr;
        NodeId nextId = 1;
        Size viewSize;
        float pixelScale = 1;
        bool changed = true;
        EventSink sink;
        std::map<int, PointerState> pointers;
        NodeId focusedNode = noNode;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
