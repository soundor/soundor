#include <soundor/input/PointerLock.h>

#include <algorithm>
#include <cmath>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
{
    namespace
    {
        class NativeSource final : public PointerLock::Source
        {
        public:
            explicit NativeSource(PlatformInput& native) : input(native) {}

            [[nodiscard]] bool isDragging() const override { return input.buttons() != 0; }
            [[nodiscard]] ui::Point screenPosition() const override
            {
                return input.pointerOnScreen().value_or(ui::Point {});
            }
            void setScreenPosition(ui::Point position) override { input.warpPointer(position); }

        private:
            PlatformInput& input;
        };

        float distance(ui::Point a, ui::Point b)
        {
            return std::hypot(a.x - b.x, a.y - b.y);
        }
    } // namespace

    std::unique_ptr<PointerLock::Source> pointerSource(PlatformInput& input, int pointerId)
    {
        if (pointerId != 1)
            return nullptr;
        return std::make_unique<NativeSource>(input);
    }

    PointerLock::PointerLock(Sources provided) : sources(std::move(provided)) {}

    PointerLock::~PointerLock()
    {
        release();
    }

    void PointerLock::update(std::optional<int> pointerId, ui::Point where)
    {
        std::unique_ptr<Source> source = pointerId ? sources(*pointerId) : nullptr;
        // A drag the platform ended without a release ends the lock too.
        const bool wanted = source != nullptr && source->isDragging();
        if (locked && (! pointerId || ! wanted || *locked != *pointerId))
            release();
        if (wanted && ! locked)
        {
            startOnScreen = source->screenPosition();
            start = where;
            offset = {};
            locked = pointerId;
        }
    }

    ui::Point PointerLock::follow(int pointerId, ui::Point position, ui::Point size)
    {
        if (! locked || *locked != pointerId)
            return position;
        const ui::Point continued { position.x + offset.x, position.y + offset.y };
        // It may stray short of the view's nearest edge (at most 100 points,
        // so a fast move between two events stays in too).
        const float room = std::min({ start.x, start.y, size.x - start.x, size.y - start.y });
        if (distance(position, start) > std::clamp(room - 8.0f, 1.0f, 100.0f))
        {
            // Back where the lock began; positions carry on from there.
            offset.x += position.x - start.x;
            offset.y += position.y - start.y;
            if (auto source = sources(pointerId))
                source->setScreenPosition(startOnScreen);
        }
        return continued;
    }

    void PointerLock::release()
    {
        if (! locked)
            return;
        const int pointerId = *locked;
        locked.reset();
        if (auto source = sources(pointerId))
            source->setScreenPosition(startOnScreen);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input
