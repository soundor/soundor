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
    TEST_CASE("in a plugin it keeps the limits, and offers the ratio without enforcing it")
    {
        backend::JuceEditorConstrainer constrainer(false);
        limit(constrainer);
        // A size of another shape is kept: the UI is letterboxed in it.
        CHECK(resized(constrainer, { 0, 0, 1000, 400 }) == juce::Rectangle<int>(0, 0, 1000, 400));
        // The limits still hold.
        CHECK(resized(constrainer, { 0, 0, 100, 3000 }) == juce::Rectangle<int>(0, 0, 300, 800));
        // A host that asks (checkSizeConstraint) still reads the ratio.
        CHECK(constrainer.getFixedAspectRatio() == doctest::Approx(1.5));
    }

    TEST_CASE("in the Standalone it enforces the ratio too")
    {
        backend::JuceEditorConstrainer constrainer(true);
        limit(constrainer);
        const auto bounds = resized(constrainer, { 0, 0, 1000, 400 });
        // 3:2, to the nearest pixel.
        CHECK(std::abs(bounds.getWidth() - bounds.getHeight() * 1.5) <= 1.0);
    }
}
