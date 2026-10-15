#include <soundor/ui/Surface.h>

#include <doctest/doctest.h>

#include <algorithm>
#include <optional>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

using namespace soundor::ui;

namespace
{
    Style sized(float width, float height)
    {
        Style style;
        style.width = Length::points(width);
        style.height = Length::points(height);
        return style;
    }

    // Records every routed event as "<type>@<target>".
    struct Recorder
    {
        explicit Recorder(Surface& surface)
        {
            surface.setEventSink(
                [this](const Event& event)
                {
                    static constexpr const char* names[] = { "down",  "move",  "up",    "cancel",  "enter",
                                                             "leave", "click", "wheel", "keydown", "keyup",
                                                             "input", "focus", "blur",  "scroll",  "contextmenu" };
                    events.push_back(std::string(names[static_cast<int>(event.type)]) + "@"
                                     + std::to_string(event.target));
                    last = event;
                    return prevent == event.type;
                });
        }

        std::vector<std::string> take() { return std::exchange(events, {}); }

        std::vector<std::string> events;
        Event last;
        std::optional<Event::Type> prevent;
    };

    PointerInput pointer(PointerInput::Phase phase, float x, float y, unsigned buttons = 0, int button = -1)
    {
        PointerInput input;
        input.phase = phase;
        input.position = { x, y };
        input.buttons = buttons;
        input.button = button;
        return input;
    }

    PointerInput down(float x, float y)
    {
        return pointer(PointerInput::Phase::Down, x, y, 1, 0);
    }
    PointerInput move(float x, float y, unsigned buttons = 0)
    {
        return pointer(PointerInput::Phase::Move, x, y, buttons);
    }
    PointerInput up(float x, float y)
    {
        return pointer(PointerInput::Phase::Up, x, y, 0, 0);
    }

    KeyInput key(std::string name, Modifiers modifiers = 0)
    {
        return KeyInput { .down = true, .key = std::move(name), .repeat = false, .modifiers = modifiers };
    }

    // root (200×100, row) → a (100×100), b (100×100) with b → inner (50×50).
    struct Row
    {
        Row()
        {
            surface.setSize({ 200, 100 });
            Style row;
            row.flexDirection = FlexDirection::Row;
            surface.setStyle(root, row);
            surface.setStyle(a, sized(100, 100));
            surface.setStyle(b, sized(100, 100));
            surface.setStyle(inner, sized(50, 50));
            surface.insertChild(root, a);
            surface.insertChild(root, b);
            surface.insertChild(b, inner);
        }

        Surface surface;
        NodeId root = surface.root().id();
        NodeId a = surface.createNode(NodeType::View);
        NodeId b = surface.createNode(NodeType::View);
        NodeId inner = surface.createNode(NodeType::View);
    };

    std::string at(NodeId id, const char* type)
    {
        return std::string(type) + "@" + std::to_string(id);
    }
} // namespace

