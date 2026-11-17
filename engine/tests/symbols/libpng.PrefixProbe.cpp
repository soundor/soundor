// Negative control for the prefix check: an object named like one of Skia's
// libpng objects that defines a name without the soundor_ prefix, so the check
// must fail on it. The prefixed one beside it must not be reported.

extern "C" int png_prefix_probe()
{
    return 0;
}

extern "C" int soundor_png_prefixed_probe()
{
    return 1;
}
