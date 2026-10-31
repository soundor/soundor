#include <soundor/ui/Surface.h>

#include <yoga/Yoga.h>

#include <algorithm>
#include <chrono>
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

        // `size` within `min` and `max` where they share its unit. Yoga clamps
        // a box with a fixed size itself, but a container sized by its
        // content and stretched across its parent counted the size before the
        // clamp (height 90, maxHeight 40: a 90-tall parent around a 40-tall
        // child), where CSS counts the box as it is laid out.
        Length clamped(Length size, const Length& min, const Length& max)
        {
            if (size.unit != Length::Unit::Point && size.unit != Length::Unit::Percent)
                return size;
            if (max.unit == size.unit)
                size.value = std::min(size.value, max.value);
            if (min.unit == size.unit)
                size.value = std::max(size.value, min.value);
            return size;
        }

        // `style` without what only changes how a node looks or stacks: the
        // rest decides its layout (and its text's measurements). Anything not
        // named here counts as layout, so a new property is laid out until
        // it is known not to need it.
        Style layoutPart(Style style)
        {
            style.backgroundColor = {};
            style.borderColor = {};
            style.borderRadius = {};
            style.opacity = 1;
            style.transform = {};
            style.resizeMode = {};
            style.pointerEvents = {};
            style.cursor = {};
            style.zIndex = 0; // restacks siblings, see setStyle()
            style.text.color = {};
            return style;
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
                clamped(style.width, style.minWidth, style.maxWidth), [&](float v) { YGNodeStyleSetWidth(node, v); },
                [&](float v) { YGNodeStyleSetWidthPercent(node, v); }, [&] { YGNodeStyleSetWidthAuto(node); });
            setLength(
                clamped(style.height, style.minHeight, style.maxHeight),
                [&](float v) { YGNodeStyleSetHeight(node, v); }, [&](float v) { YGNodeStyleSetHeightPercent(node, v); },
                [&] { YGNodeStyleSetHeightAuto(node); });
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
            YGNodeStyleSetAspectRatio(node, style.aspectRatio.value_or(YGUndefined));
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

        static YGSize measureCanvas(YGNodeConstRef yoga, float width, YGMeasureMode widthMode, float height,
                                    YGMeasureMode heightMode)
        {
            const auto* node = static_cast<const Node*>(YGNodeGetContext(yoga));
            // Like an image: its pixels are its natural size in logical pixels.
            const render::RasterSurface& pixels = node->canvasBuffer->pixels;
            return measureNatural({ static_cast<float>(pixels.width()), static_cast<float>(pixels.height()) }, width,
                                  widthMode, height, heightMode);
        }

        static YGSize measureImage(YGNodeConstRef yoga, float width, YGMeasureMode widthMode, float height,
                                   YGMeasureMode heightMode)
        {
            const auto* node = static_cast<const Node*>(YGNodeGetContext(yoga));
            Size natural;
            if (node->surface.options.images != nullptr)
                natural = node->surface.options.images->imageSize(node->imageSource).value_or(Size {});
            return measureNatural(natural, width, widthMode, height, heightMode);
        }

        static YGSize measureNatural(Size natural, float width, YGMeasureMode widthMode, float height,
                                     YGMeasureMode heightMode)
        {
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
            case NodeType::Canvas:
                YGNodeSetMeasureFunc(yoga, &NodeAccess::measureCanvas);
                // An HTML canvas's default size.
                canvasBuffer = std::make_shared<CanvasBuffer>();
                canvasBuffer->pixels.resize(300, 150);
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

    Surface::Surface(Options provided)
        : timeline(*this), options(std::move(provided)), config(YGConfigNew(), &YGConfigFree)
    {
        if (options.textEngine == nullptr)
            options.textEngine = approximateTextEngine();
        if (options.clipboard == nullptr)
            options.clipboard = memoryClipboard();
        YGConfigSetPointScaleFactor(config.get(), pixelScale);
        rootNode = &get(createNode(NodeType::View));
        overlayNode = &get(createNode(NodeType::View));
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
        while (node != nullptr && node->parentNode != nullptr)
            node = node->parentNode;
        return node != nullptr && isRoot(*node);
    }

    NodeId Surface::createNode(NodeType type)
    {
        const NodeId id = nextId++;
        nodes.emplace(id, std::unique_ptr<Node>(new Node(*this, id, type)));
        if (type == NodeType::Canvas)
            canvasNodes.push_back(id);
        return id;
    }

    void Surface::detach(Node& child)
    {
        Node* parent = child.parentNode;
        if (parent == nullptr)
            return;
#if SOUNDOR_DEVTOOLS
        ++structureChanges;
#endif
        YGNodeRemoveChild(parent->yoga, child.yoga);
        std::erase(parent->childNodes, &child);
        child.parentNode = nullptr;
        restack(*parent);
        markChanged(child);
    }

    void Surface::restack(Node& parent)
    {
        parent.stacked.clear();
        const auto raised = [](const Node* child) { return child->nodeStyle.zIndex != 0; };
        if (std::ranges::none_of(parent.childNodes, raised))
            return;
        parent.stacked = parent.childNodes;
        std::ranges::stable_sort(parent.stacked, {}, [](const Node* child) { return child->nodeStyle.zIndex; });
    }

    void Surface::releaseNode(NodeId id)
    {
        Node& node = get(id);
        if (isRoot(node))
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
        if (node.nodeType == NodeType::Canvas)
            std::erase(canvasNodes, id);
        timeline.removeNode(id);
        nodes.erase(id);
    }

    void Surface::insertChild(NodeId parentId, NodeId childId, NodeId beforeId)
    {
        Node& parent = get(parentId);
        Node& child = get(childId);
        if (isRoot(child))
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
#if SOUNDOR_DEVTOOLS
        ++structureChanges;
#endif
        restack(parent);
        markChanged(child);
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
        ++counted.styleChanges;
        if (node.nodeStyle == style)
            return;
        const Style before = std::exchange(node.nodeStyle, style);
        if (node.presentationMask != 0)
        {
            const float opacity = node.visualStyle.opacity;
            const Presentation transform = node.visualStyle.transform;
            const Color background = node.visualStyle.backgroundColor;
            const Color border = node.visualStyle.borderColor;
            node.visualStyle = style;
            if ((node.presentationMask & propertyBit(AnimatedProperty::Opacity)) != 0)
                node.visualStyle.opacity = opacity;
            if ((node.presentationMask & transformPropertyMask) != 0)
                node.visualStyle.transform = transform;
            if ((node.presentationMask & propertyBit(AnimatedProperty::BackgroundColor)) != 0)
                node.visualStyle.backgroundColor = background;
            if ((node.presentationMask & propertyBit(AnimatedProperty::BorderColor)) != 0)
                node.visualStyle.borderColor = border;
        }
        // Only what decides sizes and positions goes to Yoga; a change that
        // only looks different (a color, opacity) is drawn, not laid out.
        const Style layoutBefore = layoutPart(before);
        const Style layoutAfter = layoutPart(style);
        if (layoutBefore != layoutAfter)
            applyStyle(node.yoga, style);
        if (before.zIndex != style.zIndex && node.parentNode != nullptr)
            restack(*node.parentNode);
        if (layoutBefore.text != layoutAfter.text
            && (node.nodeType == NodeType::Text || node.nodeType == NodeType::Input))
        {
            YGNodeMarkDirty(node.yoga);
            node.layoutWidth = -1;
        }
        // The cursor is neither drawn nor laid out: the backend reads it.
        Style drawn = before;
        drawn.cursor = style.cursor;
        if (drawn != style)
            markChanged(node);
    }

    void Surface::setText(NodeId id, std::string text)
    {
        Node& node = get(id);
        if (node.nodeType != NodeType::Text && node.nodeType != NodeType::Input)
            throw std::invalid_argument("only text and input nodes have text");
        if (node.textContent == text)
            return;
#if SOUNDOR_DEVTOOLS
        debugMetadataChanged(node);
#endif
        node.textContent = std::move(text);
        node.layoutWidth = -1;
        YGNodeMarkDirty(node.yoga);
        if (node.nodeType == NodeType::Input)
            setSelection(id, node.textSelection);
        markChanged(node);
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
        markChanged(node);
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
        markChanged(node);
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
            markChanged(node);
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
            markChanged(node);
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
        markChanged(node);
    }

    void Surface::setCanvasSize(NodeId id, int width, int height)
    {
        Node& node = get(id);
        if (node.nodeType != NodeType::Canvas)
            throw std::invalid_argument("only canvas nodes have a drawing buffer");
        constexpr long long maxSide = 16384;
        constexpr long long maxPixels = 1LL << 28;
        if (width < 0 || height < 0 || width > maxSide || height > maxSide
            || static_cast<long long>(width) * height > maxPixels)
            throw std::invalid_argument("a canvas of " + std::to_string(width) + "x" + std::to_string(height)
                                        + " is too large (at most 16384 on a side and 268435456 pixels)");
        CanvasBuffer& buffer = *node.canvasBuffer;
        if (! buffer.pixels.resize(width, height))
        {
            // The same size: cleared all the same.
            const render::Bitmap bitmap = buffer.pixels.bitmap();
            if (! bitmap.empty())
                std::fill_n(static_cast<std::uint32_t*>(bitmap.pixels),
                            static_cast<std::size_t>(width) * static_cast<std::size_t>(height), 0U);
        }
        else
            YGNodeMarkDirty(node.yoga);
        ++buffer.resets;
        buffer.drawn = false;
        markChanged(node);
    }

    std::shared_ptr<CanvasBuffer> Surface::canvasBuffer(NodeId id)
    {
        Node& node = get(id);
        if (node.nodeType != NodeType::Canvas)
            throw std::invalid_argument("only canvas nodes have a drawing buffer");
        return node.canvasBuffer;
    }

    void Surface::collectCanvasDrawing()
    {
        for (const NodeId id : canvasNodes)
            if (Node* node = find(id); node != nullptr)
            {
                if (node->canvasBuffer->drawn)
                {
                    node->canvasBuffer->drawn = false;
                    invalidate(id);
                }
                // A new GPU image changes the picture, not the nodes drawn
                // on the CPU: the view renderer takes it (gpuDrawn).
                if (node->canvasBuffer->gpuDrawn)
                    changed = true;
            }
    }

    void Surface::imagesChanged()
    {
        for (auto& [id, node] : nodes)
            if (node->nodeType == NodeType::Image)
            {
                YGNodeMarkDirty(node->yoga);
                markChanged(*node);
            }
    }

    std::optional<std::string> Surface::addFont(std::string_view family, std::string_view source, int weight,
                                                FontStyle style)
    {
        std::optional<std::string> error = options.textEngine->addFont(family, source, weight, style);
        if (error)
            return error;
        for (auto& [id, node] : nodes)
            if (node->nodeType == NodeType::Text || node->nodeType == NodeType::Input)
            {
                node->layoutWidth = -1;
                YGNodeMarkDirty(node->yoga);
                markChanged(*node);
            }
        return std::nullopt;
    }

    void Surface::setFocusable(NodeId id, bool focusable)
    {
        Node& node = get(id);
        if (node.canFocus == focusable)
            return;
        node.canFocus = focusable;
        // Nothing to draw, but what assistive technology may do changed.
        ++changes;
    }

    void Surface::setDebugId(NodeId id, std::string debugId)
    {
        Node& node = get(id);
        if (node.debugName == debugId)
            return;
#if SOUNDOR_DEVTOOLS
        debugMetadataChanged(node);
#endif
        node.debugName = std::move(debugId);
        // Nothing to draw, but what developer tools find changed.
        ++changes;
    }

    void Surface::setAccessibility(NodeId id, a11y::Properties properties)
    {
        Node& node = get(id);
        if (node.semantics == properties)
            return;
#if SOUNDOR_DEVTOOLS
        if (node.semantics.label != properties.label || node.semantics.role != properties.role
            || node.semantics.accessible != properties.accessible)
            debugMetadataChanged(node);
        if (node.semantics.modal != properties.modal && metadataSubscribed)
            metadataOverflow = true;
#endif
        node.semantics = std::move(properties);
        ++changes;
    }

    void Surface::setAccessibilityParent(NodeId id, NodeId parent)
    {
        Node& node = get(id);
        if (parent == id)
            throw std::invalid_argument("a node cannot be its own accessibility parent");
        if (parent != noNode && find(parent) == nullptr)
            throw std::invalid_argument("unknown node " + std::to_string(parent));
        if (node.semanticParent == parent)
            return;
        node.semanticParent = parent;
        ++changes;
    }

    // ── Surface: layout ──────────────────────────────────────────────────────

    void Surface::setSize(Size size)
    {
        if (size.width == viewSize.width && size.height == viewSize.height)
            return;
        viewSize = size;
        markChanged();
        invalidAll = true;
    }

    void Surface::setScale(float scale)
    {
        if (scale <= 0 || scale == pixelScale)
            return;
        pixelScale = scale;
        YGConfigSetPointScaleFactor(config.get(), scale);
        // Snapping changed everywhere: lay the whole trees out again.
        YGNodeStyleSetWidth(rootNode->yoga, YGUndefined);
        YGNodeStyleSetWidth(overlayNode->yoga, YGUndefined);
        markChanged();
        invalidAll = true;
    }

    void Surface::layout()
    {
        // The roots fill the view whatever their style says, each laid out
        // on its own: the overlay is not in the content's flow.
        bool laidOut = false;
        for (Node* tree : { rootNode, overlayNode })
        {
            YGNodeStyleSetWidth(tree->yoga, viewSize.width);
            YGNodeStyleSetHeight(tree->yoga, viewSize.height);
            if (! YGNodeIsDirty(tree->yoga))
                continue;
            const auto started = std::chrono::steady_clock::now();
            YGNodeCalculateLayout(tree->yoga, viewSize.width, viewSize.height, YGDirectionLTR);
            ++counted.layoutPasses;
            counted.layoutNanoseconds += static_cast<std::uint64_t>(
                std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - started)
                    .count());
            laidOut = true;
        }
        if (! laidOut)
            return;
        // An input's width may have changed: keep its caret in view.
        for (auto& [id, node] : nodes)
            if (node->nodeType == NodeType::Input)
                keepCaretVisible(*node);
    }

    Presentation Surface::presentation(NodeId id)
    {
        const Node& node = get(id);
        const Style& style = node.presentedStyle();
        Presentation result = style.transform;
        result[AnimatedProperty::Opacity] = style.opacity;
        const auto channels = [](Color color)
        {
            return std::array<float, 4> { static_cast<float>(color.r) / 255.0f, static_cast<float>(color.g) / 255.0f,
                                          static_cast<float>(color.b) / 255.0f, static_cast<float>(color.a) / 255.0f };
        };
        result.colors[0] = channels(style.backgroundColor);
        result.colors[1] = channels(style.borderColor);
        return result;
    }

    void Surface::setPresentation(NodeId id, const Presentation& value, PropertyMask properties)
    {
        Node& node = get(id);
        const Presentation before = presentation(id);
        if (node.presentationMask == 0)
            node.visualStyle = node.nodeStyle;
        if ((properties & propertyBit(AnimatedProperty::Opacity)) != 0)
            node.visualStyle.opacity = std::clamp(value[AnimatedProperty::Opacity], 0.0f, 1.0f);
        if ((properties & transformPropertyMask) != 0)
        {
            node.visualStyle.transform.order = value.order;
            node.visualStyle.transform.count = value.count;
            for (std::size_t i = 1; i < animatedPropertyCount; ++i)
                if ((properties & (PropertyMask { 1 } << i)) != 0)
                    node.visualStyle.transform.values[i] = value.values[i];
        }
        const auto color = [](const std::array<float, 4>& channels)
        {
            const auto byte = [](float channel)
            { return static_cast<std::uint8_t>(std::round(std::clamp(channel, 0.0f, 1.0f) * 255)); };
            return Color { byte(channels[0]), byte(channels[1]), byte(channels[2]), byte(channels[3]) };
        };
        if ((properties & propertyBit(AnimatedProperty::BackgroundColor)) != 0)
            node.visualStyle.backgroundColor = color(value.colors[0]);
        if ((properties & propertyBit(AnimatedProperty::BorderColor)) != 0)
            node.visualStyle.borderColor = color(value.colors[1]);
        const bool isolated = node.presentationMask == 0;
        node.presentationMask |= properties;
        const Presentation after = presentation(id);
        const bool paintChanged = before.colors != after.colors && (properties & paintPropertyMask) != 0;
        if (isolated || paintChanged)
            markChanged(node); // establish cached content once
        else if (before != after)
            markChanged(); // placement only
    }

    void Surface::clearPresentation(NodeId id, PropertyMask properties)
    {
        Node& node = get(id);
        if ((node.presentationMask & properties) == 0)
            return;
        node.presentationMask &= ~properties;
        if ((properties & propertyBit(AnimatedProperty::Opacity)) != 0)
            node.visualStyle.opacity = node.nodeStyle.opacity;
        if ((properties & transformPropertyMask) != 0)
            node.visualStyle.transform = node.nodeStyle.transform;
        if ((properties & propertyBit(AnimatedProperty::BackgroundColor)) != 0)
            node.visualStyle.backgroundColor = node.nodeStyle.backgroundColor;
        if ((properties & propertyBit(AnimatedProperty::BorderColor)) != 0)
            node.visualStyle.borderColor = node.nodeStyle.borderColor;
        markChanged(node);
    }

    render::Transform Surface::visualTransform(NodeId id)
    {
        layout();
        const Node& node = get(id);
        const Rect frame = node.frame();
        render::Transform parent;
        if (node.parentNode != nullptr)
        {
            parent = visualTransform(node.parentNode->id());
            parent = parent * render::Transform::translate(-node.parentNode->scroll.x, -node.parentNode->scroll.y);
        }
        return parent * render::Transform::translate(frame.x, frame.y)
               * node.presentedStyle().transform.transform(frame.width, frame.height);
    }

    Point Surface::localPoint(NodeId id, Point point)
    {
        const auto inverse = visualTransform(id).inverse();
        if (! inverse)
            return { std::numeric_limits<float>::infinity(), std::numeric_limits<float>::infinity() };
        const auto at = inverse->map(point.x, point.y);
        return { at[0], at[1] };
    }

    Rect Surface::bounds(NodeId id)
    {
        if (! isConnected(id))
            throw std::invalid_argument("the node is not in the tree");
        layout();
        const Node& node = get(id);
        const Rect frame = node.frame();
        Point at { frame.x, frame.y };
        bool transformed = false;
        for (const Node* ancestor = &node; ancestor != nullptr; ancestor = ancestor->parentNode)
        {
            if (ancestor->presentedStyle().transform.count != 0)
            {
                transformed = true;
                break;
            }
            if (ancestor != &node)
            {
                const Rect inherited = ancestor->frame();
                at.x += inherited.x - ancestor->scroll.x;
                at.y += inherited.y - ancestor->scroll.y;
            }
        }
        if (! transformed)
            return { at.x, at.y, frame.width, frame.height };
        const render::Transform matrix = visualTransform(id);
        const std::array corners { matrix.map(0, 0), matrix.map(frame.width, 0), matrix.map(0, frame.height),
                                   matrix.map(frame.width, frame.height) };
        float left = corners[0][0], right = left, top = corners[0][1], bottom = top;
        for (const auto& corner : corners)
        {
            left = std::min(left, corner[0]);
            right = std::max(right, corner[0]);
            top = std::min(top, corner[1]);
            bottom = std::max(bottom, corner[1]);
        }
        return { left, top, right - left, bottom - top };
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
        // The overlay first; where it has nothing, the content.
        if (const NodeId hit = hitTest(*overlayNode, point, {}); hit != noNode && hit != overlayNode->nodeId)
            return hit;
        return hitTest(*rootNode, point, {});
    }

    NodeId Surface::hitTest(Node& node, Point point, Point origin)
    {
        const Style& style = node.nodeStyle;
        if (style.display == Display::None || style.pointerEvents == PointerEvents::None)
            return noNode;
        const Rect frame = node.frame();
        const auto inverse = node.presentedStyle().transform.transform(frame.width, frame.height).inverse();
        if (! inverse)
            return noNode;
        const auto at = inverse->map(point.x - origin.x - frame.x, point.y - origin.y - frame.y);
        point = { at[0], at[1] };
        const Rect box { 0, 0, frame.width, frame.height };
        if ((style.overflow != Overflow::Visible || node.nodeType == NodeType::Scroll) && ! box.contains(point))
            return noNode;
        bool childrenVisible = true;
        if (style.overflow != Overflow::Visible || node.nodeType == NodeType::Scroll)
        {
            const auto& border = style.borderWidth;
            const Rect inner { border.left, border.top, frame.width - border.left - border.right,
                               frame.height - border.top - border.bottom };
            childrenVisible = inner.contains(point);
            if (childrenVisible)
            {
                const bool left = point.x < inner.x + inner.width / 2;
                const bool top = point.y < inner.y + inner.height / 2;
                const auto& radii = style.borderRadius;
                const float outer =
                    left ? (top ? radii.topLeft : radii.bottomLeft) : (top ? radii.topRight : radii.bottomRight);
                const float inset = std::max(left ? border.left : border.right, top ? border.top : border.bottom);
                const float radius = std::min(std::max(0.f, outer - inset), std::min(inner.width, inner.height) / 2);
                const float cx = left ? inner.x + radius : inner.x + inner.width - radius;
                const float cy = top ? inner.y + radius : inner.y + inner.height - radius;
                if ((left ? point.x < cx : point.x > cx) && (top ? point.y < cy : point.y > cy))
                    childrenVisible = std::hypot(point.x - cx, point.y - cy) <= radius;
            }
        }
        if (childrenVisible && style.pointerEvents != PointerEvents::BoxOnly)
        {
            const Point children { -node.scroll.x, -node.scroll.y };
            for (Node* child : std::views::reverse(node.stackedChildren()))
                if (const NodeId hit = hitTest(*child, point, children); hit != noNode)
                    return hit;
        }
        if (style.pointerEvents != PointerEvents::BoxNone && box.contains(point))
            return node.nodeId;
        return noNode;
    }

    bool Surface::takeChanges() noexcept
    {
        collectCanvasDrawing();
        return std::exchange(changed, false);
    }

    void Surface::markChanged(const Node& node)
    {
        markChanged();
        invalidate(node.nodeId);
    }

    void Surface::invalidate(NodeId id)
    {
        if (id == noNode)
            return;
        ++counted.invalidations;
        changed = true;
        if (invalidAll)
            return;
        // Past this many, drawing everything is about as cheap.
        constexpr std::size_t limit = 4096;
        if (invalidNodes.size() >= limit)
        {
            invalidNodes.clear();
            invalidAll = true;
            return;
        }
        invalidNodes.push_back(id);
    }

    Surface::Invalidation Surface::takeInvalidation()
    {
        collectCanvasDrawing();
        Invalidation taken;
        taken.everything = std::exchange(invalidAll, false);
        if (! taken.everything)
        {
            std::ranges::sort(invalidNodes);
            const auto [first, last] = std::ranges::unique(invalidNodes);
            invalidNodes.erase(first, last);
            taken.nodes = std::move(invalidNodes);
        }
        invalidNodes.clear();
        return taken;
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
            event.offset = localPoint(target, input.position);
        }
        event.movement = routedMovement;
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

