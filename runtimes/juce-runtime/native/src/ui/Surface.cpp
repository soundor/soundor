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

        // ── Approximate text measurement ─────────────────────────────────────

        class ApproximateTextMeasurer final : public TextMeasurer
        {
        public:
            Size measure(std::string_view text, const TextStyle& style, float maxWidth) override
            {
                const float advance = style.fontSize * 0.55f + style.letterSpacing;
                const float lineHeight = style.lineHeight > 0 ? style.lineHeight : style.fontSize * 1.2f;
                const auto columns = std::isinf(maxWidth) || advance <= 0
                                         ? std::numeric_limits<std::size_t>::max()
                                         : std::max<std::size_t>(1, static_cast<std::size_t>(maxWidth / advance));

                std::size_t lines = 0;
                std::size_t widest = 0;
                std::size_t start = 0;
                for (;;)
                {
                    const std::size_t end = std::min(text.find('\n', start), text.size());
                    // Greedy word wrap of one paragraph, in code points.
                    std::size_t line = 0;
                    std::size_t word = 0;
                    std::size_t paragraphLines = 1;
                    for (std::size_t i = start; i <= end; ++i)
                    {
                        const bool boundary = i == end || text[i] == ' ';
                        if (! boundary)
                        {
                            if ((static_cast<unsigned char>(text[i]) & 0xC0) != 0x80)
                                ++word;
                            continue;
                        }
                        const std::size_t needed = line == 0 ? word : line + 1 + word;
                        if (needed <= columns || line == 0)
                            line = needed;
                        else
                        {
                            widest = std::max(widest, line);
                            ++paragraphLines;
                            line = word;
                        }
                        word = 0;
                    }
                    widest = std::max(widest, std::min(line, columns));
                    lines += paragraphLines;
                    if (end == text.size())
                        break;
                    start = end + 1;
                }
                if (style.numberOfLines > 0)
                    lines = std::min(lines, static_cast<std::size_t>(style.numberOfLines));
                return { static_cast<float>(widest) * advance, static_cast<float>(lines) * lineHeight };
            }
        };
    } // namespace

    std::shared_ptr<TextMeasurer> approximateTextMeasurer()
    {
        return std::make_shared<ApproximateTextMeasurer>();
    }

    // What Yoga's C callbacks need of a node.
    struct NodeAccess
    {
        static YGSize measureText(YGNodeConstRef yoga, float width, YGMeasureMode widthMode, float height,
                                  YGMeasureMode heightMode)
        {
            const auto* node = static_cast<const Node*>(YGNodeGetContext(yoga));
            const float maxWidth = widthMode == YGMeasureModeUndefined ? std::numeric_limits<float>::infinity() : width;
            Size size = node->surface.options.textMeasurer->measure(node->textContent, node->nodeStyle.text, maxWidth);
            if (widthMode == YGMeasureModeExactly)
                size.width = width;
            else if (widthMode == YGMeasureModeAtMost)
                size.width = std::min(size.width, width);
            if (heightMode == YGMeasureModeExactly)
                size.height = height;
            else if (heightMode == YGMeasureModeAtMost)
                size.height = std::min(size.height, height);
            return { size.width, size.height };
        }
    };

    // ── Node ─────────────────────────────────────────────────────────────────

    Node::Node(Surface& owner, NodeId id, NodeType type)
        : surface(owner), nodeId(id), nodeType(type), yoga(YGNodeNewWithConfig(owner.config.get()))
    {
        YGNodeSetContext(yoga, this);
        applyStyle(yoga, nodeStyle);
        if (type == NodeType::Text)
        {
            YGNodeSetNodeType(yoga, YGNodeTypeText);
            YGNodeSetMeasureFunc(yoga, &NodeAccess::measureText);
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

    // ── Surface: the tree ────────────────────────────────────────────────────

    Surface::Surface(Options provided) : options(std::move(provided)), config(YGConfigNew(), &YGConfigFree)
    {
        if (options.textMeasurer == nullptr)
            options.textMeasurer = approximateTextMeasurer();
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
        if (parent.nodeType == NodeType::Text)
            throw std::invalid_argument("a text node cannot have children");
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
        if (node.nodeType == NodeType::Text && textChanged)
            YGNodeMarkDirty(node.yoga);
        changed = true;
    }

    void Surface::setText(NodeId id, std::string text)
    {
        Node& node = get(id);
        if (node.nodeType != NodeType::Text)
            throw std::invalid_argument("only text nodes have text");
        if (node.textContent == text)
            return;
        node.textContent = std::move(text);
        YGNodeMarkDirty(node.yoga);
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
        if (YGNodeIsDirty(rootNode->yoga))
            YGNodeCalculateLayout(rootNode->yoga, viewSize.width, viewSize.height, YGDirectionLTR);
    }

    Rect Surface::bounds(NodeId id)
    {
        if (! isConnected(id))
            throw std::invalid_argument("the node is not in the tree");
        layout();
        const Node& node = get(id);
        Rect rect = node.frame();
        for (const Node* ancestor = node.parentNode; ancestor != nullptr; ancestor = ancestor->parentNode)
        {
            const Rect frame = ancestor->frame();
            rect.x += frame.x;
            rect.y += frame.y;
        }
        return rect;
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
            for (Node* child : std::views::reverse(node.childNodes))
                if (const NodeId hit = hitTest(*child, point, { box.x, box.y }); hit != noNode)
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
        return dispatch(event);
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
