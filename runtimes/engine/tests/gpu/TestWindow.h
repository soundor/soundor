#pragma once

// A real window on screen for presentation tests: its native view (an
// NSView*, an HWND), or null where tests cannot make one.

namespace soundor::test
{
    [[nodiscard]] void* createTestWindow(int width, int height);
    void destroyTestWindow(void* view);
} // namespace soundor::test