TEST_SUITE("ui::Surface layout")
{
    TEST_CASE("lays out flexbox and reports frames and absolute bounds")
    {
        Row f;
        f.surface.layout();
        CHECK(f.surface.find(f.b)->frame().x == 100);
        const Rect inner = f.surface.bounds(f.inner);
        CHECK(inner.x == 100);
        CHECK(inner.y == 0);
        CHECK(inner.width == 50);

        Style centered = sized(100, 100);
        centered.justifyContent = Justify::Center;
        centered.alignItems = Align::Center;
        f.surface.setStyle(f.b, centered);
        CHECK(f.surface.bounds(f.inner).x == 125);
        CHECK(f.surface.bounds(f.inner).y == 25);
    }

    TEST_CASE("an unchanged style does nothing; one that only looks different is drawn, not laid out")
    {
        Row f;
        f.surface.layout();
        (void)f.surface.takeChanges();
        const SurfaceStatistics before = f.surface.statistics();

        f.surface.setStyle(f.a, sized(100, 100)); // what it has
        CHECK_FALSE(f.surface.takeChanges());
        CHECK(f.surface.statistics().invalidations == before.invalidations);

        Style faded = sized(100, 100);
        faded.opacity = 0.5;
        faded.backgroundColor = Color { 255, 0, 0, 255 };
        faded.borderRadius = Corners { 4, 4, 4, 4 };
        f.surface.setStyle(f.a, faded);
        CHECK(f.surface.takeChanges());
        CHECK(f.surface.statistics().invalidations > before.invalidations);
        f.surface.layout();
        CHECK(f.surface.statistics().layoutPasses == before.layoutPasses);

        f.surface.setStyle(f.a, sized(120, 100));
        f.surface.layout();
        CHECK(f.surface.statistics().layoutPasses == before.layoutPasses + 1);
        CHECK(f.surface.find(f.b)->frame().x == 120);
    }

    TEST_CASE("text is measured again when its font changes, not its color")
    {
        Surface surface;
        surface.setSize({ 300, 100 });
        const NodeId text = surface.createNode(NodeType::Text);
        surface.setText(text, "Hello");
        surface.insertChild(surface.root().id(), text);
        surface.layout();
        const auto passes = surface.statistics().layoutPasses;
        const float height = surface.bounds(text).height;

        Style colored;
        colored.text.color = Color { 255, 0, 0, 255 };
        surface.setStyle(text, colored);
        surface.layout();
        CHECK(surface.statistics().layoutPasses == passes);

        Style larger = colored;
        larger.text.fontSize = 28;
        surface.setStyle(text, larger);
        surface.layout();
        CHECK(surface.statistics().layoutPasses == passes + 1);
        CHECK(surface.bounds(text).height > height);
    }

    TEST_CASE("the root fills the view and follows its size")
    {
        Surface surface;
        const NodeId child = surface.createNode(NodeType::View);
        Style grow;
        grow.flexGrow = 1;
        surface.setStyle(child, grow);
        surface.insertChild(surface.root().id(), child);
        surface.setSize({ 300, 120 });
        CHECK(surface.bounds(child).height == 120);
        surface.setSize({ 300, 80 });
        CHECK(surface.bounds(child).height == 80);
        CHECK(surface.bounds(child).width == 300);
    }

    TEST_CASE("percentages, padding, margins, gaps and absolute positioning")
    {
        Surface surface;
        surface.setSize({ 200, 200 });
        Style rootStyle;
        rootStyle.padding = { Length::points(10), Length::points(10), Length::points(10), Length::points(10) };
        rootStyle.rowGap = 5;
        surface.setStyle(surface.root().id(), rootStyle);

        const NodeId half = surface.createNode(NodeType::View);
        Style halfStyle;
        halfStyle.width = Length::percent(50);
        halfStyle.height = Length::points(20);
        surface.setStyle(half, halfStyle);
        const NodeId next = surface.createNode(NodeType::View);
        surface.setStyle(next, sized(10, 10));
        const NodeId overlay = surface.createNode(NodeType::View);
        Style overlayStyle = sized(30, 30);
        overlayStyle.position = Position::Absolute;
        overlayStyle.inset.right = Length::points(0);
        overlayStyle.inset.bottom = Length::points(0);
        surface.setStyle(overlay, overlayStyle);
        for (const NodeId id : { half, next, overlay })
            surface.insertChild(surface.root().id(), id);

        CHECK(surface.bounds(half).x == 10);
        CHECK(surface.bounds(half).width == 90); // 50% of the 180 content width
        CHECK(surface.bounds(next).y == 35);     // 10 + 20 + gap 5
        CHECK(surface.bounds(overlay).x == 170);
        CHECK(surface.bounds(overlay).y == 170);
    }

    TEST_CASE("display none takes a node out of layout")
    {
        Row f;
        Style hidden = sized(100, 100);
        hidden.display = Display::None;
        f.surface.setStyle(f.a, hidden);
        CHECK(f.surface.bounds(f.b).x == 0);
    }

    TEST_CASE("text nodes are measured, wrap, and remeasure when their text changes")
    {
        Surface surface;
        surface.setSize({ 1000, 1000 });
        const NodeId column = surface.createNode(NodeType::View);
        Style columnStyle;
        columnStyle.alignItems = Align::FlexStart;
        columnStyle.width = Length::points(100);
        surface.setStyle(column, columnStyle);
        surface.insertChild(surface.root().id(), column);
        const NodeId text = surface.createNode(NodeType::Text);
        Style textStyle;
        textStyle.text.fontSize = 20; // 11 per character, 24 per line
        surface.setStyle(text, textStyle);
        surface.setText(text, "hello");
        surface.insertChild(column, text);

        CHECK(surface.bounds(text).width == 55);
        CHECK(surface.bounds(text).height == 24);

        surface.setText(text, "the quick brown fox jumps over the lazy dog");
        CHECK(surface.bounds(text).width <= 100);
        CHECK(surface.bounds(text).height == 120); // five lines of at most 9 characters

        textStyle.text.numberOfLines = 2;
        surface.setStyle(text, textStyle);
        CHECK(surface.bounds(text).height == 48);
    }

    TEST_CASE("the approximate engine counts code points and honours line breaks")
    {
        auto engine = approximateTextEngine();
        TextStyle style;
        style.fontSize = 10;
        CHECK(engine->advance("ééé", style) == doctest::Approx(16.5));
        const TextLayout twoLines = engine->layout("ab\nabcd", style, 1e9f);
        CHECK(twoLines.size.width == doctest::Approx(22));
        CHECK(twoLines.size.height == doctest::Approx(24));
        REQUIRE(twoLines.lines.size() == 2);
        CHECK(twoLines.lines[1].begin == 3);
        CHECK(twoLines.lines[1].end == 7);
        CHECK(twoLines.lines[1].top == doctest::Approx(12));
    }

    TEST_CASE("wrapping keeps break spaces out of lines and maps points to offsets")
    {
        auto engine = approximateTextEngine();
        TextStyle style;
        style.fontSize = 20; // 11 per character
        const std::string text = "one two  three";
        const TextLayout layout = engine->layout(text, style, 80);
        REQUIRE(layout.lines.size() == 2);
        CHECK(text.substr(layout.lines[0].begin, layout.lines[0].end - layout.lines[0].begin) == "one two");
        CHECK(text.substr(layout.lines[1].begin, layout.lines[1].end - layout.lines[1].begin) == "three");
        CHECK(offsetAt(*engine, text, layout.lines[0], style, 0) == 0);
        CHECK(offsetAt(*engine, text, layout.lines[0], style, 17) == 2); // nearer the boundary after "on"
        CHECK(offsetAt(*engine, text, layout.lines[1], style, 1000) == text.size());
    }
}

