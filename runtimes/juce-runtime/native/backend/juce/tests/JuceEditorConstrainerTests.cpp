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
        CHECK(constrainer.constrainRequest({ 700, 500 }, { 600, 400 }) == juce::Point<int>(700, 500));
        CHECK(constrainer.constrainRequest({ 100, 100 }, { 600, 400 }) == juce::Point<int>(300, 200));
        // No maximum height: as tall as asked.
        CHECK(constrainer.constrainRequest({ 5000, 5000 }, { 600, 400 }) == juce::Point<int>(1200, 5000));
    }

    TEST_CASE("a request to an editor that keeps its ratio follows the side that changes the more")
    {
        backend::JuceEditorConstrainer constrainer(false);
        limit(constrainer);
        constrainer.setScaledLayout({ 600, 400 });
        // Mostly wider: the width's zoom (1.5).
        CHECK(constrainer.constrainRequest({ 900, 420 }, { 600, 400 }) == juce::Point<int>(900, 600));
        // Mostly taller: the height's (1.25).
        CHECK(constrainer.constrainRequest({ 610, 500 }, { 600, 400 }) == juce::Point<int>(750, 500));
        // Within the zooms the limits allow: 0.5 to 2.
        CHECK(constrainer.constrainRequest({ 3000, 400 }, { 600, 400 }) == juce::Point<int>(1200, 800));
        CHECK(constrainer.constrainRequest({ 10, 10 }, { 600, 400 }) == juce::Point<int>(300, 200));
        // From a window of another shape (a host that ignored the ratio), the
        // current zoom is the smaller side's: the wider side asks for more.
        CHECK(constrainer.constrainRequest({ 1000, 400 }, { 1000, 400 }) == juce::Point<int>(1000, 667));
    }
}
