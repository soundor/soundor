// A C++-only consumer must resolve the entire Apple bridge from the archive,
// including class registration. Also exercised by prebuilt-check-debug.
#include <soundor/a11y/Platform.h>

int main()
{
    const auto bridge = soundor::a11y::createPlatformAccessibility({});
    return bridge == nullptr ? 0 : 1;
}