TEST_SUITE("ui::Surface tree")
{
    TEST_CASE("inserting before, moving and removing children")
    {
        Surface surface;
        const NodeId root = surface.root().id();
        const NodeId a = surface.createNode(NodeType::View);
        const NodeId b = surface.createNode(NodeType::View);
        const NodeId c = surface.createNode(NodeType::View);
        surface.insertChild(root, a);
        surface.insertChild(root, c);
        surface.insertChild(root, b, c);
        const auto ids = [&]
        {
            std::vector<NodeId> out;
            for (const Node* child : surface.root().children())
                out.push_back(child->id());
            return out;
        };
        CHECK(ids() == std::vector<NodeId> { a, b, c });

        surface.insertChild(root, a); // moves to the end
        CHECK(ids() == std::vector<NodeId> { b, c, a });
        surface.insertChild(b, c); // reparents
        CHECK(ids() == std::vector<NodeId> { b, a });
        CHECK(surface.find(c)->parent()->id() == b);
        CHECK(surface.isConnected(c));

        surface.removeChild(root, b);
        CHECK_FALSE(surface.isConnected(b));
        CHECK_FALSE(surface.isConnected(c));
        CHECK(surface.find(c)->parent()->id() == b);
    }

    TEST_CASE("misuse throws and leaves the tree unchanged")
    {
        Surface surface;
        const NodeId root = surface.root().id();
        const NodeId parent = surface.createNode(NodeType::View);
        const NodeId child = surface.createNode(NodeType::View);
        const NodeId text = surface.createNode(NodeType::Text);
        surface.insertChild(root, parent);
        surface.insertChild(parent, child);

        CHECK_THROWS_AS(surface.insertChild(child, parent), std::invalid_argument); // cycle
        CHECK_THROWS_AS(surface.insertChild(parent, parent), std::invalid_argument);
        CHECK_THROWS_AS(surface.insertChild(text, child), std::invalid_argument); // only views have children
        CHECK_THROWS_AS(surface.insertChild(parent, root), std::invalid_argument);
        CHECK_THROWS_AS(surface.insertChild(root, text, child), std::invalid_argument); // not a child of root
        CHECK_THROWS_AS(surface.removeChild(root, child), std::invalid_argument);
        CHECK_THROWS_AS(surface.setText(parent, "x"), std::invalid_argument);
        CHECK_THROWS_AS(surface.releaseNode(root), std::invalid_argument);
        CHECK_THROWS_AS(surface.insertChild(root, 999), std::invalid_argument);
        CHECK(surface.find(child)->parent()->id() == parent);
        CHECK(surface.root().children().size() == 1);
    }

    TEST_CASE("releasing a node detaches it and its children")
    {
        Row f;
        f.surface.releaseNode(f.b);
        CHECK(f.surface.find(f.b) == nullptr);
        CHECK(f.surface.find(f.inner)->parent() == nullptr);
        CHECK(f.surface.root().children().size() == 1);
        f.surface.layout(); // Yoga is consistent
        CHECK(f.surface.hitTest({ 150, 10 }) == f.root);
    }

    TEST_CASE("changes are reported once")
    {
        Surface surface;
        CHECK(surface.takeChanges());
        CHECK_FALSE(surface.takeChanges());
        surface.setSize({ 10, 10 });
        CHECK(surface.takeChanges());
        surface.setSize({ 10, 10 });
        CHECK_FALSE(surface.takeChanges());
        surface.insertChild(surface.root().id(), surface.createNode(NodeType::View));
        CHECK(surface.takeChanges());
    }
}

