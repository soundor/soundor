#pragma once

#include <soundor/Config.h>
#include <soundor/ui/Input.h>

#include <chrono>
#include <cstdint>
#include <optional>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
{
    // Counts presses into series as PointerInput::clicks reports them, for a
    // platform that reports presses alone: a press of the same button as the
    // last, within the double-click time of it, near it, and not after a
    // drag, is the next of its series (2 the second of a double click).
    class ClickCounter
    {
    public:
        // How far (in the units positions come in) a press may be from the
        // last, and a pointer move while pressed, and still count.
        static constexpr float slop = 4;

        explicit ClickCounter(std::chrono::milliseconds doubleClickTime) noexcept;

        // A press at `time` (milliseconds of a clock that may wrap, as X
        // server time does): which of its series it is, 1 onwards.
        int press(int button, ui::Point position, std::uint32_t time) noexcept;
        // The pressed pointer moved: far enough, and the press is a drag,
        // which no later press continues.
        void move(ui::Point position) noexcept;
        void reset() noexcept;

    private:
        struct Press
        {
            int button = 0;
            ui::Point position;
            std::uint32_t time = 0;
            int count = 0;
            bool dragged = false;
        };
        std::uint32_t interval;
        std::optional<Press> last;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
