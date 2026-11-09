#include <soundor/backend/JuceInput.h>

#include <doctest/doctest.h>

#include <algorithm>

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

    TEST_CASE("cursors are the platform's own shapes")
    {
        CHECK(backend::mouseCursor(ui::Cursor::Default) == backend::arrowCursor());
        CHECK(backend::mouseCursor(ui::Cursor::None) == juce::MouseCursor::NoCursor);
        CHECK(backend::mouseCursor(ui::Cursor::Pointer) == juce::MouseCursor::PointingHandCursor);
        CHECK(backend::mouseCursor(ui::Cursor::Text) == juce::MouseCursor::IBeamCursor);
        CHECK(backend::mouseCursor(ui::Cursor::Move) == juce::MouseCursor::UpDownLeftRightResizeCursor);
        CHECK(backend::mouseCursor(ui::Cursor::EwResize) == juce::MouseCursor::LeftRightResizeCursor);
        CHECK(backend::mouseCursor(ui::Cursor::NwseResize) == juce::MouseCursor::TopLeftCornerResizeCursor);
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

    TEST_CASE("a press reports JUCE's click count, which the platform's double-click time sets")
    {
        juce::ScopedJuceInitialiser_GUI gui;
        juce::Component editor;
        editor.setBounds(0, 0, 400, 300);
        const auto now = juce::Time::getCurrentTime();
        const auto event = [&](int clicks)
        {
            return juce::MouseEvent(juce::Desktop::getInstance().getMainMouseSource(), { 10, 20 },
                                    juce::ModifierKeys::leftButtonModifier, 0, 0, 0, 0, 0, &editor, &editor, now,
                                    { 10, 20 }, now, clicks, false);
        };
        CHECK(backend::pointerInput(event(1), ui::PointerInput::Phase::Down).clicks == 1);
        CHECK(backend::pointerInput(event(2), ui::PointerInput::Phase::Down).clicks == 2);
        CHECK(backend::pointerInput(event(0), ui::PointerInput::Phase::Down).clicks == 1);

        // JUCE's own 400 ms unless the platform says otherwise, and never
        // beyond what a person could mean.
        const auto before = juce::MouseEvent::getDoubleClickTimeout();
        backend::useDoubleClickTime();
        const auto platform = backend::platformDoubleClickTime();
        if (platform)
            CHECK(juce::MouseEvent::getDoubleClickTimeout() == std::clamp(*platform, 100, 5000));
        else
            CHECK(juce::MouseEvent::getDoubleClickTimeout() == before);
        juce::MouseEvent::setDoubleClickTimeout(before);
    }

    TEST_CASE("a pointer's screen position is in the editor's logical pixels, however the host scales it")
    {
        juce::ScopedJuceInitialiser_GUI gui;
        juce::Component window;
        juce::Component editor;
        window.setBounds(0, 0, 2000, 2000);
        window.addAndMakeVisible(editor);
        editor.setBounds(100, 50, 400, 300);
        // A host at a display scale of 2 (setScaleFactor).
        editor.setTransform(juce::AffineTransform::scale(2.0F));
        const auto now = juce::Time::getCurrentTime();
        const juce::MouseEvent event(juce::Desktop::getInstance().getMainMouseSource(), { 10, 20 }, {}, 0, 0, 0, 0, 0,
                                     &editor, &editor, now, { 10, 20 }, now, 1, false);
        const auto input = backend::pointerInput(event, ui::PointerInput::Phase::Move);
        CHECK(input.position.x == 10);
        REQUIRE(input.screen.has_value());
        // 110×70 of the editor's pixels from the screen's corner (220×140 of
        // the screen's own).
        const auto screen = input.screen.value_or(ui::Point {});
        CHECK(screen.x == doctest::Approx(110));
        CHECK(screen.y == doctest::Approx(70));
    }
}
