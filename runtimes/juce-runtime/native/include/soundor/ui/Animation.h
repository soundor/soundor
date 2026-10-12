#pragma once

#include <soundor/Config.h>
#include <soundor/render/Frame.h>

#include <array>
#include <cstdint>
#include <functional>
#include <limits>
#include <optional>
#include <span>
#include <unordered_map>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    class Surface;

    enum class AnimatedProperty : std::uint8_t
    {
        Opacity,
        TranslateX,
        TranslateY,
        Scale,
        ScaleX,
        ScaleY,
        Rotate,
        Count,
    };

    inline constexpr std::size_t animatedPropertyCount = static_cast<std::size_t>(AnimatedProperty::Count);

    // Ordered transforms, followed in array order, around the box's center.
    // Rotation is in radians; translations are logical pixels.
    struct Presentation
    {
        std::array<float, animatedPropertyCount> values { 1, 0, 0, 1, 1, 1, 0 };
        std::array<AnimatedProperty, animatedPropertyCount - 1> order {};
        std::size_t count = 0;

        [[nodiscard]] float& operator[](AnimatedProperty property) noexcept
        {
            return values[static_cast<std::size_t>(property)];
        }
        [[nodiscard]] float operator[](AnimatedProperty property) const noexcept
        {
            return values[static_cast<std::size_t>(property)];
        }
        [[nodiscard]] render::Transform transform(float width, float height) const noexcept;
        friend bool operator==(const Presentation&, const Presentation&) = default;
    };

    enum class Easing : std::uint8_t
    {
        Linear,
        Ease,
        EaseIn,
        EaseOut,
        EaseInOut,
    };

    enum class Fill : std::uint8_t
    {
        None,
        Backwards,
        Forwards,
        Both,
    };

    enum class PlaybackState : std::uint8_t
    {
        Running,
        Paused,
        Finished,
        Cancelled,
    };

    struct Timing
    {
        double duration = 300;
        double delay = 0;
        Easing easing = Easing::Linear;
        Fill fill = Fill::None;
    };

    using AnimationId = std::uint32_t;
    using PropertyMask = std::uint32_t;
    [[nodiscard]] constexpr PropertyMask propertyBit(AnimatedProperty property) noexcept
    {
        return PropertyMask { 1 } << static_cast<unsigned>(property);
    }

    struct AnimationDescription
    {
        // A missing `from` starts at the current presentation (retargeting).
        std::optional<Presentation> from;
        Presentation to;
        PropertyMask properties = 0;
        Timing timing;
    };

    struct AnimationCompletion
    {
        AnimationId id = 0;
        bool cancelled = false;
        std::uint32_t generation = 0;
    };

    struct AnimationStatistics
    {
        std::uint64_t updates = 0;
        std::uint64_t activeSamples = 0;
        std::uint64_t nanoseconds = 0;
    };

    // No interpreter types or callbacks. Owned by one surface and advanced
    // only from its host's existing UI tick, never an audio thread.
    class AnimationTimeline
    {
    public:
        using Clock = std::function<double()>; // monotonic milliseconds
        explicit AnimationTimeline(Surface& target, Clock provided = {});
        AnimationId animate(std::uint32_t node, const AnimationDescription& description);
        void tick();
        void pause(AnimationId id);
        void play(AnimationId id);
        void cancel(AnimationId id);
        void finish(AnimationId id);
        void removeNode(std::uint32_t node);
        [[nodiscard]] PlaybackState state(AnimationId id) const;
        [[nodiscard]] double currentTime(AnimationId id) const;
        [[nodiscard]] std::uint32_t generation(AnimationId id) const;
        [[nodiscard]] std::span<const AnimationCompletion> completions() const noexcept { return settled; }
        void clearCompletions() noexcept { settled.clear(); }
        [[nodiscard]] AnimationStatistics statistics() const noexcept { return counted; }
        [[nodiscard]] std::size_t size() const noexcept { return animations.size(); }
        void setClock(Clock provided);
        void setReducedMotion(bool reduced);
        [[nodiscard]] bool reducedMotion() const noexcept { return reduceMotion; }

        [[nodiscard]] static double ease(Easing easing, double progress) noexcept;

    private:
        struct Animation
        {
            std::uint32_t node = 0;
            AnimationDescription description;
            Presentation from;
            double started = 0;
            double pausedAt = 0;
            PlaybackState state = PlaybackState::Running;
            bool notified = false;
            std::uint32_t generation = 0;
            std::size_t activeIndex = std::numeric_limits<std::size_t>::max();
        };
        [[nodiscard]] double now();
        [[nodiscard]] Animation& get(AnimationId id);
        void sample(AnimationId id, Animation& animation, double time);
        void settle(AnimationId id, Animation& animation, bool cancelled);
        void present(const Animation& animation, double progress);
        void activate(AnimationId id, Animation& animation);
        void deactivate(AnimationId id, Animation& animation);

        Surface& surface;
        Clock clock;
        double lastTime = 0;
        AnimationId nextId = 1;
        std::unordered_map<AnimationId, Animation> animations;
        std::unordered_map<std::uint32_t, std::vector<AnimationId>> byNode;
        std::vector<AnimationId> active;
        std::vector<AnimationCompletion> settled;
        AnimationStatistics counted;
        bool reduceMotion = false;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