#if SOUNDOR_DEVTOOLS
    void Surface::debugMetadataChanged(const Node& node)
    {
        if (! metadataSubscribed || metadataOverflow)
            return;
        for (const Node* current = &node; current; current = current->parent())
        {
            if (! metadataDirty.contains(current->id()) && metadataDirty.size() >= 128)
            {
                metadataOverflow = true;
                return;
            }
            metadataDirty.insert(current->id());
        }
        if (node.accessibilityParent() != noNode)
        {
            if (! metadataDirty.contains(node.accessibilityParent()) && metadataDirty.size() >= 128)
                metadataOverflow = true;
            else
                metadataDirty.insert(node.accessibilityParent());
        }
    }
    void Surface::debugMetadataSubscription(bool enabled) noexcept
    {
        if (metadataSubscribed == enabled)
            return;
        metadataSubscribed = enabled;
        metadataDirty.clear();
        metadataOverflow = false;
    }
    std::vector<NodeId> Surface::takeDebugMetadataChanges(bool& overflow)
    {
        std::vector<NodeId> ids(metadataDirty.begin(), metadataDirty.end());
        metadataDirty.clear();
        overflow = std::exchange(metadataOverflow, false);
        return ids;
    }
    void Surface::debugHighlights(std::vector<NodeId> ids)
    {
        if (highlighted != ids)
        {
            highlighted = std::move(ids);
            highlightChanged = true;
        }
    }
    bool Surface::takeDebugChanges() noexcept
    {
        return std::exchange(highlightChanged, false);
    }
    std::vector<int> Surface::cancelPointers()
    {
        std::vector<int> ids;
        std::vector<int> captured;
        for (const auto& [id, state] : pointers)
        {
            ids.push_back(id);
            if (state.captured != noNode)
                captured.push_back(id);
        }
        for (const int id : ids)
            pointer({ .phase = PointerInput::Phase::Cancel, .pointerId = id });
        return captured;
    }
