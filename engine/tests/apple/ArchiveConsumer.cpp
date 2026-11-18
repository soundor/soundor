// A C++-only consumer must resolve the entire Apple bridge from the archive,
// including class registration. Also exercised by prebuilt-check-debug.
#include <soundor/a11y/Platform.h>
#include <soundor/input/Platform.h>

int main()
{
    const auto bridge = soundor::a11y::createPlatformAccessibility({});
    const auto input = soundor::input::createPlatformInput({});
    return bridge == nullptr && input == nullptr ? 0 : 1;
}