TEST_SUITE("ui::Surface hit testing")
{
    TEST_CASE("finds the topmost, deepest node")
    {
        Row f;
        CHECK(f.surface.hitTest({ 10, 10 }) == f.a);
        CHECK(f.surface.hitTest({ 110, 10 }) == f.inner);
        CHECK(f.surface.hitTest({ 110, 60 }) == f.b);
        CHECK(f.surface.hitTest({ 250, 10 }) == noNode);
    }

    TEST_CASE("later siblings are on top")
    {
        Surface surface;
        surface.setSize({ 100, 100 });
        const NodeId under = surface.createNode(NodeType::View);
        const NodeId over = surface.createNode(NodeType::View);
        Style fill = sized(100, 100);
        fill.position = Position::Absolute;
        surface.setStyle(under, fill);
        surface.setStyle(over, fill);
        surface.insertChild(surface.root().id(), under);
        surface.insertChild(surface.root().id(), over);
        CHECK(surface.hitTest({ 50, 50 }) == over);
    }

    TEST_CASE("zIndex stacks siblings for hit testing and leaves layout alone")
    {
        Surface surface;
        surface.setSize({ 300, 100 });
        const NodeId root = surface.root().id();
        Style row;
        row.flexDirection = FlexDirection::Row;
        surface.setStyle(root, row);
        // Three 100×100 boxes in a row, then each moved over the first.
        const NodeId first = surface.createNode(NodeType::View);
        const NodeId second = surface.createNode(NodeType::View);
        const NodeId third = surface.createNode(NodeType::View);
        for (const NodeId id : { first, second, third })
        {
            surface.setStyle(id, sized(100, 100));
            surface.insertChild(root, id);
        }
        Style raised = sized(100, 100);
        raised.zIndex = 1;
        surface.setStyle(second, raised);
        CHECK(surface.bounds(second).x == 100);
        CHECK(surface.root().children()[1]->id() == second);

        // Overlapping: the highest zIndex wins, then the later sibling.
        Style over = sized(100, 100);
        over.position = Position::Absolute;
        over.zIndex = 2;
        surface.setStyle(first, over);
        over.zIndex = 1;
        surface.setStyle(second, over);
        surface.setStyle(third, over);
        CHECK(surface.hitTest({ 50, 50 }) == first);
        over.zIndex = 2;
        surface.setStyle(third, over);
        CHECK(surface.hitTest({ 50, 50 }) == third);
        over.zIndex = -1;
        surface.setStyle(third, over);
        surface.setStyle(first, over);
        CHECK(surface.hitTest({ 50, 50 }) == second);
        CHECK(std::vector(surface.root().stackedChildren().begin(), surface.root().stackedChildren().end())
              == std::vector { surface.find(first), surface.find(third), surface.find(second) });

        // A child's zIndex counts among its siblings only.
        const NodeId child = surface.createNode(NodeType::View);
        Style top = sized(100, 100);
        top.zIndex = 1000;
        surface.setStyle(child, top);
        surface.insertChild(first, child);
        CHECK(surface.hitTest({ 50, 50 }) == second);
        // Removing restacks too.
        surface.removeChild(root, second);
        CHECK(surface.hitTest({ 50, 50 }) == third);
        surface.removeChild(root, third);
        CHECK(surface.hitTest({ 50, 50 }) == child);
    }

    TEST_CASE("the overlay is a second root, over the content and hit before it")
    {
        Surface surface;
        surface.setSize({ 200, 100 });
        const NodeId root = surface.root().id();
        const NodeId overlay = surface.overlay().id();
        Style padded;
        padded.padding = { Length::points(30), Length::points(30), Length::points(30), Length::points(30) };
        surface.setStyle(root, padded);
        const NodeId content = surface.createNode(NodeType::View);
        Style top = sized(100, 100);
        top.position = Position::Absolute;
        top.zIndex = 2147483647;
        surface.setStyle(content, top);
        surface.insertChild(root, content);
        const NodeId floating = surface.createNode(NodeType::View);
        surface.setStyle(floating, sized(50, 50));
        surface.insertChild(overlay, floating);

        // Laid out on its own, from the view's corner, and connected.
        CHECK(surface.isConnected(floating));
        CHECK(surface.bounds(floating).x == 0);
        CHECK(surface.bounds(floating).y == 0);
        CHECK(surface.find(overlay)->frame().width == 200);
        // Hit first whatever the content's zIndex; elsewhere, the content.
        CHECK(surface.hitTest({ 10, 10 }) == floating);
        CHECK(surface.hitTest({ 80, 80 }) == content);
        CHECK(surface.hitTest({ 150, 50 }) == root);
        // Still a root: not a child, never released.
        CHECK_THROWS_AS(surface.insertChild(content, overlay), std::invalid_argument);
        CHECK_THROWS_AS(surface.releaseNode(overlay), std::invalid_argument);
        // Its own pointerEvents never block the content.
        Style blocking;
        blocking.pointerEvents = PointerEvents::Auto;
        surface.setStyle(overlay, blocking);
        CHECK(surface.hitTest({ 80, 80 }) == content);
    }

    TEST_CASE("pointerEvents and overflow")
    {
        Row f;
        Style style = sized(100, 100);

        style.pointerEvents = PointerEvents::None;
        f.surface.setStyle(f.b, style);
        CHECK(f.surface.hitTest({ 110, 10 }) == f.root);

        style.pointerEvents = PointerEvents::BoxNone;
        f.surface.setStyle(f.b, style);
        CHECK(f.surface.hitTest({ 110, 10 }) == f.inner);
        CHECK(f.surface.hitTest({ 110, 60 }) == f.root);

        style.pointerEvents = PointerEvents::BoxOnly;
        f.surface.setStyle(f.b, style);
        CHECK(f.surface.hitTest({ 110, 10 }) == f.b);

        // A child sticking out of its parent is hit only while overflow is visible.
        Style wide = sized(300, 50);
        f.surface.setStyle(f.inner, wide);
        f.surface.setStyle(f.b, sized(100, 100));
        CHECK(f.surface.hitTest({ 190, 10 }) == f.inner);
        Style clipped = sized(100, 100);
        clipped.overflow = Overflow::Hidden;
        f.surface.setStyle(f.a, sized(100, 100));
        f.surface.setStyle(f.b, clipped);
        f.surface.setSize({ 400, 100 });
        CHECK(f.surface.hitTest({ 250, 10 }) == f.root);
    }
}

