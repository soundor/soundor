#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>
#include <soundor/a11y/Semantics.h>
#include <soundor/render/Frame.h>
#include <soundor/ui/Input.h>
#include <soundor/ui/Style.h>
#include <soundor/ui/Svg.h>
#include <soundor/ui/Text.h>

#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <span>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

struct YGNode; // Yoga stays private to the runtime.
struct YGConfig;

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    class VectorScene;
    class SvgGeometryCache;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    using NodeId = std::uint32_t;
    inline constexpr NodeId noNode = 0;

    enum class NodeType : std::uint8_t
    {
        View, // a box; its children scroll when its style says (Style::scrolls())
        Text,
        Image,  // a bundled image, by asset id
        Input,  // an editable line of text
        Canvas, // pixels drawn by code (a 2D context)
        Svg,    // one layout leaf containing a retained vector scene
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

        friend constexpr bool operator==(const Rect&, const Rect&) = default;
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
    class Renderer;

    // How scrollTo() and scrollIntoView() move: at once, or over a moment.
    enum class ScrollBehavior : std::uint8_t
    {
        Instant,
        Smooth,
    };

    // Where scrollIntoView() puts the node in a view: as CSS's `start`,
    // `center`, `end`, and `nearest` (no more than it takes to show it).
    enum class ScrollAlignment : std::uint8_t
    {
        Start,
        Center,
        End,
        Nearest,
    };

    // How long a smooth scroll takes, eased in and out.
    inline constexpr double smoothScrollMilliseconds = 300;

    // A node of a Surface's tree. Read-only outside the Surface.
    // A scroll view's scrollbar: at rest, near a mouse, and the track under it.
    namespace scrollbar
    {
        inline constexpr float thickness = 3;
        inline constexpr float grownThickness = 8;
        inline constexpr float trackThickness = 12;
        inline constexpr float edgeGap = 2;
        inline constexpr float minLength = 16;
    } // namespace scrollbar

    class Node
    {
    public:
        Node(const Node&) = delete;
        Node& operator=(const Node&) = delete;
        ~Node();

        [[nodiscard]] NodeId id() const noexcept { return nodeId; }
        [[nodiscard]] NodeType type() const noexcept { return nodeType; }
        [[nodiscard]] Node* parent() const noexcept { return parentNode; }
        // A view whose style scrolls an axis: its children move by scrollOffset().
        [[nodiscard]] bool scrolls() const noexcept { return nodeType == NodeType::View && nodeStyle.scrolls(); }
        [[nodiscard]] std::span<Node* const> children() const noexcept { return childNodes; }
        // The children bottom to top, as drawn: by zIndex, then tree order.
        // Hit testing goes through them top to bottom.
        [[nodiscard]] std::span<Node* const> stackedChildren() const noexcept
        {
            return stacked.empty() ? childNodes : stacked;
        }
        [[nodiscard]] const Style& style() const noexcept { return nodeStyle; }
        [[nodiscard]] const Style& presentedStyle() const noexcept
        {
            return presentationMask == 0 ? nodeStyle : visualStyle;
        }
        [[nodiscard]] bool hasPresentation() const noexcept { return presentationMask != 0; }
        [[nodiscard]] bool hasCompositorPresentation() const noexcept
        {
            return (presentationMask & (transformPropertyMask | propertyBit(AnimatedProperty::Opacity))) != 0;
        }
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
        [[nodiscard]] const SvgScene* svgScene() const noexcept;
        // Input: shown while the text is empty.
        [[nodiscard]] const std::string& placeholder() const noexcept { return placeholderText; }
        [[nodiscard]] const Selection& selection() const noexcept { return textSelection; }
        // A view that scrolls: how far its children are; Input: how far its text is.
        [[nodiscard]] Point scrollOffset() const noexcept { return scroll; }
        // A view that scrolls: whether it draws its own indicators, and how a mouse has them:
        // near (the bar grown over its track), and pressed.
        [[nodiscard]] bool scrollIndicators() const noexcept { return drawsScrollIndicators; }
        [[nodiscard]] bool scrollbarGrown(bool vertical) const noexcept
        {
            return vertical ? verticalBarGrown : horizontalBarGrown;
        }
        [[nodiscard]] bool scrollbarPressed(bool vertical) const noexcept
        {
            return vertical ? verticalBarPressed : horizontalBarPressed;
        }
        // What plugin code says the node is to assistive technology.
        [[nodiscard]] const a11y::Properties& accessibility() const noexcept { return semantics; }
        // Where assistive technology reads the node, in place of its parent
        // (noNode: its parent).
        [[nodiscard]] NodeId accessibilityParent() const noexcept { return semanticParent; }
        // The name developer tools (DevTools, Soundor Driver) find the node
        // by; empty when it has none. Not shown, nor read to assistive technology.
        [[nodiscard]] const std::string& debugId() const noexcept { return debugName; }

    private:
        friend class Surface;
        friend class Renderer;
        friend struct NodeAccess;
        Node(Surface& owner, NodeId id, NodeType type);

        Surface& surface;
        NodeId nodeId;
        NodeType nodeType;
        YGNode* yoga;
        std::unique_ptr<render::VectorScene> vectorScene;
        Node* parentNode = nullptr;
        std::vector<Node*> childNodes;
        // childNodes sorted by zIndex; empty while that is tree order.
        std::vector<Node*> stacked;
        Style nodeStyle;
        Style visualStyle;
        PropertyMask presentationMask = 0;
        std::string textContent;
        std::string imageSource;
        std::string placeholderText;
        Selection textSelection;
        std::shared_ptr<CanvasBuffer> canvasBuffer;
        Point scroll;
        a11y::Properties semantics;
        NodeId semanticParent = noNode;
        std::string debugName;
        bool canFocus = false;
        bool drawsScrollIndicators = true;
        bool verticalBarGrown = false;
        bool horizontalBarGrown = false;
        bool verticalBarPressed = false;
        bool horizontalBarPressed = false;
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
            FocusVisibleChange, // does not bubble
            DoubleClick,
        };

        Type type = Type::PointerMove;
        NodeId target = noNode;
        // Focus/blur: the node losing/gaining focus. Enter/leave: the node the
        // pointer came from/went to.
        NodeId related = noNode;

        Point position;
        Point offset;
        // Where the pointer is on the screen, in the editor's logical pixels
        // (PointerInput::screen).
        Point screen;
        // How far the pointer moved since its previous input, also while
        // locked (when `position` stays where the lock began).
        Point movement;
        int pointerId = 0;
        PointerType pointerType = PointerType::Mouse;
        int button = -1;
        unsigned buttons = 0;
        float pressure = 0;
        // Click and DoubleClick: the press's click count (PointerInput::clicks).
        int detail = 0;

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

        // Focus, blur and focus-visible changes: whether the target shows its
        // focus now (focusVisible()).
        bool focusVisible = false;
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
        std::uint64_t svgSceneUpdates = 0;   // installed/cleared vector snapshots
        std::uint64_t svgPathParses = 0;     // cache misses that parse path syntax
        std::uint64_t svgDraws = 0;          // vector scene walks within damage
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
        void setDebugId(NodeId id, std::string debugId);
        void setScrollIndicators(NodeId id, bool shown);
        // Image nodes.
        void setSource(NodeId id, std::string source);
        // Validates/compiles before replacing the scene; invalid input leaves
        // the old scene installed. Clearing preserves the UI node and Style.
        void setSvgScene(NodeId id, std::optional<SvgScene> scene);
        // Input nodes.
        void setPlaceholder(NodeId id, std::string placeholder);
        // Clamped to the text and to code point boundaries.
        void setSelection(NodeId id, Selection selection);
        // What assistive technology is told about the node.
        void setAccessibility(NodeId id, a11y::Properties properties);
        // Reads `id` as a child of `parent` (noNode: of its own parent), as for
        // content a portal shows elsewhere than where it belongs.
        void setAccessibilityParent(NodeId id, NodeId parent);
        // Views that scroll (Node::scrolls()), along the axes they scroll,
        // clamped to the content; nothing for any other node. Smooth: there in
        // smoothScrollMilliseconds, frame by frame (deliverScrolls()), unless
        // reduced motion is asked for; a wheel, a scrollbar, or scrolling the
        // node again stops it where it is.
        void scrollTo(NodeId id, Point offset, ScrollBehavior behavior = ScrollBehavior::Instant);
        // Scrolls each view around `id` that scrolls, innermost first, to
        // bring it into view as Element.scrollIntoView() does: `block` on the
        // vertical axis, `inline` on the horizontal. By layout boxes: a
        // transform does not move what it scrolls to.
        void scrollIntoView(NodeId id, ScrollAlignment block, ScrollAlignment inlineAxis, ScrollBehavior behavior);
        // The size of the children's extent, plus the padding at the far ends.
        [[nodiscard]] Size contentSize(NodeId id);
        // The size of its content box: how much of contentSize() shows.
        [[nodiscard]] Size clientSize(NodeId id);
        // Images became available or changed: lays image nodes out again.
        void imagesChanged();
        // Registers a font file with the text engine (TextEngine::addFont)
        // and lays text out again in it; an error message if it is not one.
        std::optional<std::string> addFont(std::string_view family, std::string_view source, int weight,
                                           FontStyle style);
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

        [[nodiscard]] AnimationTimeline& animations() noexcept { return timeline; }
        [[nodiscard]] Presentation presentation(NodeId id);
        void setPresentation(NodeId id, const Presentation& value, PropertyMask properties);
        void clearPresentation(NodeId id, PropertyMask properties);
        [[nodiscard]] render::Transform visualTransform(NodeId id);
        [[nodiscard]] Point localPoint(NodeId id, Point point);

        // ── Layout ───────────────────────────────────────────────────────────

        // The view's size in logical pixels; the root fills it.
        void setSize(Size size);
        [[nodiscard]] Size size() const noexcept { return viewSize; }
        // Device pixels per logical pixel; layout snaps to device pixels.
        void setScale(float scale);
        [[nodiscard]] float scale() const noexcept { return pixelScale; }
        // The part of the view always shown whole, in its logical pixels:
        // all of it (nullopt, the default), or less where the backend lays
        // the view out beyond the size the plugin designed it at (an editor
        // that scales with fit 'cover'). Told to plugin code with the size;
        // layout does not read it.
        void setSafeArea(std::optional<Rect> area) noexcept { safe = area; }
        [[nodiscard]] Rect safeArea() const noexcept
        {
            return safe.value_or(Rect { 0, 0, viewSize.width, viewSize.height });
        }
        // The size of the editor the view is shown in (the plugin's window),
        // in its logical pixels: the view's size times the zoom of an editor
        // that scales. 0×0 until the backend sets it.
        void setEditorSize(Size size) noexcept { editor = size; }
        [[nodiscard]] Size editorSize() const noexcept { return editor; }
        // Whether the editor's size can be asked for (soundor:ui's
        // requestEditorSize()): the backend says so for an editor whose
        // limits allow another size; false by default.
        void setEditorResizable(bool resizable) noexcept { editorResizable = resizable; }
        [[nodiscard]] bool canRequestEditorSize() const noexcept { return editorResizable; }
        // How the backend holds a size plugin code asks for to the editor's
        // limits (and its aspect ratio, and what it learned of the host's),
        // so requestEditorSize() can say at once what is asked of the host.
        // None: the size as asked.
        void setEditorSizeHold(std::function<Size(Size)> hold) { editorHold = std::move(hold); }
        // Plugin code asking for another editor size, in its logical pixels:
        // held as the backend holds it, the latest request is kept until the
        // backend takes it, resizes the editor and says what it got with
        // setEditorSize(). Returns the size asked of the host, or nothing
        // where the editor's size cannot be asked for.
        std::optional<Size> requestEditorSize(Size size)
        {
            if (! editorResizable)
                return std::nullopt;
            editorRequest = editorHold ? editorHold(size) : size;
            return editorRequest;
        }
        [[nodiscard]] std::optional<Size> takeEditorSizeRequest() noexcept
        {
            return std::exchange(editorRequest, std::nullopt);
        }

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
        // A key as a platform delivers it: the key event first, then, when
        // the UI does not handle a press, the text it types (empty: none).
        bool key(const KeyInput& input, const std::string& typed);
        bool text(const TextInput& input);
        // The cursor `pointerId` shows: the style's of the node holding it
        // (pressed), or else of the deepest it hovers, or of their nearest
        // ancestor with one; a text input's Text, the arrow (Default) where
        // none has one. Never Auto. Read again after input and changes.
        [[nodiscard]] Cursor cursor(int pointerId = 1);
        // Hover follows what changed under pointers that did not move, as in
        // browsers: when the tree, a layout or a scroll changed since the last
        // call, each mouse or pen in the view and not pressed is hit-tested
        // again where it is, and pointerleave/pointerenter fire as for a move
        // (no pointermove). The runtime calls it every tick.
        void refreshHover();

        // Moves smooth scrolls on to where they are by now, then fires `scroll`
        // at each view scrollTo() moved since the last call, once, as a
        // browser does on its next frame: code that scrolls is not re-entered
        // by its own listeners. The runtime calls it every tick.
        void deliverScrolls();

        // A node holding a pointer's input for the press in progress: hidden by
        // the backend, not stopped by the screen's edges, its events at the
        // position the lock began with only `movement` changing.
        struct PointerLock
        {
            NodeId node = noNode;
            int pointerId = 0;
            Point position; // where it began, in the view
        };
        // Locks the mouse or pen pressing `id` or a node in it to `id`, until
        // its release, exitPointerLock(), or `id` leaving the tree; whether
        // there was such a press. One lock at a time: a new one replaces it.
        bool requestPointerLock(NodeId id);
        void exitPointerLock() noexcept;
        // The lock in force, for the backend to apply (read after input and
        // every tick, as cursor()).
        [[nodiscard]] std::optional<PointerLock> pointerLock();

        // Delivers an accessibility action to `target` (an
        // `accessibilityaction` event); whether something acted on it.
        bool accessibilityAction(NodeId target, std::string action,
                                 std::variant<std::monostate, double, std::string> value = {});

        // Moves focus to `id` (focusable and connected) or nowhere (noNode),
        // dispatching blur and focus, and a focus-visible change to each
        // whose focusVisible() changes.
        void focus(NodeId id);
        [[nodiscard]] NodeId focused() noexcept;
        // Whether the focused node should show that it has focus, as CSS's
        // :focus-visible: unless a pointer press was the last input before
        // it took focus. A text input always shows it, and a key press (not
        // a shortcut nor a lone modifier) shows it from then on.
        [[nodiscard]] bool focusVisible() noexcept;

#if SOUNDOR_DEVTOOLS
        // Debug state is separate from layout, styles and event targets.
        // The nodes DevTools highlights over the view, each drawn: every
        // client's, and the picker's.
        void debugHighlights(std::vector<NodeId> ids);
        void debugRecording(bool enabled) noexcept { recordingDebug = enabled; }
        [[nodiscard]] bool debugRecording() const noexcept { return recordingDebug; }
        void debugRasterTime(std::uint64_t nanoseconds) noexcept { rasterDebugNanoseconds += nanoseconds; }
        [[nodiscard]] std::uint64_t debugRasterTime() const noexcept { return rasterDebugNanoseconds; }
        [[nodiscard]] const std::vector<NodeId>& debugHighlights() const noexcept { return highlighted; }
        [[nodiscard]] bool takeDebugChanges() noexcept;
        [[nodiscard]] std::uint64_t debugStructureRevision() const noexcept { return structureChanges; }
        [[nodiscard]] std::vector<int> cancelPointers();
        void debugMetadataSubscription(bool enabled) noexcept;
        [[nodiscard]] std::vector<NodeId> takeDebugMetadataChanges(bool& overflow);
#endif

    private:
#if SOUNDOR_DEVTOOLS
        std::uint64_t rasterDebugNanoseconds = 0;
        std::uint64_t structureChanges = 0;
        std::vector<NodeId> highlighted;
        bool recordingDebug = false;
        bool highlightChanged = false;
        bool metadataSubscribed = false;
        bool metadataOverflow = false;
        std::set<NodeId> metadataDirty;
        void debugMetadataChanged(const Node& node);
#endif
        friend class Node;
        friend class Renderer;
        friend struct NodeAccess;

        struct PointerState
        {
            NodeId captured = noNode;    // the pointerdown target, while pressed
            std::vector<NodeId> hovered; // root ... deepest hovered node
            PointerInput last;           // where hover is refreshed from
            int clicks = 1;              // the press's click count, while pressed
            bool inside = false;         // in the view, as of the last input
        };

        [[nodiscard]] Node& get(NodeId id);
        [[nodiscard]] bool isRoot(const Node& node) const noexcept { return &node == rootNode || &node == overlayNode; }
        void detach(Node& child);
        void restack(Node& parent);
        [[nodiscard]] NodeId hitTest(Node& node, Point point, Point origin);
        [[nodiscard]] std::vector<NodeId> pathTo(NodeId id);
        void updateHover(PointerState& state, const PointerInput& input, NodeId target);
        // A scroll view's own scrollbar: what a mouse does to it is the view's,
        // and goes no further.
        struct ScrollbarDrag
        {
            int pointerId = 0;
            NodeId node = noNode;
            bool vertical = true;
            float from = 0;   // where along the axis it was pressed, in the node
            float scroll = 0; // where that scrolled to; may be past either end
        };
        struct ScrollbarGeometry
        {
            float room = 0;
            float range = 0;
            float length = 0;
            float travel = 0;
        };
        [[nodiscard]] ScrollbarGeometry scrollbarGeometry(const Node& node, bool vertical);
        // Which scroll views have the point on their tracks, and grows their bars.
        void updateScrollbars(NodeId hit, Point point);
        [[nodiscard]] std::optional<std::pair<NodeId, bool>> scrollbarAt(NodeId hit);
        void pressScrollbar(const PointerInput& input, NodeId id, bool vertical);
        bool routeScrollbarDrag(const PointerInput& input);
        void scrollAlong(Node& node, bool vertical, float position);
        // Within its content, on the axes it scrolls (0 on the others).
        [[nodiscard]] Point clampScroll(const Node& node, Point offset);
        // Clamped to its content; whether it moved. Whoever moves it says so.
        // Ends a smooth scroll of it unless `smooth` is that scroll moving it.
        bool moveScroll(Node& node, Point offset, bool smooth = false);
        // What its style no longer scrolls goes back to 0, its scrollbar too.
        void scrollingChanged(Node& node);
        void endScrollbarDrag();
        void collectFocusable(Node& node, std::vector<NodeId>& out);
        bool moveFocus(bool backwards);
        bool dispatch(const Event& event);
        Event pointerEvent(Event::Type type, NodeId target, const PointerInput& input);
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

        AnimationTimeline timeline;
        Options options;
        std::unique_ptr<YGConfig, void (*)(YGConfig*)> config;
        std::unordered_map<NodeId, std::unique_ptr<Node>> nodes;
        Node* rootNode = nullptr;
        Node* overlayNode = nullptr;
        NodeId nextId = 1;
        Size viewSize;
        float pixelScale = 1;
        std::optional<Rect> safe;
        Size editor;
        std::optional<Size> editorRequest;
        SurfaceStatistics counted;
        std::unique_ptr<render::SvgGeometryCache> svgGeometryCache;
        std::function<Size(Size)> editorHold;
        bool changed = true;
        bool editorResizable = false;
        std::uint64_t changes = 1;
        std::vector<NodeId> invalidNodes;
        bool invalidAll = true;
        std::vector<NodeId> canvasNodes;
        EventSink sink;
        std::map<int, PointerState> pointers;
        std::optional<ScrollbarDrag> scrollbarDrag;
        std::vector<NodeId> grownScrollbars;
        // Moved by scrollTo(), and not yet told.
        std::vector<NodeId> pendingScrolls;
        struct SmoothScroll
        {
            NodeId node = noNode;
            Point from;
            Point to;
            double started = 0;
        };
        std::vector<SmoothScroll> smoothScrolls;
        NodeId focusedNode = noNode;
        // Whether the focused node shows its focus, and whether the last
        // input was the keyboard's (or assistive technology's) rather than a
        // pointer press: what focus moved now would show.
        bool focusShown = false;
        bool keyboardModality = true;
        void showFocus();
        // revision() when hover was last refreshed.
        std::uint64_t hoverRevision = 0;
        std::optional<PointerLock> lock;
        Point lockPosition; // where the lock began, in the view
        // The movement of the input being routed, for its events.
        Point routedMovement;
        bool route(PointerState& state, const PointerInput& input);
        // Ends the lock; the pointer shows again where it began, so movement
        // counts from there.
        void endLock() noexcept;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
