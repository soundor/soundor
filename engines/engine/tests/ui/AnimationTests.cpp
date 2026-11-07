#include <soundor/a11y/SurfaceSemantics.h>
#include <soundor/ui/Animation.h>
#include <soundor/ui/Surface.h>

#include <doctest/doctest.h>

#include <cmath>
#include <numbers>
#include <stdexcept>

using namespace soundor::ui;

namespace
{
    struct Fixture
    {
        double time = 0;
        Surface surface;
        NodeId node = surface.createNode(NodeType::View);
        Fixture()
        {
            surface.animations().setClock([this] { return time; });
            Style style;
            style.width = Length::points(40);
            style.height = Length::points(20);
            surface.setStyle(node, style);
            surface.setSize({ 200, 200 });
            surface.insertChild(surface.root().id(), node);
            surface.layout();
        }
        AnimationDescription opacity(float target, double duration = 100)
        {
            AnimationDescription description;
            description.to[AnimatedProperty::Opacity] = target;
            description.properties = propertyBit(AnimatedProperty::Opacity);
            description.timing.duration = duration;
            description.timing.fill = Fill::Forwards;
            return description;
        }
        void advance(double value)
        {
            time = value;
            surface.animations().tick();
        }
    };
} // namespace

TEST_SUITE("native animations")
{
    TEST_CASE("sequence origins honor a preceding reversed group's endpoint and retain storage")
    {
        Fixture f;
        AnimationDescription reversed;
        reversed.composition = Composition::Sequence;
        reversed.children = { f.opacity(0) };
        reversed.timing.direction = Direction::Reverse;
        AnimationDescription sequence;
        sequence.composition = Composition::Sequence;
        sequence.children = { reversed, f.opacity(0) };
        sequence.timing.fill = Fill::Forwards;
        f.surface.animations().animate(f.node, sequence);
        const auto storage = f.surface.animations().storageBytes();
        CHECK(storage > 0);
        f.advance(150);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.5));
        CHECK(f.surface.animations().storageBytes() == storage);
    }

    TEST_CASE("native sequence phases hold endpoints and emit only one overall completion")
    {
        Fixture f;
        AnimationDescription sequence;
        sequence.composition = Composition::Sequence;
        sequence.children = { f.opacity(0), f.opacity(1) };
        sequence.timing.fill = Fill::Forwards;
        const auto id = f.surface.animations().animate(f.node, sequence);
        CHECK(f.surface.animations().size() == 1);
        f.advance(50);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.5));
        f.advance(100);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 0);
        CHECK(f.surface.animations().completions().empty());
        f.advance(150);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.5));
        f.advance(200);
        CHECK(f.surface.animations().state(id) == PlaybackState::Finished);
        CHECK(f.surface.animations().completions().size() == 1);
        f.surface.animations().seek(id, 50);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.5));
        CHECK(f.surface.animations().state(id) == PlaybackState::Paused);
    }

    TEST_CASE("parallel and stagger own multiple nodes and interrupt atomically")
    {
        Fixture f;
        const NodeId second = f.surface.createNode(NodeType::View);
        f.surface.insertChild(f.surface.root().id(), second);
        auto other = f.opacity(0);
        other.targetNode = second;
        AnimationDescription group;
        group.composition = Composition::Stagger;
        group.stagger = 50;
        group.children = { f.opacity(0), other };
        group.timing.fill = Fill::Forwards;
        const auto id = f.surface.animations().animate(f.node, group);
        f.advance(25);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.75));
        CHECK(f.surface.presentation(second)[AnimatedProperty::Opacity] == 1);
        f.advance(75);
        CHECK(f.surface.presentation(second)[AnimatedProperty::Opacity] == doctest::Approx(0.75));
        f.surface.animations().animate(second, f.opacity(1));
        CHECK(f.surface.animations().state(id) == PlaybackState::Cancelled);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 1);
        CHECK(f.surface.presentation(second)[AnimatedProperty::Opacity] == doctest::Approx(0.75));
        CHECK(f.surface.animations().size() == 1);
    }

    TEST_CASE("destroying a composed target cancels the entire native program")
    {
        Fixture f;
        const NodeId second = f.surface.createNode(NodeType::View);
        f.surface.insertChild(f.surface.root().id(), second);
        auto other = f.opacity(0);
        other.targetNode = second;
        AnimationDescription group;
        group.composition = Composition::Parallel;
        group.children = { f.opacity(0), other };
        const auto id = f.surface.animations().animate(f.node, group);
        f.advance(50);
        f.surface.removeChild(f.surface.root().id(), second);
        f.surface.releaseNode(second);
        CHECK(f.surface.animations().state(id) == PlaybackState::Cancelled);
        CHECK(f.surface.animations().size() == 0);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 1);
    }

    TEST_CASE("parallel conflicts reject without cancelling an existing animation")
    {
        Fixture f;
        const auto previous = f.surface.animations().animate(f.node, f.opacity(0));
        AnimationDescription invalid;
        invalid.composition = Composition::Parallel;
        invalid.children = { f.opacity(0), f.opacity(1) };
        CHECK_THROWS_AS(f.surface.animations().animate(f.node, invalid), std::invalid_argument);
        CHECK(f.surface.animations().state(previous) == PlaybackState::Running);
        CHECK(f.surface.animations().size() == 1);
    }

    TEST_CASE("repeat reverse and standalone delay phases run inside the existing timeline")
    {
        Fixture f;
        AnimationDescription wait;
        wait.composition = Composition::Delay;
        wait.timing.duration = 50;
        AnimationDescription sequence;
        sequence.composition = Composition::Sequence;
        sequence.children = { wait, f.opacity(0), f.opacity(1) };
        sequence.timing.iterations = 2;
        sequence.timing.direction = Direction::Alternate;
        sequence.timing.fill = Fill::Forwards;
        const auto id = f.surface.animations().animate(f.node, sequence);
        f.advance(25);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 1);
        f.advance(100);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.5));
        f.advance(350);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0));
        f.advance(500);
        CHECK(f.surface.animations().state(id) == PlaybackState::Finished);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 1);
    }

    TEST_CASE("keyframes use property-specific offsets and per-segment easing")
    {
        Fixture f;
        auto description = f.opacity(0);
        Keyframe start, middle, end;
        start.properties = end.properties = propertyBit(AnimatedProperty::Opacity);
        start.value[AnimatedProperty::Opacity] = 0;
        end.value[AnimatedProperty::Opacity] = 1;
        start.offset = 0;
        middle.offset = 0.5;
        end.offset = 1;
        start.easing = Easing::EaseIn;
        description.from = start.value;
        description.to = end.value;
        description.keyframes = { start, middle, end };
        f.surface.animations().animate(f.node, description);
        f.advance(25);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity]
              == doctest::Approx(AnimationTimeline::ease(Easing::EaseIn, 0.25)));
        f.advance(50);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity]
              == doctest::Approx(AnimationTimeline::ease(Easing::EaseIn, 0.5)));
    }

    TEST_CASE("alternate repetition and paused seeking remain entirely native")
    {
        Fixture f;
        auto description = f.opacity(0);
        description.timing.iterations = 3;
        description.timing.direction = Direction::Alternate;
        const auto id = f.surface.animations().animate(f.node, description);
        f.advance(150);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.5));
        CHECK(f.surface.animations().state(id) == PlaybackState::Running);
        f.surface.animations().pause(id);
        f.surface.animations().seek(id, 225);
        CHECK(f.surface.animations().state(id) == PlaybackState::Paused);
        CHECK(f.surface.animations().currentTime(id) == 225);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.75));
        f.surface.animations().seek(id, 300);
        CHECK(f.surface.animations().state(id) == PlaybackState::Finished);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 0);
        f.surface.animations().seek(id, 50);
        CHECK(f.surface.animations().generation(id) == 1);
        CHECK(f.surface.animations().state(id) == PlaybackState::Paused);
    }

    TEST_CASE("fractional and infinite iterations define final values and completion")
    {
        Fixture f;
        auto description = f.opacity(0);
        description.timing.iterations = 1.5;
        const auto fractional = f.surface.animations().animate(f.node, description);
        f.advance(150);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.5));
        CHECK(f.surface.animations().state(fractional) == PlaybackState::Finished);
        description.timing.iterations = std::numeric_limits<double>::infinity();
        description.timing.direction = Direction::Alternate;
        const auto infinite = f.surface.animations().animate(f.node, description);
        f.advance(10200);
        CHECK(f.surface.animations().state(infinite) == PlaybackState::Running);
        CHECK_THROWS_AS(f.surface.animations().finish(infinite), std::invalid_argument);
        f.surface.animations().setReducedMotion(true);
        CHECK(f.surface.animations().state(infinite) == PlaybackState::Finished);
    }

    TEST_CASE("paint overrides interpolate straight sRGB channels and invalidate raster content without Yoga")
    {
        Fixture f;
        Style base = f.surface.find(f.node)->style();
        base.backgroundColor = { 255, 0, 0, 255 };
        base.borderColor = { 0, 0, 0, 255 };
        f.surface.setStyle(f.node, base);
        f.surface.layout();
        const auto layouts = f.surface.statistics().layoutPasses;
        AnimationDescription description;
        description.properties = paintPropertyMask;
        description.to.colors = { std::array<float, 4> { 0, 0, 1, 0.5f }, { 1, 1, 1, 1 } };
        description.timing.duration = 100;
        description.timing.fill = Fill::Forwards;
        const auto id = f.surface.animations().animate(f.node, description);
        f.advance(50);
        const auto* node = f.surface.find(f.node);
        CHECK(node->presentedStyle().backgroundColor == Color { 128, 0, 128, 191 });
        CHECK(node->presentedStyle().borderColor == Color { 128, 128, 128, 255 });
        CHECK(node->style().backgroundColor == base.backgroundColor);
        CHECK_FALSE(node->hasCompositorPresentation());
        CHECK(f.surface.statistics().layoutPasses == layouts);
        base.backgroundColor = { 0, 255, 0, 255 };
        f.surface.setStyle(f.node, base);
        CHECK(node->presentedStyle().backgroundColor == Color { 128, 0, 128, 191 });
        f.surface.animations().cancel(id);
        CHECK(node->presentedStyle().backgroundColor == base.backgroundColor);
    }

    TEST_CASE("spring responses cover all damping regimes and preserve the analytic initial state")
    {
        SpringParameters spring;
        for (const double damping : { 10., 20., 40. })
        {
            spring.damping = damping;
            const auto initial = sampleSpring(spring, 0, 0, 1, 2);
            CHECK(initial.position == 0);
            CHECK(initial.velocity == 2);
            const auto settled = sampleSpring(spring, 20, 0, 1, 2);
            CHECK(settled.position == doctest::Approx(1));
            CHECK(settled.velocity == doctest::Approx(0).epsilon(1e-8));
            const auto whole = sampleSpring(spring, 0.2, 0, 1, 2);
            const auto half = sampleSpring(spring, 0.1, 0, 1, 2);
            const auto stepped = sampleSpring(spring, 0.1, half.position, 1, half.velocity);
            CHECK(stepped.position == doctest::Approx(whole.position));
            CHECK(stepped.velocity == doctest::Approx(whole.velocity));
        }
        spring.damping = 0;
        CHECK_THROWS_AS(validateSpring(spring), std::invalid_argument);
    }

    TEST_CASE("spring retargeting retains position and velocity without changing application style")
    {
        Fixture f;
        auto description = f.opacity(0);
        description.spring = SpringParameters {};
        const auto first = f.surface.animations().animate(f.node, description);
        f.advance(50);
        const float position = f.surface.presentation(f.node)[AnimatedProperty::Opacity];
        const auto expected = sampleSpring(*description.spring, 0.05, 1, 0, 0);
        CHECK(position == doctest::Approx(expected.position));
        description.to[AnimatedProperty::Opacity] = 1;
        const auto second = f.surface.animations().animate(f.node, description);
        CHECK(f.surface.animations().state(first) == PlaybackState::Cancelled);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == position);
        f.advance(51);
        const auto retargeted = sampleSpring(*description.spring, 0.001, position, 1, expected.velocity);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(retargeted.position));
        CHECK(f.surface.find(f.node)->style().opacity == 1);
        f.advance(10000);
        CHECK(f.surface.animations().state(second) == PlaybackState::Finished);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 1);
    }

    TEST_CASE("delay, fill and interpolation never mutate base style or invoke Yoga")
    {
        Fixture f;
        auto description = f.opacity(0);
        description.timing.delay = 20;
        description.from = Presentation {};
        (*description.from)[AnimatedProperty::Opacity] = 0.8f;
        description.timing.fill = Fill::Both;
        const auto layouts = f.surface.statistics().layoutPasses;
        const auto styles = f.surface.statistics().styleChanges;
        const auto id = f.surface.animations().animate(f.node, description);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.8));
        f.advance(70);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.4));
        CHECK(f.surface.find(f.node)->style().opacity == 1);
        f.surface.layout();
        CHECK(f.surface.statistics().layoutPasses == layouts);
        CHECK(f.surface.statistics().styleChanges == styles);
        f.advance(120);
        CHECK(f.surface.animations().state(id) == PlaybackState::Finished);
        CHECK(f.surface.animations().completions().size() == 1);
        f.advance(200);
        CHECK(f.surface.animations().completions().size() == 1);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 0);
        f.surface.animations().cancel(id);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 1);
    }

    TEST_CASE("pause, resume, retarget and finish preserve the displayed value")
    {
        Fixture f;
        const auto first = f.surface.animations().animate(f.node, f.opacity(0));
        f.advance(40);
        f.surface.animations().pause(first);
        f.advance(100);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.6));
        f.surface.animations().play(first);
        f.advance(120);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.4));
        const auto second = f.surface.animations().animate(f.node, f.opacity(1));
        CHECK(f.surface.animations().state(first) == PlaybackState::Cancelled);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.4));
        f.advance(170);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.7));
        f.surface.animations().finish(second);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == 1);
        CHECK(f.surface.animations().completions().size() == 2);
        CHECK(f.surface.animations().completions()[0].cancelled);
        CHECK_FALSE(f.surface.animations().completions()[1].cancelled);
    }

    TEST_CASE("multiple surfaces, node cleanup, nonoverlapping properties and reduced motion")
    {
        Fixture a, b;
        const auto id = a.surface.animations().animate(a.node, a.opacity(0));
        b.surface.animations().animate(b.node, b.opacity(0.5f));
        a.advance(50);
        CHECK(a.surface.presentation(a.node)[AnimatedProperty::Opacity] == doctest::Approx(0.5));
        CHECK(b.surface.presentation(b.node)[AnimatedProperty::Opacity] == 1);
        AnimationDescription movement;
        movement.to[AnimatedProperty::TranslateX] = 100;
        movement.to.order[0] = AnimatedProperty::TranslateX;
        movement.to.count = 1;
        movement.properties = propertyBit(AnimatedProperty::TranslateX);
        movement.timing.duration = 100;
        movement.timing.fill = Fill::Forwards;
        a.surface.animations().animate(a.node, movement);
        a.advance(75);
        CHECK(a.surface.presentation(a.node)[AnimatedProperty::Opacity] == doctest::Approx(0.25));
        CHECK(a.surface.presentation(a.node)[AnimatedProperty::TranslateX] == doctest::Approx(25));
        CHECK(a.surface.animations().state(id) == PlaybackState::Running);
        a.surface.releaseNode(a.node);
        CHECK(a.surface.animations().size() == 0);
        b.surface.animations().setReducedMotion(true);
        CHECK(b.surface.presentation(b.node)[AnimatedProperty::Opacity] == 0.5f);
    }

    TEST_CASE("transform origin, ordering, inverse hit testing and presented bounds")
    {
        Fixture f;
        Style style = f.surface.find(f.node)->style();
        style.transform.order[0] = AnimatedProperty::TranslateX;
        style.transform.order[1] = AnimatedProperty::Scale;
        style.transform.count = 2;
        style.transform[AnimatedProperty::TranslateX] = 80;
        style.transform[AnimatedProperty::Scale] = 2;
        f.surface.setStyle(f.node, style);
        const auto bounds = f.surface.bounds(f.node);
        CHECK(bounds.x == doctest::Approx(60));
        CHECK(bounds.y == doctest::Approx(-10));
        CHECK(bounds.width == 80);
        CHECK(f.surface.hitTest({ 100, 10 }) == f.node);
        CHECK(f.surface.hitTest({ 10, 10 }) != f.node);
        const auto local = f.surface.localPoint(f.node, { 100, 10 });
        CHECK(local.x == 20);
        CHECK(local.y == 10);
        style.transform[AnimatedProperty::Scale] = 0;
        f.surface.setStyle(f.node, style);
        CHECK(f.surface.hitTest({ 100, 10 }) != f.node);
    }

    TEST_CASE("nested transformed hit testing respects rounded clipping and overlay order")
    {
        Fixture f;
        auto style = f.surface.find(f.node)->style();
        style.position = Position::Absolute;
        style.inset.left = Length::points(20);
        style.inset.top = Length::points(20);
        style.overflow = Overflow::Hidden;
        style.borderRadius = { 10, 10, 10, 10 };
        style.transform.order[0] = AnimatedProperty::TranslateX;
        style.transform.order[1] = AnimatedProperty::Scale;
        style.transform.count = 2;
        style.transform[AnimatedProperty::TranslateX] = 20;
        style.transform[AnimatedProperty::Scale] = 2;
        f.surface.setStyle(f.node, style);
        const auto child = f.surface.createNode(NodeType::View);
        style = {};
        style.width = Length::points(40);
        style.height = Length::points(20);
        style.transform.order[0] = AnimatedProperty::Rotate;
        style.transform.count = 1;
        style.transform[AnimatedProperty::Rotate] = 0.25f;
        f.surface.setStyle(child, style);
        f.surface.insertChild(f.node, child);
        CHECK(f.surface.hitTest({ 60, 30 }) == child);
        const auto local = f.surface.localPoint(child, { 60, 30 });
        CHECK(local.x == doctest::Approx(20));
        CHECK(local.y == doctest::Approx(10));
        CHECK(f.surface.hitTest({ 22, 12 }) != child);
        const auto overlay = f.surface.createNode(NodeType::View);
        style.transform = {};
        style.position = Position::Absolute;
        style.inset.left = Length::points(50);
        style.inset.top = Length::points(20);
        style.width = Length::points(20);
        f.surface.setStyle(overlay, style);
        f.surface.insertChild(f.surface.overlay().id(), overlay);
        CHECK(f.surface.hitTest({ 60, 30 }) == overlay);
    }

    TEST_CASE("animated semantic bounds and inverse pointer coordinates preserve logical layout and focus")
    {
        Fixture f;
        f.surface.setFocusable(f.node, true);
        soundor::a11y::Properties properties;
        properties.role = soundor::a11y::Role::Button;
        properties.label = "Animated control";
        f.surface.setAccessibility(f.node, properties);
        f.surface.focus(f.node);
        soundor::a11y::SurfaceSemantics semantics(f.surface);
        (void)semantics.update(true);
        const auto element = semantics.elementOf(f.node);
        REQUIRE(semantics.tree().find(element) != nullptr);
        CHECK(semantics.tree().find(element)->bounds.x == 0);
        AnimationDescription movement;
        movement.to.order[0] = AnimatedProperty::TranslateX;
        movement.to.order[1] = AnimatedProperty::Scale;
        movement.to.count = 2;
        movement.to[AnimatedProperty::TranslateX] = 80;
        movement.to[AnimatedProperty::Scale] = 2;
        movement.properties = propertyBit(AnimatedProperty::TranslateX) | propertyBit(AnimatedProperty::Scale);
        movement.timing.duration = 100;
        movement.timing.fill = Fill::Forwards;
        f.surface.animations().animate(f.node, movement);
        f.advance(100);
        (void)semantics.update();
        CHECK(semantics.tree().find(element)->bounds.x == doctest::Approx(60));
        CHECK(semantics.tree().find(element)->bounds.width == 80);
        CHECK(f.surface.find(f.node)->frame().width == 40);
        CHECK(f.surface.focused() == f.node);
        Point offset;
        f.surface.setEventSink(
            [&](const Event& event)
            {
                if (event.type == Event::Type::PointerDown && event.target == f.node)
                    offset = event.offset;
                return false;
            });
        PointerInput input;
        input.phase = PointerInput::Phase::Down;
        input.position = { 100, 10 };
        input.button = 0;
        input.buttons = 1;
        f.surface.pointer(input);
        CHECK(offset.x == 20);
        CHECK(offset.y == 10);
    }

    TEST_CASE("standard easing endpoints and symmetry; monotonic clock and invalid descriptions")
    {
        for (const auto easing : { Easing::Linear, Easing::Ease, Easing::EaseIn, Easing::EaseOut, Easing::EaseInOut })
        {
            CHECK(AnimationTimeline::ease(easing, 0) == 0);
            CHECK(AnimationTimeline::ease(easing, 1) == 1);
        }
        CHECK(AnimationTimeline::ease(Easing::EaseInOut, 0.5) == doctest::Approx(0.5));
        CHECK(AnimationTimeline::ease(Easing::EaseIn, 0.5) < 0.5);
        CHECK(AnimationTimeline::ease(Easing::EaseOut, 0.5) > 0.5);
        Fixture f;
        f.surface.animations().animate(f.node, f.opacity(0));
        f.advance(50);
        f.advance(10);
        CHECK(f.surface.presentation(f.node)[AnimatedProperty::Opacity] == doctest::Approx(0.5));
        auto invalid = f.opacity(0);
        invalid.timing.duration = -1;
        CHECK_THROWS_AS(f.surface.animations().animate(f.node, invalid), std::invalid_argument);
        CHECK_THROWS_AS(f.surface.animations().setClock([] { return 0.; }), std::logic_error);
    }
}
