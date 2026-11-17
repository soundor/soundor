#include "input/ClickCounter.h"

#include <doctest/doctest.h>

#include <chrono>

using namespace soundor;
using namespace soundor::input;

TEST_SUITE("native input: click counting")
{
    TEST_CASE("presses of one button in time and place make a series")
    {
        ClickCounter clicks(std::chrono::milliseconds(400));
        CHECK(clicks.press(0, { 10, 10 }, 1000) == 1);
        CHECK(clicks.press(0, { 11, 9 }, 1300) == 2);
        CHECK(clicks.press(0, { 12, 10 }, 1650) == 3);
        // Too late: a new series.
        CHECK(clicks.press(0, { 12, 10 }, 2100) == 1);
    }

    TEST_CASE("another button, another place or a drag starts again")
    {
        ClickCounter clicks(std::chrono::milliseconds(400));
        CHECK(clicks.press(0, { 10, 10 }, 0) == 1);
        CHECK(clicks.press(2, { 10, 10 }, 100) == 1);
        CHECK(clicks.press(0, { 10 + ClickCounter::slop + 1, 10 }, 200) == 1);
        CHECK(clicks.press(0, { 14, 10 }, 300) == 2);
        clicks.move({ 30, 10 });
        CHECK(clicks.press(0, { 14, 10 }, 350) == 1);
        // A small wobble while pressed is no drag.
        clicks.move({ 15, 11 });
        CHECK(clicks.press(0, { 14, 10 }, 400) == 2);
        clicks.reset();
        CHECK(clicks.press(0, { 14, 10 }, 450) == 1);
    }

    TEST_CASE("a clock that wraps between two presses still counts them")
    {
        ClickCounter clicks(std::chrono::milliseconds(500));
        CHECK(clicks.press(0, { 0, 0 }, 0xFFFFFF00U) == 1);
        CHECK(clicks.press(0, { 0, 0 }, 0x00000010U) == 2);
    }
}
