#define DOCTEST_CONFIG_IMPLEMENT
#include "support/WindowsCrashDiagnostics.h"

#include <doctest/doctest.h>

int main(int argc, char** argv)
{
    [[maybe_unused]] const soundor::test::WindowsCrashDiagnostics diagnostics;
    doctest::Context context(argc, argv);
    return context.run();
}
