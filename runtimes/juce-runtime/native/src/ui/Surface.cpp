#include <soundor/ui/Surface.h>

#include <yoga/Yoga.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <ranges>
#include <stdexcept>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    namespace
    {
        // ── Style → Yoga ─────────────────────────────────────────────────────

        constexpr YGEdge edges[] = { YGEdgeTop, YGEdgeRight, YGEdgeBottom, YGEdgeLeft };

        template <typename T>
        T edge(const Edges<T>& values, std::size_t index)
        {
            switch (index)
            {
                case 0:
                    return values.top;
                case 1:
                    return values.right;
                case 2:
                    return values.bottom;
                default:
                    return values.left;
            }
        }

        // Sets a length through Yoga's point/percent/auto setters; a missing
        // setter (min/max have no auto) leaves the length undefined.
        template <typename Point, typename Percent, typename Auto>
        void setLength(const Length& length, Point point, Percent percent, Auto automatic)
        {
            switch (length.unit)
            {
                case Length::Unit::Point:
                    point(length.value);
                    break;
                case Length::Unit::Percent:
                    percent(length.value);
                    break;
                case Length::Unit::Auto:
                    automatic();
                    break;
                case Length::Unit::Undefined:
                    point(YGUndefined);
                    break;
            }
        }

        void applyStyle(YGNodeRef node, const Style& style)
        {
            constexpr YGDisplay displays[] = { YGDisplayFlex, YGDisplayNone };
            constexpr YGPositionType positions[] = { YGPositionTypeRelative, YGPositionTypeAbsolute,
                                                     YGPositionTypeStatic };
            constexpr YGFlexDirection directions[] = { YGFlexDirectionColumn, YGFlexDirectionColumnReverse,
                                                       YGFlexDirectionRow, YGFlexDirectionRowReverse };
            constexpr YGWrap wraps[] = { YGWrapNoWrap, YGWrapWrap, YGWrapWrapReverse };
            constexpr YGJustify justifies[] = { YGJustifyFlexStart,    YGJustifyCenter,      YGJustifyFlexEnd,
                                                YGJustifySpaceBetween, YGJustifySpaceAround, YGJustifySpaceEvenly };
            constexpr YGAlign aligns[] = { YGAlignAuto,         YGAlignFlexStart,   YGAlignCenter,
                                           YGAlignFlexEnd,      YGAlignStretch,     YGAlignBaseline,
                                           YGAlignSpaceBetween, YGAlignSpaceAround, YGAlignSpaceEvenly };
            constexpr YGOverflow overflows[] = { YGOverflowVisible, YGOverflowHidden, YGOverflowScroll };
            constexpr YGBoxSizing boxSizings[] = { YGBoxSizingBorderBox, YGBoxSizingContentBox };

            const auto index = [](auto value) { return static_cast<std::size_t>(value); };
            YGNodeStyleSetDisplay(node, displays[index(style.display)]);
            YGNodeStyleSetPositionType(node, positions[index(style.position)]);
            YGNodeStyleSetFlexDirection(node, directions[index(style.flexDirection)]);
            YGNodeStyleSetFlexWrap(node, wraps[index(style.flexWrap)]);
            YGNodeStyleSetJustifyContent(node, justifies[index(style.justifyContent)]);
            YGNodeStyleSetAlignItems(node, aligns[index(style.alignItems)]);
            YGNodeStyleSetAlignSelf(node, aligns[index(style.alignSelf)]);
            YGNodeStyleSetAlignContent(node, aligns[index(style.alignContent)]);
            YGNodeStyleSetFlexGrow(node, style.flexGrow);
            YGNodeStyleSetFlexShrink(node, style.flexShrink);
            setLength(
                style.flexBasis, [&](float v) { YGNodeStyleSetFlexBasis(node, v); },
                [&](float v) { YGNodeStyleSetFlexBasisPercent(node, v); }, [&] { YGNodeStyleSetFlexBasisAuto(node); });

            setLength(
                style.width, [&](float v) { YGNodeStyleSetWidth(node, v); },
                [&](float v) { YGNodeStyleSetWidthPercent(node, v); }, [&] { YGNodeStyleSetWidthAuto(node); });
            setLength(
                style.height, [&](float v) { YGNodeStyleSetHeight(node, v); },
                [&](float v) { YGNodeStyleSetHeightPercent(node, v); }, [&] { YGNodeStyleSetHeightAuto(node); });
            setLength(
                style.minWidth, [&](float v) { YGNodeStyleSetMinWidth(node, v); }, [&](float v)
                { YGNodeStyleSetMinWidthPercent(node, v); }, [&] { YGNodeStyleSetMinWidth(node, YGUndefined); });
            setLength(
                style.minHeight, [&](float v) { YGNodeStyleSetMinHeight(node, v); }, [&](float v)
                { YGNodeStyleSetMinHeightPercent(node, v); }, [&] { YGNodeStyleSetMinHeight(node, YGUndefined); });
            setLength(
                style.maxWidth, [&](float v) { YGNodeStyleSetMaxWidth(node, v); }, [&](float v)
                { YGNodeStyleSetMaxWidthPercent(node, v); }, [&] { YGNodeStyleSetMaxWidth(node, YGUndefined); });
            setLength(
                style.maxHeight, [&](float v) { YGNodeStyleSetMaxHeight(node, v); }, [&](float v)
                { YGNodeStyleSetMaxHeightPercent(node, v); }, [&] { YGNodeStyleSetMaxHeight(node, YGUndefined); });
            YGNodeStyleSetAspectRatio(node, std::isnan(style.aspectRatio) ? YGUndefined : style.aspectRatio);
            YGNodeStyleSetBoxSizing(node, boxSizings[index(style.boxSizing)]);

            for (std::size_t i = 0; i < 4; ++i)
            {
                const YGEdge yogaEdge = edges[i];
                setLength(
                    edge(style.margin, i), [&](float v) { YGNodeStyleSetMargin(node, yogaEdge, v); },
                    [&](float v) { YGNodeStyleSetMarginPercent(node, yogaEdge, v); },
                    [&] { YGNodeStyleSetMarginAuto(node, yogaEdge); });
                setLength(
                    edge(style.padding, i), [&](float v) { YGNodeStyleSetPadding(node, yogaEdge, v); },
                    [&](float v) { YGNodeStyleSetPaddingPercent(node, yogaEdge, v); },
                    [&] { YGNodeStyleSetPadding(node, yogaEdge, 0); });
                setLength(
                    edge(style.inset, i), [&](float v) { YGNodeStyleSetPosition(node, yogaEdge, v); },
                    [&](float v) { YGNodeStyleSetPositionPercent(node, yogaEdge, v); },
                    [&] { YGNodeStyleSetPositionAuto(node, yogaEdge); });
                YGNodeStyleSetBorder(node, yogaEdge, edge(style.borderWidth, i));
            }
            YGNodeStyleSetGap(node, YGGutterRow, style.rowGap);
            YGNodeStyleSetGap(node, YGGutterColumn, style.columnGap);
            YGNodeStyleSetOverflow(node, overflows[index(style.overflow)]);
        }

        class MemoryClipboard final : public Clipboard
        {
        public:
            std::string readText() override { return text; }
            void writeText(std::string value) override { text = std::move(value); }

        private:
            std::string text;
        };

        bool isContinuation(char c) noexcept
        {
            return (static_cast<unsigned char>(c) & 0xC0) == 0x80;
        }

        // Pixels a wheel line scrolls, as browsers do.
        constexpr float pixelsPerLine = 40;

        // Applies a measure mode to a natural size.
        float constrain(float natural, float available, YGMeasureMode mode)
        {
            if (mode == YGMeasureModeExactly)
                return available;
            if (mode == YGMeasureModeAtMost)
                return std::min(natural, available);
            return natural;
        }
    } // namespace

    std::shared_ptr<Clipboard> memoryClipboard()
    {
        return std::make_shared<MemoryClipboard>();
    }

    // What Yoga's C callbacks need of a node.
    struct NodeAccess
    {
        static YGSize measureText(YGNodeConstRef yoga, float width, YGMeasureMode widthMode, float height,
                                  YGMeasureMode heightMode)
        {
            const auto* node = static_cast<const Node*>(YGNodeGetContext(yoga));
            const float maxWidth = widthMode == YGMeasureModeUndefined ? std::numeric_limits<float>::infinity() : width;
            const Size size =
                node->surface.options.textEngine->layout(node->textContent, node->nodeStyle.text, maxWidth).size;
            return { constrain(size.width, width, widthMode), constrain(size.height, height, heightMode) };
        }

        static YGSize measureInput(YGNodeConstRef yoga, float width, YGMeasureMode widthMode, float height,
                                   YGMeasureMode heightMode)
        {
            const auto* node = static_cast<const Node*>(YGNodeGetContext(yoga));
            TextEngine& engine = *node->surface.options.textEngine;
            const TextStyle& style = node->nodeStyle.text;
            const std::string& shown = node->textContent.empty() ? node->placeholderText : node->textContent;
            // One line, with room for the caret.
            const float natural = engine.advance(shown, style) + 1;
            const float lineHeight = style.lineHeight > 0 ? style.lineHeight : style.fontSize * 1.2f;
            return { constrain(natural, width, widthMode), constrain(lineHeight, height, heightMode) };
        }

        static YGSize measureImage(YGNodeConstRef yoga, float width, YGMeasureMode widthMode, float height,
                                   YGMeasureMode heightMode)
        {
            const auto* node = static_cast<const Node*>(YGNodeGetContext(yoga));
            Size natural;
            if (node->surface.options.images != nullptr)
                natural = node->surface.options.images->imageSize(node->imageSource).value_or(Size {});
            // One side given: the other follows the image's aspect ratio.
            if (natural.width > 0 && natural.height > 0)
            {
                if (widthMode == YGMeasureModeExactly && heightMode != YGMeasureModeExactly)
                    natural = { width, width * natural.height / natural.width };
                else if (heightMode == YGMeasureModeExactly && widthMode != YGMeasureModeExactly)
                    natural = { height * natural.width / natural.height, height };
            }
            return { constrain(natural.width, width, widthMode), constrain(natural.height, height, heightMode) };
        }
    };

    // ── Node ─────────────────────────────────────────────────────────────────

    Node::Node(Surface& owner, NodeId id, NodeType type)
        : surface(owner), nodeId(id), nodeType(type), yoga(YGNodeNewWithConfig(owner.config.get()))
    {
        YGNodeSetContext(yoga, this);
        applyStyle(yoga, nodeStyle);
        switch (type)
        {
            case NodeType::Text:
                YGNodeSetNodeType(yoga, YGNodeTypeText);
                YGNodeSetMeasureFunc(yoga, &NodeAccess::measureText);
                break;
            case NodeType::Input:
                YGNodeSetMeasureFunc(yoga, &NodeAccess::measureInput);
                canFocus = true;
                break;
            case NodeType::Image:
                YGNodeSetMeasureFunc(yoga, &NodeAccess::measureImage);
                break;
            case NodeType::View:
            case NodeType::Scroll:
                break;
        }
    }

    Node::~Node()
    {
        YGNodeFree(yoga);
    }

    Rect Node::frame() const noexcept
    {
        return { YGNodeLayoutGetLeft(yoga), YGNodeLayoutGetTop(yoga), YGNodeLayoutGetWidth(yoga),
                 YGNodeLayoutGetHeight(yoga) };
    }

    Rect Node::contentBox() const noexcept
    {
        const float left = YGNodeLayoutGetBorder(yoga, YGEdgeLeft) + YGNodeLayoutGetPadding(yoga, YGEdgeLeft);
        const float top = YGNodeLayoutGetBorder(yoga, YGEdgeTop) + YGNodeLayoutGetPadding(yoga, YGEdgeTop);
        const float right = YGNodeLayoutGetBorder(yoga, YGEdgeRight) + YGNodeLayoutGetPadding(yoga, YGEdgeRight);
        const float bottom = YGNodeLayoutGetBorder(yoga, YGEdgeBottom) + YGNodeLayoutGetPadding(yoga, YGEdgeBottom);
        return { left, top, std::max(0.0f, YGNodeLayoutGetWidth(yoga) - left - right),
                 std::max(0.0f, YGNodeLayoutGetHeight(yoga) - top - bottom) };
    }

    // ── Surface: the tree ────────────────────────────────────────────────────

    Surface::Surface(Options provided) : options(std::move(provided)), config(YGConfigNew(), &YGConfigFree)
    {
        if (options.textEngine == nullptr)
            options.textEngine = approximateTextEngine();
        if (options.clipboard == nullptr)
            options.clipboard = memoryClipboard();
        YGConfigSetPointScaleFactor(config.get(), pixelScale);
        rootNode = &get(createNode(NodeType::View));
    }

    Surface::~Surface()
    {
        // Children first, so no Yoga node is freed while still owned.
        for (auto& [id, node] : nodes)
            YGNodeRemoveAllChildren(node->yoga);
        nodes.clear();
    }

    Node& Surface::get(NodeId id)
    {
        const auto found = nodes.find(id);
        if (found == nodes.end())
            throw std::invalid_argument("unknown node " + std::to_string(id));
        return *found->second;
    }

    Node* Surface::find(NodeId id) noexcept
    {
        const auto found = nodes.find(id);
        return found == nodes.end() ? nullptr : found->second.get();
    }

    bool Surface::isConnected(NodeId id) noexcept
    {
        const Node* node = find(id);
        while (node != nullptr && node != rootNode)
            node = node->parentNode;
        return node != nullptr;
    }

    NodeId Surface::createNode(NodeType type)
    {
        const NodeId id = nextId++;
        nodes.emplace(id, std::unique_ptr<Node>(new Node(*this, id, type)));
        return id;
    }

    void Surface::detach(Node& child)
    {
        Node* parent = child.parentNode;
        if (parent == nullptr)
            return;
        YGNodeRemoveChild(parent->yoga, child.yoga);
        std::erase(parent->childNodes, &child);
        child.parentNode = nullptr;
        changed = true;
    }

    void Surface::releaseNode(NodeId id)
    {
        Node& node = get(id);
        if (&node == rootNode)
            throw std::invalid_argument("the root node cannot be released");
        detach(node);
        for (Node* child : std::vector<Node*>(node.childNodes))
            detach(*child);
        for (auto& [pointerId, state] : pointers)
        {
            if (state.captured == id)
                state.captured = noNode;
            std::erase(state.hovered, id);
        }
        if (focusedNode == id)
            focusedNode = noNode;
        nodes.erase(id);
    }

    void Surface::insertChild(NodeId parentId, NodeId childId, NodeId beforeId)
    {
        Node& parent = get(parentId);
        Node& child = get(childId);
        if (&child == rootNode)
            throw std::invalid_argument("the root node cannot be a child");
        if (parent.nodeType != NodeType::View && parent.nodeType != NodeType::Scroll)
            throw std::invalid_argument("only views can have children");
        for (const Node* ancestor = &parent; ancestor != nullptr; ancestor = ancestor->parentNode)
            if (ancestor == &child)
                throw std::invalid_argument("a node cannot contain itself");
        Node* before = nullptr;
        if (beforeId != noNode)
        {
            before = &get(beforeId);
            if (before->parentNode != &parent)
                throw std::invalid_argument("the reference node is not a child of this node");
            if (before == &child)
                return;
        }

        detach(child);
        const auto position = before == nullptr ? parent.childNodes.end()
                                                : std::find(parent.childNodes.begin(), parent.childNodes.end(), before);
        const auto index = static_cast<std::size_t>(position - parent.childNodes.begin());
        parent.childNodes.insert(position, &child);
        YGNodeInsertChild(parent.yoga, child.yoga, index);
        child.parentNode = &parent;
        changed = true;
    }

    void Surface::removeChild(NodeId parentId, NodeId childId)
    {
        Node& parent = get(parentId);
        Node& child = get(childId);
        if (child.parentNode != &parent)
            throw std::invalid_argument("the node is not a child of this node");
        detach(child);
    }

    void Surface::setStyle(NodeId id, const Style& style)
    {
        Node& node = get(id);
        const bool textChanged = node.nodeStyle.text != style.text;
        node.nodeStyle = style;
        applyStyle(node.yoga, style);
        if (textChanged && (node.nodeType == NodeType::Text || node.nodeType == NodeType::Input))
        {
            YGNodeMarkDirty(node.yoga);
            node.layoutWidth = -1;
        }
        changed = true;
    }

    void Surface::setText(NodeId id, std::string text)
    {
        Node& node = get(id);
        if (node.nodeType != NodeType::Text && node.nodeType != NodeType::Input)
            throw std::invalid_argument("only text and input nodes have text");
        if (node.textContent == text)
            return;
        node.textContent = std::move(text);
        node.layoutWidth = -1;
        YGNodeMarkDirty(node.yoga);
        if (node.nodeType == NodeType::Input)
            setSelection(id, node.textSelection);
        changed = true;
    }

    void Surface::setSource(NodeId id, std::string source)
    {
        Node& node = get(id);
        if (node.nodeType != NodeType::Image)
            throw std::invalid_argument("only image nodes have a source");
        if (node.imageSource == source)
            return;
        node.imageSource = std::move(source);
        YGNodeMarkDirty(node.yoga);
        changed = true;
    }

    void Surface::setPlaceholder(NodeId id, std::string placeholder)
    {
        Node& node = get(id);
        if (node.nodeType != NodeType::Input)
            throw std::invalid_argument("only input nodes have a placeholder");
        if (node.placeholderText == placeholder)
            return;
        node.placeholderText = std::move(placeholder);
        YGNodeMarkDirty(node.yoga);
        changed = true;
    }

    void Surface::setSelection(NodeId id, Selection selection)
    {
        Node& node = get(id);
        if (node.nodeType != NodeType::Input)
            throw std::invalid_argument("only input nodes have a selection");
        const std::string& text = node.textContent;
        const auto clamp = [&](std::size_t offset)
        {
            offset = std::min(offset, text.size());
            while (offset > 0 && offset < text.size() && isContinuation(text[offset]))
                --offset;
            return offset;
        };
        selection = { clamp(selection.anchor), clamp(selection.focus) };
        if (node.textSelection != selection)
        {
            node.textSelection = selection;
            changed = true;
        }
        layout();
        keepCaretVisible(node);
    }

    void Surface::keepCaretVisible(Node& node)
    {
        // Laid out already: by setSelection(), or by layout() itself.
        const float width = node.contentBox().width;
        const float caret = options.textEngine->advance(
            std::string_view(node.textContent).substr(0, node.textSelection.focus), node.nodeStyle.text);
        const float total = options.textEngine->advance(node.textContent, node.nodeStyle.text) + 1;
        // Scrolled so the caret shows, and no further than the text goes.
        float scrollX = std::max(std::min(node.scroll.x, caret), caret + 1 - width);
        scrollX = std::min(std::max(scrollX, 0.0f), std::max(0.0f, total - width));
        if (scrollX != node.scroll.x)
        {
            node.scroll.x = scrollX;
            changed = true;
        }
    }

    Size Surface::contentSize(NodeId id)
    {
        layout();
        const Node& node = get(id);
        const Rect content = node.contentBox();
        // The children's extent, plus the padding at the far ends.
        Size size { content.width, content.height };
        const float paddingRight = YGNodeLayoutGetPadding(node.yoga, YGEdgeRight);
        const float paddingBottom = YGNodeLayoutGetPadding(node.yoga, YGEdgeBottom);
        for (const Node* child : node.childNodes)
        {
            if (child->nodeStyle.display == Display::None)
                continue;
            const Rect frame = child->frame();
            size.width = std::max(size.width, frame.x + frame.width + YGNodeLayoutGetMargin(child->yoga, YGEdgeRight)
                                                  + paddingRight - content.x);
            size.height =
                std::max(size.height, frame.y + frame.height + YGNodeLayoutGetMargin(child->yoga, YGEdgeBottom)
                                          + paddingBottom - content.y);
        }
        return size;
    }

    void Surface::scrollTo(NodeId id, Point offset)
    {
        Node& node = get(id);
        if (node.nodeType != NodeType::Scroll)
            throw std::invalid_argument("only scroll nodes scroll");
        const Size content = contentSize(id);
        const Rect box = node.contentBox();
        const Point clamped { std::clamp(offset.x, 0.0f, std::max(0.0f, content.width - box.width)),
                              std::clamp(offset.y, 0.0f, std::max(0.0f, content.height - box.height)) };
        if (clamped.x == node.scroll.x && clamped.y == node.scroll.y)
            return;
        node.scroll = clamped;
        changed = true;
    }

    void Surface::imagesChanged()
    {
        for (auto& [id, node] : nodes)
            if (node->nodeType == NodeType::Image)
                YGNodeMarkDirty(node->yoga);
        changed = true;
    }

    void Surface::setFocusable(NodeId id, bool focusable)
    {
        get(id).canFocus = focusable;
    }

    // ── Surface: layout ──────────────────────────────────────────────────────

    void Surface::setSize(Size size)
    {
        if (size.width == viewSize.width && size.height == viewSize.height)
            return;
        viewSize = size;
        changed = true;
    }

    void Surface::setScale(float scale)
    {
        if (scale <= 0 || scale == pixelScale)
            return;
        pixelScale = scale;
        YGConfigSetPointScaleFactor(config.get(), scale);
        // Snapping changed everywhere: lay the whole tree out again.
        YGNodeStyleSetWidth(rootNode->yoga, YGUndefined);
        changed = true;
    }

    void Surface::layout()
    {
        // The root fills the view whatever its style says.
        YGNodeStyleSetWidth(rootNode->yoga, viewSize.width);
        YGNodeStyleSetHeight(rootNode->yoga, viewSize.height);
        if (! YGNodeIsDirty(rootNode->yoga))
            return;
        YGNodeCalculateLayout(rootNode->yoga, viewSize.width, viewSize.height, YGDirectionLTR);
        // An input's width may have changed: keep its caret in view.
        for (auto& [id, node] : nodes)
            if (node->nodeType == NodeType::Input)
                keepCaretVisible(*node);
    }

    Rect Surface::bounds(NodeId id)
    {
        if (! isConnected(id))
            throw std::invalid_argument("the node is not in the tree");
        layout();
        const Node& node = get(id);
        const Rect frame = node.frame();
        const Point at = origin(node);
        return { at.x, at.y, frame.width, frame.height };
    }

    Point Surface::origin(const Node& node)
    {
        Point at { node.frame().x, node.frame().y };
        for (const Node* ancestor = node.parentNode; ancestor != nullptr; ancestor = ancestor->parentNode)
        {
            const Rect frame = ancestor->frame();
            at.x += frame.x - ancestor->scroll.x;
            at.y += frame.y - ancestor->scroll.y;
        }
        return at;
    }

    const TextLayout& Surface::textLayout(NodeId id)
    {
        layout();
        Node& node = get(id);
        if (node.nodeType != NodeType::Text && node.nodeType != NodeType::Input)
            throw std::invalid_argument("only text and input nodes have text");
        // Inputs are one line, however long.
        const float width =
            node.nodeType == NodeType::Input ? std::numeric_limits<float>::infinity() : node.contentBox().width;
        if (node.layoutWidth != width)
        {
            TextStyle style = node.nodeStyle.text;
            if (node.nodeType == NodeType::Input)
                style.numberOfLines = 1;
            // A tolerance, so text measured at its natural width still fits.
            node.textLayoutCache = options.textEngine->layout(node.textContent, style, width + 0.01f);
            node.layoutWidth = width;
        }
        return node.textLayoutCache;
    }

    std::size_t Surface::textOffsetAt(NodeId id, Point point)
    {
        const TextLayout& text = textLayout(id);
        const Node& node = get(id);
        if (text.lines.empty())
            return 0;
        const Rect content = node.contentBox();
        const float x = point.x - content.x + node.scroll.x;
        const float y = point.y - content.y;
        const auto line = std::find_if(text.lines.begin(), text.lines.end(),
                                       [&](const TextLine& candidate) { return y < candidate.top + candidate.height; });
        const TextLine& chosen = line == text.lines.end() ? text.lines.back() : *line;
        return offsetAt(*options.textEngine, node.textContent, chosen, node.nodeStyle.text, x);
    }

    NodeId Surface::hitTest(Point point)
    {
        layout();
        return hitTest(*rootNode, point, {});
    }

    NodeId Surface::hitTest(Node& node, Point point, Point origin)
    {
        const Style& style = node.nodeStyle;
        if (style.display == Display::None || style.pointerEvents == PointerEvents::None)
            return noNode;
        Rect box = node.frame();
        box.x += origin.x;
        box.y += origin.y;
        if (style.overflow != Overflow::Visible && ! box.contains(point))
            return noNode;
        if (style.pointerEvents != PointerEvents::BoxOnly)
        {
            // Later children paint over earlier ones.
            const Point children { box.x - node.scroll.x, box.y - node.scroll.y };
            for (Node* child : std::views::reverse(node.childNodes))
                if (const NodeId hit = hitTest(*child, point, children); hit != noNode)
                    return hit;
        }
        if (style.pointerEvents != PointerEvents::BoxNone && box.contains(point))
            return node.nodeId;
        return noNode;
    }

    bool Surface::takeChanges() noexcept
    {
        return std::exchange(changed, false);
    }

    bool Surface::animating() noexcept
    {
        const Node* node = find(focused());
        return node != nullptr && node->nodeType == NodeType::Input;
    }

    // ── Surface: input ───────────────────────────────────────────────────────

    void Surface::setEventSink(EventSink eventSink)
    {
        sink = std::move(eventSink);
    }

    bool Surface::dispatch(const Event& event)
    {
        return sink && sink(event);
    }

    std::vector<NodeId> Surface::pathTo(NodeId id)
    {
        std::vector<NodeId> path;
        if (! isConnected(id))
            return path;
        for (const Node* node = find(id); node != nullptr; node = node->parentNode)
            path.push_back(node->nodeId);
        std::reverse(path.begin(), path.end());
        return path;
    }

    Event Surface::pointerEvent(Event::Type type, NodeId target, const PointerInput& input)
    {
        Event event;
        event.type = type;
        event.target = target;
        event.position = input.position;
        if (isConnected(target))
        {
            const Rect box = bounds(target);
            event.offset = { input.position.x - box.x, input.position.y - box.y };
        }
        event.pointerId = input.pointerId;
        event.pointerType = input.type;
        event.button = input.button;
        event.buttons = input.buttons;
        event.pressure = input.pressure;
        event.modifiers = input.modifiers;
        return event;
    }

    void Surface::updateHover(PointerState& state, const PointerInput& input, NodeId target)
    {
        std::vector<NodeId> path = pathTo(target);
        std::erase_if(state.hovered, [this](NodeId id) { return ! isConnected(id); });
        std::size_t common = 0;
        while (common < path.size() && common < state.hovered.size() && path[common] == state.hovered[common])
            ++common;
        const std::vector<NodeId> left(state.hovered.begin() + static_cast<std::ptrdiff_t>(common),
                                       state.hovered.end());
        state.hovered = path;
        // Leave from the innermost node out, enter from the outermost in.
        for (const NodeId id : std::views::reverse(left))
        {
            Event event = pointerEvent(Event::Type::PointerLeave, id, input);
            event.related = target;
            dispatch(event);
        }
        for (std::size_t i = common; i < path.size(); ++i)
        {
            if (! isConnected(path[i]))
                break;
            Event event = pointerEvent(Event::Type::PointerEnter, path[i], input);
            event.related = left.empty() ? noNode : left.back();
            dispatch(event);
        }
    }

    bool Surface::pointer(const PointerInput& input)
    {
        layout();
        PointerState& state = pointers[input.pointerId];
        if (state.captured != noNode && ! isConnected(state.captured))
            state.captured = noNode;
        const NodeId hit = input.phase == PointerInput::Phase::Leave ? noNode : hitTest(input.position);

        switch (input.phase)
        {
            case PointerInput::Phase::Down:
            {
                if (state.captured == noNode)
                    updateHover(state, input, hit);
                const NodeId target = state.captured != noNode ? state.captured : hit;
                if (target == noNode)
                    return false;
                const bool prevented = dispatch(pointerEvent(Event::Type::PointerDown, target, input));
                if (state.captured == noNode && isConnected(target))
                    state.captured = target; // implicit capture until the last button is up
                if (! prevented)
                {
                    // Focus goes to the nearest focusable node, or nowhere.
                    NodeId focusTarget = noNode;
                    for (const Node* node = find(target); node != nullptr; node = node->parentNode)
                        if (node->canFocus)
                        {
                            focusTarget = node->nodeId;
                            break;
                        }
                    focus(isConnected(focusTarget) ? focusTarget : noNode);
                }
                return true;
            }
            case PointerInput::Phase::Move:
            {
                const NodeId target = state.captured != noNode ? state.captured : hit;
                if (state.captured == noNode)
                    updateHover(state, input, hit);
                if (target == noNode)
                    return false;
                dispatch(pointerEvent(Event::Type::PointerMove, target, input));
                return true;
            }
            case PointerInput::Phase::Up:
            {
                const NodeId pressed = state.captured;
                const NodeId target = pressed != noNode ? pressed : hit;
                if (target != noNode)
                    dispatch(pointerEvent(Event::Type::PointerUp, target, input));
                if (input.buttons == 0)
                {
                    state.captured = noNode;
                    // A click goes to the deepest node containing both where
                    // the press started and where it ended.
                    const NodeId released = hitTest(input.position);
                    if (input.button == 0 && pressed != noNode && released != noNode)
                    {
                        const auto from = pathTo(pressed);
                        const auto to = pathTo(released);
                        NodeId common = noNode;
                        for (std::size_t i = 0; i < from.size() && i < to.size() && from[i] == to[i]; ++i)
                            common = from[i];
                        if (common != noNode)
                            dispatch(pointerEvent(Event::Type::Click, common, input));
                    }
                    updateHover(state, input, hitTest(input.position));
                }
                return target != noNode;
            }
            case PointerInput::Phase::Leave:
                if (state.captured == noNode)
                    updateHover(state, input, noNode);
                return false;
            case PointerInput::Phase::Cancel:
            {
                const NodeId target = std::exchange(state.captured, noNode);
                if (target != noNode)
                    dispatch(pointerEvent(Event::Type::PointerCancel, target, input));
                updateHover(state, input, noNode);
                pointers.erase(input.pointerId);
                return target != noNode;
            }
        }
        return false;
    }

    bool Surface::wheel(const WheelInput& input)
    {
        const NodeId target = hitTest(input.position);
        if (target == noNode)
            return false;
        Event event;
        event.type = Event::Type::Wheel;
        event.target = target;
        event.position = input.position;
        const Rect box = bounds(target);
        event.offset = { input.position.x - box.x, input.position.y - box.y };
        event.deltaX = input.deltaX;
        event.deltaY = input.deltaY;
        event.deltaUnit = input.unit;
        event.modifiers = input.modifiers;
        if (dispatch(event))
            return true;
        // The default action: scroll the nearest scroll node that can.
        const float scale = input.unit == WheelInput::Unit::Line ? pixelsPerLine : 1;
        float deltaX = input.deltaX * scale;
        float deltaY = input.deltaY * scale;
        if ((input.modifiers & Modifier::Shift) != 0 && deltaX == 0)
            std::swap(deltaX, deltaY);
        return scrollBy(target, deltaX, deltaY);
    }

    bool Surface::scrollBy(NodeId target, float deltaX, float deltaY)
    {
        for (Node* node = find(target); node != nullptr; node = node->parentNode)
        {
            if (node->nodeType != NodeType::Scroll || node->nodeStyle.display == Display::None)
                continue;
            const Point before = node->scroll;
            scrollTo(node->nodeId, { before.x + deltaX, before.y + deltaY });
            if (node->scroll.x == before.x && node->scroll.y == before.y)
                continue;
            Event event;
            event.type = Event::Type::Scroll;
            event.target = node->nodeId;
            dispatch(event);
            return true;
        }
        return false;
    }

    bool Surface::key(const KeyInput& input)
    {
        Event event;
        event.type = input.down ? Event::Type::KeyDown : Event::Type::KeyUp;
        const NodeId target = focused();
        event.target = target != noNode ? target : rootNode->nodeId;
        event.key = input.key;
        event.repeat = input.repeat;
        event.modifiers = input.modifiers;
        if (dispatch(event))
            return true;
        constexpr Modifiers shortcut = Modifier::Control | Modifier::Alt | Modifier::Meta;
        if (input.down && input.key == "Tab" && (input.modifiers & shortcut) == 0)
            return moveFocus((input.modifiers & Modifier::Shift) != 0);
        return false;
    }

    bool Surface::text(const TextInput& input)
    {
        const NodeId target = focused();
        if (target == noNode || input.text.empty())
            return false;
        Event event;
        event.type = Event::Type::BeforeInput;
        event.target = target;
        event.text = input.text;
        dispatch(event);
        return true;
    }

    NodeId Surface::focused() noexcept
    {
        if (focusedNode != noNode && ! isConnected(focusedNode))
            focusedNode = noNode;
        return focusedNode;
    }

    void Surface::focus(NodeId id)
    {
        if (id != noNode)
        {
            const Node* node = find(id);
            if (node == nullptr || ! node->canFocus || ! isConnected(id))
                return;
        }
        const NodeId previous = focused();
        if (previous == id)
            return;
        focusedNode = id;
        if (previous != noNode)
        {
            Event blur;
            blur.type = Event::Type::Blur;
            blur.target = previous;
            blur.related = id;
            dispatch(blur);
        }
        if (id != noNode && focusedNode == id && isConnected(id))
        {
            Event focusEvent;
            focusEvent.type = Event::Type::Focus;
            focusEvent.target = id;
            focusEvent.related = previous;
            dispatch(focusEvent);
        }
    }

    void Surface::collectFocusable(Node& node, std::vector<NodeId>& out)
    {
        if (node.nodeStyle.display == Display::None)
            return;
        if (node.canFocus)
            out.push_back(node.nodeId);
        for (Node* child : node.childNodes)
            collectFocusable(*child, out);
    }

    bool Surface::moveFocus(bool backwards)
    {
        std::vector<NodeId> order;
        collectFocusable(*rootNode, order);
        if (order.empty())
            return false;
        const auto current = std::find(order.begin(), order.end(), focused());
        std::size_t next = 0;
        if (current == order.end())
            next = backwards ? order.size() - 1 : 0;
        else
        {
            const auto index = static_cast<std::size_t>(current - order.begin());
            next = backwards ? (index + order.size() - 1) % order.size() : (index + 1) % order.size();
        }
        focus(order[next]);
        return true;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
