#include "JucePointerLock.h"

#include <juce_gui_basics/juce_gui_basics.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    namespace
    {
        class DesktopSource final : public input::PointerLock::Source
        {
        public:
            explicit DesktopSource(const juce::MouseInputSource& mouse) : source(mouse) {}

            [[nodiscard]] bool isDragging() const override { return source.isDragging(); }
            [[nodiscard]] ui::Point screenPosition() const override
            {
                const auto at = source.getScreenPosition();
                return { at.x, at.y };
            }
            void setScreenPosition(ui::Point position) override
            {
                source.setScreenPosition({ position.x, position.y });
            }

        private:
            juce::MouseInputSource source;
        };
    } // namespace

    std::unique_ptr<input::PointerLock::Source> desktopPointerSource(int pointerId)
    {
        auto* source = juce::Desktop::getInstance().getMouseSource(pointerId - 1);
        if (source == nullptr || ! source->isMouse())
            return nullptr;
        return std::make_unique<DesktopSource>(*source);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
