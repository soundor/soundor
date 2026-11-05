#include <soundor/backend/JuceEditorConstrainer.h>

#include <doctest/doctest.h>

#include <cmath>

using namespace soundor;

namespace
{
    // The bounds a constrainer gives a request to resize to `wanted` from
    // 600×400, dragging the bottom-right corner.
    juce::Rectangle<int> resized(juce::ComponentBoundsConstrainer& constrainer, juce::Rectangle<int> wanted)
    {
        constrainer.checkBounds(wanted, { 0, 0, 600, 400 }, {}, false, false, true, true);
        return wanted;
    }

    void limit(juce::ComponentBoundsConstrainer& constrainer)
    {
        constrainer.setSizeLimits(300, 200, 1200, 800);
        constrainer.setFixedAspectRatio(1.5);
    }
} // namespace

TEST_SUITE("JUCE editor constrainer")
{
    TEST_CASE("in a plugin it keeps the minimum, and offers the maximum and the ratio")
    {
        backend::JuceEditorConstrainer constrainer(false);
        limit(constrainer);
        // A size of another shape is kept: the UI is letterboxed in it.
        CHECK(resized(constrainer, { 0, 0, 1000, 400 }) == juce::Rectangle<int>(0, 0, 1000, 400));
        // The minimum still holds; a size beyond the maximum is kept, the UI
        // filling it as its fit says.
        CHECK(resized(constrainer, { 0, 0, 100, 3000 }) == juce::Rectangle<int>(0, 0, 300, 3000));
        CHECK(resized(constrainer, { 0, 0, 2000, 100 }) == juce::Rectangle<int>(0, 0, 2000, 200));
        // A host that asks (checkSizeConstraint) still reads them all.
        CHECK(constrainer.getMaximumWidth() == 1200);
        CHECK(constrainer.getMaximumHeight() == 800);
        CHECK(constrainer.getFixedAspectRatio() == doctest::Approx(1.5));
    }

    TEST_CASE("in the Standalone it enforces the limits and the ratio")
    {
        backend::JuceEditorConstrainer constrainer(true);
        limit(constrainer);
        const auto bounds = resized(constrainer, { 0, 0, 1000, 400 });
        // 3:2, to the nearest pixel.
        CHECK(std::abs(bounds.getWidth() - bounds.getHeight() * 1.5) <= 1.0);
        const auto large = resized(constrainer, { 0, 0, 3000, 3000 });
        CHECK(large.getWidth() <= 1200);
        CHECK(large.getHeight() <= 800);
    }

    TEST_CASE("a request is held to the limits, side by side")
    {
        backend::JuceEditorConstrainer constrainer(false);
        constrainer.setSizeLimits(300, 200, 1200, 0x3FFFFFFF);
        CHECK(constrainer.constrainRequest({ 700, 500 }) == juce::Point<int>(700, 500));
        CHECK(constrainer.constrainRequest({ 100, 100 }) == juce::Point<int>(300, 200));
        // No maximum height: as tall as asked.
        CHECK(constrainer.constrainRequest({ 5000, 5000 }) == juce::Point<int>(1200, 5000));
    }

    TEST_CASE("a request to an editor that keeps its ratio gets the nearest size at it")
    {
        backend::JuceEditorConstrainer constrainer(false);
        limit(constrainer);
        constrainer.setScaledLayout({ 600, 400 });
        CHECK(constrainer.constrainRequest({ 900, 600 }) == juce::Point<int>(900, 600));
        // Wider only: between the two sides' zooms, nearer the wider's.
        CHECK(constrainer.constrainRequest({ 900, 400 }) == juce::Point<int>(808, 538));
        // Within the zooms the limits allow: 0.5 to 2.
        CHECK(constrainer.constrainRequest({ 3000, 400 }) == juce::Point<int>(1200, 800));
        CHECK(constrainer.constrainRequest({ 10, 10 }) == juce::Point<int>(300, 200));
    }

    TEST_CASE("a corner dragged narrower and taller resizes one way only")
    {
        backend::JuceEditorConstrainer constrainer(false);
        limit(constrainer);
        constrainer.setScaledLayout({ 800, 600 });
        // Each step asked for from where the drag began, 800×600: the answers
        // shrink steadily (5 px narrower weighs more than 4 px taller), never
        // one size and the other in turn.
        juce::Point<int> last { 800, 600 };
        for (int step = 1; step <= 10; ++step)
        {
            const auto size = constrainer.constrainRequest({ 800 - step * 5, 600 + step * 4 });
            CHECK(size.x <= last.x);
            CHECK(size.y <= last.y);
            last = size;
        }
    }

    TEST_CASE("what the host showed holds until the next press")
    {
        backend::JuceEditorConstrainer constrainer(false);
        constrainer.setSizeLimits(300, 200, 1200, 800);
        constrainer.hostReplaced({ 1100, 700 }, { 800, 600 });
        CHECK(constrainer.constrainRequest({ 1100, 700 }) == juce::Point<int>(800, 600));
        constrainer.forgetHostLimits();
        CHECK(constrainer.constrainRequest({ 1100, 700 }) == juce::Point<int>(1100, 700));
    }

    TEST_CASE("a size the host gave in place of one asked for holds later requests")
    {
        backend::JuceEditorConstrainer constrainer(false);
        constrainer.setSizeLimits(300, 200, 1200, 800);
        // Ardour: its window no narrower than 760, so 600 wide gave 760.
        constrainer.hostReplaced({ 600, 400 }, { 760, 400 });
        CHECK(constrainer.constrainRequest({ 500, 300 }) == juce::Point<int>(760, 300));
        CHECK(constrainer.constrainRequest({ 900, 500 }) == juce::Point<int>(900, 500));
        // Given less than asked: no larger.
        constrainer.hostReplaced({ 1100, 700 }, { 1000, 700 });
        CHECK(constrainer.constrainRequest({ 1200, 800 }) == juce::Point<int>(1000, 800));
        // A pixel or two is rounding, not a limit.
        constrainer.hostReplaced({ 900, 500 }, { 900, 498 });
        CHECK(constrainer.constrainRequest({ 900, 800 }) == juce::Point<int>(900, 800));
        // The host's own resize to a size beyond what it showed: forgotten.
        constrainer.hostGave({ 700, 400 });
        CHECK(constrainer.constrainRequest({ 500, 300 }) == juce::Point<int>(700, 300));
        constrainer.hostGave({ 1200, 400 });
        CHECK(constrainer.constrainRequest({ 1200, 800 }) == juce::Point<int>(1200, 800));
    }

    TEST_CASE("an editor that keeps its ratio keeps to what the host showed, as a zoom")
    {
        backend::JuceEditorConstrainer constrainer(false);
        limit(constrainer);
        constrainer.setScaledLayout({ 600, 400 });
        constrainer.hostReplaced({ 450, 300 }, { 600, 300 });
        // No narrower than 600: a zoom of 1 at least.
        CHECK(constrainer.constrainRequest({ 300, 200 }) == juce::Point<int>(600, 400));
        CHECK(constrainer.constrainRequest({ 900, 600 }) == juce::Point<int>(900, 600));
    }

    TEST_CASE("the Standalone learns nothing of a host: it has none")
    {
        backend::JuceEditorConstrainer constrainer(true);
        constrainer.setSizeLimits(300, 200, 1200, 800);
        constrainer.hostReplaced({ 600, 400 }, { 760, 400 });
        CHECK(constrainer.constrainRequest({ 500, 300 }) == juce::Point<int>(500, 300));
    }
}
