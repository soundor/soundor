#pragma once

#include <soundor/Config.h>
#include <soundor/a11y/Semantics.h>
#include <soundor/render/Frame.h>
#include <soundor/ui/Input.h>
#include <soundor/ui/Style.h>
#include <soundor/ui/Text.h>

#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <variant>
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
        Image,  // a bundled image, by asset id
        Scroll, // a view whose content scrolls
        Input,  // an editable line of text
        Canvas, // pixels drawn by code (a 2D context)
    };

    // A canvas node's pixels: its drawing buffer, `width`×`height` like an
    // HTML canvas's, shown stretched over the node's content box. Shared
    // with the context drawing into it.
    struct CanvasBuffer
    {
        // Premultiplied BGRA; transparent after every (re)size.
        render::RasterSurface pixels;
        // Counts resets (the size set, even to the same): a context resets
        // its state when it sees a new count.
        std::uint64_t resets = 0;
        // Something was drawn since the surface last looked.
        bool drawn = false;
        // Drawn on the GPU instead (WebGL): the image, and whether it changed
        // since the view last made a frame. A GPU compositor shows it as a
        // layer of its own; otherwise it is read back into `pixels`.
        std::shared_ptr<render::GpuImage> gpuImage;
        bool gpuDrawn = false;
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

    // Knows the images nodes show, for their intrinsic size.
    class ImageSource
    {
    public:
        virtual ~ImageSource() = default;
        // The size of the image `source` (an asset id) in logical pixels, if
        // it is one.
        virtual std::optional<Size> imageSize(std::string_view source) = 0;
    };

    // The system clipboard, for text inputs.
    class Clipboard
    {
    public:
        virtual ~Clipboard() = default;
        virtual std::string readText() = 0;
        virtual void writeText(std::string text) = 0;
    };

    // A clipboard private to the process, for backends without one.
    [[nodiscard]] std::shared_ptr<Clipboard> memoryClipboard();

    // The editing state of an input node: byte offsets into its text.
    struct Selection
    {
        std::size_t anchor = 0;
        std::size_t focus = 0;

        [[nodiscard]] std::size_t start() const noexcept { return anchor < focus ? anchor : focus; }
        [[nodiscard]] std::size_t end() const noexcept { return anchor < focus ? focus : anchor; }
        friend constexpr bool operator==(const Selection&, const Selection&) = default;
    };

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
        // The children bottom to top, as drawn: by zIndex, then tree order.
        // Hit testing goes through them top to bottom.
        [[nodiscard]] std::span<Node* const> stackedChildren() const noexcept
        {
            return stacked.empty() ? childNodes : stacked;
        }
        [[nodiscard]] const Style& style() const noexcept { return nodeStyle; }
        [[nodiscard]] const std::string& text() const noexcept { return textContent; }
        [[nodiscard]] bool focusable() const noexcept { return canFocus; }
        // The layout box relative to the parent's, once laid out.
        [[nodiscard]] Rect frame() const noexcept;
        // The box inside the border and padding, relative to frame().
        [[nodiscard]] Rect contentBox() const noexcept;

        // Image: its asset id.
        [[nodiscard]] const std::string& source() const noexcept { return imageSource; }
        // Canvas: its drawing buffer (null for other nodes).
        [[nodiscard]] const CanvasBuffer* canvas() const noexcept { return canvasBuffer.get(); }
        // Input: shown while the text is empty.
        [[nodiscard]] const std::string& placeholder() const noexcept { return placeholderText; }
        [[nodiscard]] const Selection& selection() const noexcept { return textSelection; }
        // Scroll: how far the content is scrolled; Input: how far its text is.
        [[nodiscard]] Point scrollOffset() const noexcept { return scroll; }
        // What plugin code says the node is to assistive technology.
        [[nodiscard]] const a11y::Properties& accessibility() const noexcept { return semantics; }
        // Where assistive technology reads the node, in place of its parent
        // (noNode: its parent).
        [[nodiscard]] NodeId accessibilityParent() const noexcept { return semanticParent; }

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
        // childNodes sorted by zIndex; empty while that is tree order.
        std::vector<Node*> stacked;
        Style nodeStyle;
        std::string textContent;
        std::string imageSource;
        std::string placeholderText;
        Selection textSelection;
        std::shared_ptr<CanvasBuffer> canvasBuffer;
        Point scroll;
        a11y::Properties semantics;
        NodeId semanticParent = noNode;
        bool canFocus = false;
        // The last layout of the text, by the width it was made for.
        float layoutWidth = -1;
        TextLayout textLayoutCache;
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
            Focus,  // does not bubble
            Blur,   // does not bubble
            Scroll, // does not bubble
            ContextMenu,
            AccessibilityAction,
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

        // Accessibility actions: the action's name, and its value if any.
        std::string action;
        std::variant<std::monostate, double, std::string> value;

        Modifiers modifiers = 0;
    };

    // Delivers an event; returns true when a listener called preventDefault().
    using EventSink = std::function<bool(const Event&)>;

    // What the surface did since it was created, for profiling: counting is
    // always on. Take differences for a frame or a phase.
    struct SurfaceStatistics
    {
        std::uint64_t styleChanges = 0;      // setStyle() calls
        std::uint64_t layoutPasses = 0;      // trees laid out by Yoga
        std::uint64_t layoutNanoseconds = 0; // ... and the time it took
        std::uint64_t invalidations = 0;     // nodes marked as looking different
    };

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
            // Default: approximateTextEngine(), memoryClipboard(), no images.
            std::shared_ptr<TextEngine> textEngine;
            std::shared_ptr<ImageSource> images;
            std::shared_ptr<Clipboard> clipboard;
        };

        explicit Surface(Options provided = {});
        ~Surface();

        Surface(const Surface&) = delete;
        Surface& operator=(const Surface&) = delete;

        // ── The tree ─────────────────────────────────────────────────────────

        // Throws std::invalid_argument for misuse (unknown ids, cycles,
        // children of nodes other than views); the tree is unchanged then.
        NodeId createNode(NodeType type);
        // Destroys a node: detaches it from its parent and its children from it.
        void releaseNode(NodeId id);
        // Inserts `child` before `before` (noNode: at the end), moving it from
        // wherever it was.
        void insertChild(NodeId parent, NodeId child, NodeId before = noNode);
        void removeChild(NodeId parent, NodeId child);
        void setStyle(NodeId id, const Style& style);
        // Text and input nodes.
        void setText(NodeId id, std::string text);
        void setFocusable(NodeId id, bool focusable);
        // Image nodes.
        void setSource(NodeId id, std::string source);
        // Input nodes.
        void setPlaceholder(NodeId id, std::string placeholder);
        // Clamped to the text and to code point boundaries.
        void setSelection(NodeId id, Selection selection);
        // What assistive technology is told about the node.
        void setAccessibility(NodeId id, a11y::Properties properties);
        // Reads `id` as a child of `parent` (noNode: of its own parent), as for
        // content a portal shows elsewhere than where it belongs.
        void setAccessibilityParent(NodeId id, NodeId parent);
        // Scroll nodes: clamped to the content.
        void scrollTo(NodeId id, Point offset);
        // Scroll nodes: the size of what they scroll.
        [[nodiscard]] Size contentSize(NodeId id);
        // Images became available or changed: lays image nodes out again.
        void imagesChanged();
        // Canvas nodes: sizes the drawing buffer, which clears it (also at the
        // same size, as on the Web). Its size in logical pixels is the node's
        // natural size. Throws std::invalid_argument past 16384 on a side or
        // 2^28 pixels.
        void setCanvasSize(NodeId id, int width, int height);
        // Canvas nodes: the buffer a context draws into.
        [[nodiscard]] std::shared_ptr<CanvasBuffer> canvasBuffer(NodeId id);

        // The content: what the view shows, laid out to fill it.
        [[nodiscard]] Node& root() noexcept { return *rootNode; }
        // The overlay layer: a second root filling the view, laid out apart
        // from the content, drawn over all of it and hit before it. It lets
        // pointer events through where none of its descendants takes them.
        [[nodiscard]] Node& overlay() noexcept { return *overlayNode; }
        [[nodiscard]] Node* find(NodeId id) noexcept;
        // The canvas nodes, in the order they were made.
        [[nodiscard]] std::span<const NodeId> canvases() const noexcept { return canvasNodes; }
        // Whether `id` is in one of the trees (a root or a descendant of one).
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

        // A text or input node's text laid out in its content box.
        [[nodiscard]] const TextLayout& textLayout(NodeId id);
        // The byte offset of a text or input node's text nearest `point`
        // (relative to the node's box).
        [[nodiscard]] std::size_t textOffsetAt(NodeId id, Point point);

        // Changes since the last call: the tree, a style, a size, a scroll.
        [[nodiscard]] bool takeChanges() noexcept;

        [[nodiscard]] const SurfaceStatistics& statistics() const noexcept { return counted; }

        // What may look different since the last call, for drawing only
        // that: nodes whose own drawing or anything in them changed, or
        // everything (the size or scale changed). Nodes that only moved are
        // not listed; a renderer finds them by comparing layouts.
        struct Invalidation
        {
            std::vector<NodeId> nodes; // sorted, each once
            bool everything = false;
        };
        [[nodiscard]] Invalidation takeInvalidation();
        // Marks a node as looking different for a reason the surface does
        // not track (a caret blinked).
        void invalidate(NodeId id);
        // Counts every change to the tree, its content, its accessibility or
        // its layout; equal revisions mean nothing changed in between.
        [[nodiscard]] std::uint64_t revision() const noexcept { return changes; }
        // Whether something moves by itself (a caret blinks), so the view
        // should be drawn again soon even without changes.
        [[nodiscard]] bool animating() noexcept;

        [[nodiscard]] TextEngine& textEngine() noexcept { return *options.textEngine; }
        [[nodiscard]] const std::shared_ptr<ImageSource>& images() const noexcept { return options.images; }
        [[nodiscard]] Clipboard& clipboard() noexcept { return *options.clipboard; }

        // ── Input ────────────────────────────────────────────────────────────

        void setEventSink(EventSink sink);

        // Each returns whether the UI handled the input, so a backend can pass
        // unhandled keys on to the host.
        bool pointer(const PointerInput& input);
        bool wheel(const WheelInput& input);
        bool key(const KeyInput& input);
        bool text(const TextInput& input);

        // Delivers an accessibility action to `target` (an
        // `accessibilityaction` event); whether something acted on it.
        bool accessibilityAction(NodeId target, std::string action,
                                 std::variant<std::monostate, double, std::string> value = {});

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
        [[nodiscard]] bool isRoot(const Node& node) const noexcept { return &node == rootNode || &node == overlayNode; }
        void detach(Node& child);
        void restack(Node& parent);
        [[nodiscard]] NodeId hitTest(Node& node, Point point, Point origin);
        [[nodiscard]] std::vector<NodeId> pathTo(NodeId id);
        void updateHover(PointerState& state, const PointerInput& input, NodeId target);
        void collectFocusable(Node& node, std::vector<NodeId>& out);
        bool moveFocus(bool backwards);
        bool dispatch(const Event& event);
        Event pointerEvent(Event::Type type, NodeId target, const PointerInput& input);
        [[nodiscard]] Point origin(const Node& node);
        bool scrollBy(NodeId target, float deltaX, float deltaY);
        void keepCaretVisible(Node& node);
        void markChanged() noexcept
        {
            changed = true;
            ++changes;
        }
        void markChanged(const Node& node);
        // Canvases drawn into since the last look count as invalidated.
        void collectCanvasDrawing();

        Options options;
        std::unique_ptr<YGConfig, void (*)(YGConfig*)> config;
        std::unordered_map<NodeId, std::unique_ptr<Node>> nodes;
        Node* rootNode = nullptr;
        Node* overlayNode = nullptr;
        NodeId nextId = 1;
        Size viewSize;
        float pixelScale = 1;
        SurfaceStatistics counted;
        bool changed = true;
        std::uint64_t changes = 1;
        std::vector<NodeId> invalidNodes;
        bool invalidAll = true;
        std::vector<NodeId> canvasNodes;
        EventSink sink;
        std::map<int, PointerState> pointers;
        NodeId focusedNode = noNode;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
