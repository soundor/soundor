#include <soundor/backend/JuceInput.h>

#include <doctest/doctest.h>

using namespace soundor;

namespace
{
    juce::KeyPress press(int code, juce::ModifierKeys modifiers = {}, juce::juce_wchar character = 0)
    {
        return juce::KeyPress(code, modifiers, character);
    }

    juce::MouseWheelDetails wheel(float deltaX, float deltaY, bool smooth)
    {
        juce::MouseWheelDetails details {};
        details.deltaX = deltaX;
        details.deltaY = deltaY;
        details.isSmooth = smooth;
        return details;
    }
} // namespace

TEST_SUITE("JUCE input")
{
    TEST_CASE("named keys get their Web names")
    {
        CHECK(backend::keyName(press(juce::KeyPress::returnKey)) == "Enter");
        CHECK(backend::keyName(press(juce::KeyPress::leftKey)) == "ArrowLeft");
        CHECK(backend::keyName(press(juce::KeyPress::escapeKey)) == "Escape");
        CHECK(backend::keyName(press(juce::KeyPress::spaceKey, {}, ' ')) == " ");
        CHECK(backend::keyName(press(juce::KeyPress::F1Key)) == "F1");
        CHECK(backend::keyName(press(juce::KeyPress::F12Key)) == "F12");
        CHECK(backend::keyName(press(juce::KeyPress::pageDownKey)) == "PageDown");
    }

    TEST_CASE("character keys are their character, also under shortcuts")
    {
        CHECK(backend::keyName(press('a', {}, 'a')) == "a");
        CHECK(backend::keyName(press('a', juce::ModifierKeys::shiftModifier, 'A')) == "A");
        CHECK(backend::keyName(press('A', juce::ModifierKeys::commandModifier)) == "a");
        CHECK(backend::keyName(press('A', juce::ModifierKeys::commandModifier | juce::ModifierKeys::shiftModifier))
              == "A");
        CHECK(backend::keyName(press('1', {}, U'é')) == "é");
        CHECK(backend::keyName(press(0x7fffffff)).empty());
    }

    TEST_CASE("only plain and AltGr characters type text")
    {
        CHECK(backend::typedText(press('a', {}, 'a')) == "a");
        CHECK(backend::typedText(press('a', juce::ModifierKeys::shiftModifier, 'A')) == "A");
        CHECK(backend::typedText(press(juce::KeyPress::returnKey, {}, '\r')).empty());
        CHECK(backend::typedText(press('s', juce::ModifierKeys::commandModifier, 's')).empty());
        CHECK(backend::typedText(press(juce::KeyPress::backspaceKey, {}, 8)).empty());
#if ! JUCE_MAC
        CHECK(backend::typedText(press('q', juce::ModifierKeys::ctrlModifier | juce::ModifierKeys::altModifier, '@'))
              == "@");
#endif
    }

    TEST_CASE("modifiers and buttons")
    {
        const juce::ModifierKeys keys(juce::ModifierKeys::shiftModifier | juce::ModifierKeys::altModifier
                                      | juce::ModifierKeys::leftButtonModifier
                                      | juce::ModifierKeys::middleButtonModifier);
        CHECK(backend::modifiersOf(keys) == (ui::Modifier::Shift | ui::Modifier::Alt));
        CHECK(backend::buttonsOf(keys) == 5u);
        CHECK(backend::buttonsOf(juce::ModifierKeys(juce::ModifierKeys::rightButtonModifier)) == 2u);
    }

    TEST_CASE("wheel deltas point the Web's way: pixels when smooth, three lines a notch otherwise")
    {
        const auto smooth = backend::wheelInput({ 3, 4 }, {}, wheel(0, 0.5f / 256.0f * 10.0f, true));
        CHECK(smooth.unit == ui::WheelInput::Unit::Pixel);
        CHECK(smooth.deltaY == doctest::Approx(-10));
        CHECK(smooth.position.x == 3);

#if JUCE_WINDOWS
        const float notch = 120.0f / 256.0f;
#elif JUCE_MAC
        const float notch = 10.0f / 256.0f;
#else
        const float notch = 50.0f / 256.0f;
#endif
        const auto stepped = backend::wheelInput({}, {}, wheel(0, -notch, false));
        CHECK(stepped.unit == ui::WheelInput::Unit::Line);
        CHECK(stepped.deltaY == doctest::Approx(3)); // one notch towards the user scrolls down
        CHECK(backend::wheelInput({}, {}, wheel(-notch, 0, false)).deltaX == doctest::Approx(3));
    }
}