#endif

    Cursor Surface::cursor(int pointerId)
    {
        const auto state = pointers.find(pointerId);
        if (state == pointers.end())
            return Cursor::Default;
        NodeId at = isConnected(state->second.captured) ? state->second.captured : noNode;
        for (auto hovered = state->second.hovered.rbegin(); at == noNode && hovered != state->second.hovered.rend();
             ++hovered)
            if (isConnected(*hovered))
                at = *hovered;
        for (const Node* node = find(at); node != nullptr; node = node->parentNode)
        {
            if (node->nodeStyle.cursor != Cursor::Auto)
                return node->nodeStyle.cursor;
            if (node->nodeType == NodeType::Input)
                return Cursor::Text;
        }
        return Cursor::Default;
    }

    void Surface::refreshHover()
    {
        if (hoverRevision == changes)
            return;
        // What the listeners change is seen the next time.
        hoverRevision = changes;
        std::vector<int> ids;
        for (const auto& [id, state] : pointers)
            if (state.inside && state.captured == noNode && state.last.type != PointerType::Touch)
                ids.push_back(id);
        for (const int id : ids)
        {
            const auto found = pointers.find(id);
            if (found == pointers.end())
                continue;
            PointerState& state = found->second;
            const NodeId hit = hitTest(state.last.position);
            std::vector<NodeId> hovered = state.hovered;
            std::erase_if(hovered, [this](NodeId node) { return ! isConnected(node); });
            if (hovered == pathTo(hit))
                continue;
            PointerInput input = state.last;
            input.phase = PointerInput::Phase::Move;
            input.button = -1;
            updateHover(state, input, hit);
        }
    }

    bool Surface::requestPointerLock(NodeId id)
    {
        if (! isConnected(id))
            return false;
        for (auto& [pointerId, state] : pointers)
        {
            if (state.captured == noNode || state.last.type == PointerType::Touch)
                continue;
            for (const Node* node = find(state.captured); node != nullptr; node = node->parentNode)
                if (node->nodeId == id)
                {
                    // Its events go to the locking node from now on.
                    state.captured = id;
                    lockPosition = state.last.position;
                    lock = PointerLock { .node = id, .pointerId = pointerId, .position = lockPosition };
                    return true;
                }
        }
        return false;
    }

    std::optional<Surface::PointerLock> Surface::pointerLock()
    {
        if (lock)
        {
            const auto state = pointers.find(lock->pointerId);
            if (! isConnected(lock->node) || state == pointers.end() || state->second.captured != lock->node)
                endLock();
        }
        return lock;
    }

    void Surface::exitPointerLock() noexcept
    {
        endLock();
    }

    void Surface::endLock() noexcept
    {
        if (! lock)
            return;
        if (const auto state = pointers.find(lock->pointerId); state != pointers.end())
            state->second.last.position = lockPosition;
        lock.reset();
    }

    bool Surface::pointer(const PointerInput& input)
    {
        layout();
        const auto known = pointers.find(input.pointerId);
        routedMovement = known == pointers.end() ? Point {}
                                                 : Point { input.position.x - known->second.last.position.x,
                                                           input.position.y - known->second.last.position.y };
        PointerState& state = pointers[input.pointerId];
        state.last = input;
        // A locked pointer stays where its lock began; only movement changes.
        PointerInput routed = input;
        if (lock && lock->pointerId == input.pointerId)
            routed.position = lockPosition;
        const bool handled = route(state, routed);
        routedMovement = {};
        (void)pointerLock(); // ended by a release, a cancel, or the node going
        return handled;
    }

    bool Surface::route(PointerState& state, const PointerInput& input)
    {
        if (state.captured != noNode && ! isConnected(state.captured))
            state.captured = noNode;
        state.inside = input.phase != PointerInput::Phase::Leave && input.phase != PointerInput::Phase::Cancel;
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
                // Implicit capture until the last button is up, from before the
                // listeners run, so they can lock it (a node they remove lets go).
                if (state.captured == noNode)
                    state.captured = target;
                const bool prevented = dispatch(pointerEvent(Event::Type::PointerDown, target, input));
                if (! isConnected(state.captured))
                    state.captured = noNode;
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
                // The secondary button asks for a context menu, as on the Web.
                if (input.button == 2 && isConnected(target))
                    dispatch(pointerEvent(Event::Type::ContextMenu, target, input));
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
        event.offset = localPoint(target, input.position);
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

    bool Surface::key(const KeyInput& input, const std::string& typed)
    {
        const bool handled = key(input);
        if (handled || ! input.down || typed.empty())
            return handled;
        return text({ typed });
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

    bool Surface::accessibilityAction(NodeId target, std::string action,
                                      std::variant<std::monostate, double, std::string> value)
    {
        if (! isConnected(target))
            return false;
        Event event;
        event.type = Event::Type::AccessibilityAction;
        event.target = target;
        event.action = std::move(action);
        event.value = std::move(value);
        return dispatch(event);
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
        // An input shows its caret and selection only while focused.
        invalidate(previous);
        invalidate(id);
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
        collectFocusable(*overlayNode, order);
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
