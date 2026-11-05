#include <soundor/backend/JuceRasterScale.h>

#include <doctest/doctest.h>

using namespace soundor;

TEST_SUITE("CPU resize raster density")
{
    TEST_CASE("continuous resizing keeps its pixels until the size has been still")
    {
        backend::JuceRasterScale scale;
        CHECK(scale.update(1, 800, 600, 0) == 1);
        CHECK(scale.update(1.1F, 880, 660, 10) == 1);
        CHECK(scale.update(1.2F, 960, 720, 70) == 1);
        CHECK(scale.update(1.3F, 1040, 780, 130) == 1);
        CHECK(scale.update(1.3F, 1040, 780, 229) == 1);
        CHECK(scale.update(1.3F, 1040, 780, 230) == 1.3F);
    }

    TEST_CASE("a pause sharpens once and resizing can continue")
    {
        backend::JuceRasterScale scale;
        CHECK(scale.update(1, 800, 600, 0) == 1);
        CHECK(scale.update(1.5F, 1200, 900, 10) == 1);
        CHECK(scale.update(1.5F, 1200, 900, 110) == 1.5F);
        CHECK(scale.update(2, 1600, 1200, 120) == 1.5F);
        CHECK(scale.update(2, 1600, 1200, 220) == 2);
    }

    TEST_CASE("the first size and a density that changes alone take effect at once when still")
    {
        backend::JuceRasterScale scale;
        CHECK(scale.update(2, 1600, 1200, 0) == 2);
        CHECK(scale.update(1.25F, 1600, 1200, 200) == 1.25F);
    }
}
