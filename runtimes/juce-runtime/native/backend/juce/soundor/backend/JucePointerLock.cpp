#include "JucePointerLock.h"

#include <algorithm>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    namespace
    {
        class DesktopSource final : public PointerLock::Source
        {
        public:
            explicit DesktopSource(juce::MouseInputSource mouse) : source(std::move(mouse)) {}

            [[nodiscard]] bool isDragging() const override { return source.isDragging(); }
            [[nodiscard]] juce::Point<float> screenPosition() const override { return source.getScreenPosition(); }
            void setScreenPosition(juce::Point<float> position) override { source.setScreenPosition(position); }

        private:
            juce::MouseInputSource source;
        };

        std::unique_ptr<PointerLock::Source> desktopSource(int pointerId)
        {
            auto* source = juce::Desktop::getInstance().getMouseSource(pointerId - 1);
            if (source == nullptr || ! source->isMouse())
                return nullptr;
            return std::make_unique<DesktopSource>(*source);
        }
    } // namespace

    PointerLock::PointerLock() : PointerLock(desktopSource) {}

    PointerLock::PointerLock(Sources provided) : sources(std::move(provided)) {}

    PointerLock::~PointerLock()
    {
        release();
    }

    void PointerLock::update(std::optional<int> pointerId, juce::Point<float> where)
    {
        std::unique_ptr<Source> source = pointerId ? sources(*pointerId) : nullptr;
        // A drag the platform ended without a release ends the lock too.
        const bool wanted = source != nullptr && source->isDragging();
        if (locked && (! wanted || *locked != *pointerId))
            release();
        if (wanted && ! locked)
        {
            startOnScreen = source->screenPosition();
            start = where;
            offset = {};
            locked = pointerId;
        }
    }

    juce::Point<float> PointerLock::follow(int pointerId, juce::Point<float> position, juce::Point<float> size)
    {
        if (! locked || *locked != pointerId)
            return position;
        const juce::Point<float> continued = position + offset;
        // It may stray short of the view's nearest edge (at most 100 points,
        // so a fast move between two events stays in too).
        const float room = std::min({ start.x, start.y, size.x - start.x, size.y - start.y });
        if (position.getDistanceFrom(start) > std::clamp(room - 8.0f, 1.0f, 100.0f))
        {
            // Back where the lock began; positions carry on from there.
            offset += position - start;
            if (auto source = sources(pointerId))
                source->setScreenPosition(startOnScreen);
        }
        return continued;
    }

    void PointerLock::release()
    {
        if (! locked)
            return;
        if (auto source = sources(*std::exchange(locked, std::nullopt)))
            source->setScreenPosition(startOnScreen);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