TEST_SUITE("ui::Surface input")
{
    TEST_CASE("hover enters from the outside in and leaves from the inside out")
    {
        Row f;
        Recorder r(f.surface);
        f.surface.pointer(move(10, 10));
        CHECK(r.take() == std::vector { at(f.root, "enter"), at(f.a, "enter"), at(f.a, "move") });
        f.surface.pointer(move(110, 10));
        CHECK(r.take()
              == std::vector { at(f.a, "leave"), at(f.b, "enter"), at(f.inner, "enter"), at(f.inner, "move") });
        f.surface.pointer(pointer(PointerInput::Phase::Leave, 0, 0));
        CHECK(r.take() == std::vector { at(f.inner, "leave"), at(f.b, "leave"), at(f.root, "leave") });
    }

    TEST_CASE("a press captures the pointer and a release clicks the common ancestor")
    {
        Row f;
        Recorder r(f.surface);
        f.surface.pointer(move(110, 10));
        r.take();

        CHECK(f.surface.pointer(down(110, 10)));
        CHECK(r.take() == std::vector { at(f.inner, "down") });
        CHECK(r.last.offset.x == 10);
        CHECK(r.last.button == 0);

        // Dragging outside still goes to the pressed node, and hover is frozen.
        f.surface.pointer(move(10, 10, 1));
        CHECK(r.take() == std::vector { at(f.inner, "move") });

        // Released over a sibling of b: the click goes to their common ancestor.
        f.surface.pointer(up(10, 10));
        CHECK(r.take()
              == std::vector { at(f.inner, "up"), at(f.root, "click"), at(f.inner, "leave"), at(f.b, "leave"),
                               at(f.a, "enter") });

        f.surface.pointer(down(10, 10));
        f.surface.pointer(up(12, 12));
        CHECK(r.take() == std::vector { at(f.a, "down"), at(f.a, "up"), at(f.a, "click") });
    }

    TEST_CASE("only the primary button clicks, and only when all buttons are up")
    {
        Row f;
        Recorder r(f.surface);
        f.surface.pointer(pointer(PointerInput::Phase::Down, 10, 10, 2, 2));
        f.surface.pointer(pointer(PointerInput::Phase::Up, 10, 10, 0, 2));
        const auto events = r.take();
        CHECK(std::find(events.begin(), events.end(), at(f.a, "click")) == events.end());
    }

    TEST_CASE("the secondary button asks for a context menu at the pressed node")
    {
        Row f;
        Recorder r(f.surface);
        f.surface.pointer(move(110, 10));
        r.take();
        f.surface.pointer(pointer(PointerInput::Phase::Down, 115, 20, 2, 2));
        CHECK(r.take() == std::vector { at(f.inner, "down"), at(f.inner, "contextmenu") });
        CHECK(r.last.button == 2);
        CHECK(r.last.buttons == 2);
        CHECK(r.last.position.x == 115);
        CHECK(r.last.offset.x == 15);
        CHECK(r.last.offset.y == 20);
        f.surface.pointer(pointer(PointerInput::Phase::Up, 115, 20, 0, 2));
        CHECK(r.take() == std::vector { at(f.inner, "up") });
        // Not the primary or middle buttons; and not where nothing is hit.
        f.surface.pointer(down(110, 10));
        f.surface.pointer(up(110, 10));
        f.surface.pointer(pointer(PointerInput::Phase::Down, 110, 10, 4, 1));
        f.surface.pointer(pointer(PointerInput::Phase::Up, 110, 10, 0, 1));
        const auto events = r.take();
        CHECK(std::find(events.begin(), events.end(), at(f.inner, "contextmenu")) == events.end());
        f.surface.pointer(pointer(PointerInput::Phase::Down, 250, 10, 2, 2));
        CHECK(r.take() == std::vector { at(f.inner, "leave"), at(f.b, "leave"), at(f.root, "leave") });
    }

    TEST_CASE("positions are logical, and bounds follow scrolling where frames do not")
    {
        Surface surface;
        surface.setSize({ 100, 100 });
        surface.setScale(2);
        const NodeId scroller = surface.createNode(NodeType::Scroll);
        Style box = sized(100, 50);
        box.padding = { Length::points(5), Length::points(5), Length::points(5), Length::points(5) };
        surface.setStyle(scroller, box);
        surface.insertChild(surface.root().id(), surface.createNode(NodeType::View));
        surface.setStyle(surface.root().children()[0]->id(), sized(100, 20));
        surface.insertChild(surface.root().id(), scroller);
        const NodeId item = surface.createNode(NodeType::View);
        surface.setStyle(item, sized(50, 200));
        surface.insertChild(scroller, item);
        surface.scrollTo(scroller, { 0, 30 });

        CHECK(surface.find(item)->frame().y == 5);
        CHECK(surface.bounds(item).y == 20 + 5 - 30);
        CHECK(surface.bounds(item).height == 200);

        Recorder r(surface);
        surface.pointer(down(15, 40));
        CHECK(r.last.target == item);
        CHECK(r.last.position.x == 15);
        CHECK(r.last.position.y == 40);
        CHECK(r.last.offset.x == 10);
        CHECK(r.last.offset.y == 45);
    }

    TEST_CASE("hover and focus move between the content and the overlay")
    {
        Row f;
        const NodeId overlay = f.surface.overlay().id();
        const NodeId floating = f.surface.createNode(NodeType::View);
        Style box = sized(50, 50);
        box.position = Position::Absolute;
        box.inset.left = Length::points(100);
        f.surface.setStyle(floating, box);
        f.surface.insertChild(overlay, floating);
        f.surface.setFocusable(f.a, true);
        f.surface.setFocusable(floating, true);

        Recorder r(f.surface);
        f.surface.pointer(move(10, 10));
        r.take();
        f.surface.pointer(move(110, 10));
        CHECK(r.take()
              == std::vector { at(f.a, "leave"), at(f.root, "leave"), at(overlay, "enter"), at(floating, "enter"),
                               at(floating, "move") });
        // A press and release across the layers clicks nothing.
        f.surface.pointer(down(110, 10));
        f.surface.pointer(up(10, 10));
        const auto events = r.take();
        CHECK(std::find(events.begin(), events.end(), at(f.root, "click")) == events.end());
        CHECK(std::find(events.begin(), events.end(), at(overlay, "click")) == events.end());
        // Tab goes through the content, then the overlay.
        f.surface.focus(f.a);
        CHECK(f.surface.key(key("Tab")));
        CHECK(f.surface.focused() == floating);
        CHECK(f.surface.key(key("Tab")));
        CHECK(f.surface.focused() == f.a);
    }

    TEST_CASE("cancel ends the capture without a click")
    {
        Row f;
        Recorder r(f.surface);
        f.surface.pointer(down(10, 10));
        r.take();
        f.surface.pointer(pointer(PointerInput::Phase::Cancel, 10, 10));
        CHECK(r.take() == std::vector { at(f.a, "cancel"), at(f.a, "leave"), at(f.root, "leave") });
        f.surface.pointer(move(110, 60));
        CHECK(r.take() == std::vector { at(f.root, "enter"), at(f.b, "enter"), at(f.b, "move") });
    }

    TEST_CASE("removing nodes during dispatch is safe")
    {
        Row f;
        f.surface.setEventSink(
            [&](const Event& event)
            {
                if (event.type == Event::Type::PointerDown)
                    f.surface.releaseNode(f.inner);
                return false;
            });
        f.surface.pointer(down(110, 10));
        f.surface.pointer(move(120, 10, 1));
        f.surface.pointer(up(120, 10));
        CHECK(f.surface.hitTest({ 110, 10 }) == f.b);
    }

    TEST_CASE("pressing focuses the nearest focusable node; preventDefault keeps focus")
    {
        Row f;
        Recorder r(f.surface);
        f.surface.setFocusable(f.b, true);
        f.surface.pointer(down(110, 10));
        f.surface.pointer(up(110, 10));
        CHECK(f.surface.focused() == f.b);
        auto events = r.take();
        CHECK(std::find(events.begin(), events.end(), at(f.b, "focus")) != events.end());

        r.prevent = Event::Type::PointerDown;
        f.surface.pointer(down(10, 10));
        f.surface.pointer(up(10, 10));
        CHECK(f.surface.focused() == f.b);

        r.prevent.reset();
        f.surface.pointer(down(10, 10));
        CHECK(f.surface.focused() == noNode);
        events = r.take();
        CHECK(std::find(events.begin(), events.end(), at(f.b, "blur")) != events.end());
    }

    TEST_CASE("keys go to the focused node, or the root")
    {
        Row f;
        Recorder r(f.surface);
        CHECK_FALSE(f.surface.key(key("a")));
        CHECK(r.take() == std::vector { at(f.root, "keydown") });

        f.surface.setFocusable(f.a, true);
        f.surface.focus(f.a);
        r.take();
        r.prevent = Event::Type::KeyDown;
        CHECK(f.surface.key(key("Enter")));
        CHECK(r.take() == std::vector { at(f.a, "keydown") });
        CHECK(r.last.key == "Enter");
    }

    TEST_CASE("Tab and Shift+Tab move focus in tree order")
    {
        Row f;
        Recorder r(f.surface);
        f.surface.setFocusable(f.a, true);
        f.surface.setFocusable(f.inner, true);
        CHECK(f.surface.key(key("Tab")));
        CHECK(f.surface.focused() == f.a);
        CHECK(f.surface.key(key("Tab")));
        CHECK(f.surface.focused() == f.inner);
        CHECK(f.surface.key(key("Tab")));
        CHECK(f.surface.focused() == f.a);
        CHECK(f.surface.key(key("Tab", Modifier::Shift)));
        CHECK(f.surface.focused() == f.inner);
        CHECK_FALSE(f.surface.key(key("Tab", Modifier::Control)));

        // A keydown listener can take Tab for itself.
        r.prevent = Event::Type::KeyDown;
        f.surface.key(key("Tab"));
        CHECK(f.surface.focused() == f.inner);
    }

    TEST_CASE("text goes to the focused node only")
    {
        Row f;
        Recorder r(f.surface);
        CHECK_FALSE(f.surface.text({ "x" }));
        f.surface.setFocusable(f.a, true);
        f.surface.focus(f.a);
        r.take();
        CHECK(f.surface.text({ "é" }));
        CHECK(r.take() == std::vector { at(f.a, "input") });
        CHECK(r.last.text == "é");
    }

    TEST_CASE("focus follows the tree: unfocusable or detached nodes lose it")
    {
        Row f;
        f.surface.focus(f.a); // not focusable: ignored
        CHECK(f.surface.focused() == noNode);
        f.surface.setFocusable(f.inner, true);
        f.surface.focus(f.inner);
        f.surface.removeChild(f.root, f.b);
        CHECK(f.surface.focused() == noNode);
    }

    TEST_CASE("wheel goes to the node under the pointer")
    {
        Row f;
        Recorder r(f.surface);
        r.prevent = Event::Type::Wheel;
        CHECK(f.surface.wheel({ .position = { 110, 10 }, .deltaX = 0, .deltaY = 3, .unit = WheelInput::Unit::Line }));
        CHECK(r.take() == std::vector { at(f.inner, "wheel") });
        CHECK(r.last.deltaY == 3);
        CHECK(r.last.deltaUnit == WheelInput::Unit::Line);
        CHECK_FALSE(f.surface.wheel({ .position = { 500, 10 } }));
    }
}
