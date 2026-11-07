#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>
#include <soundor/render/Frame.h>

#include <array>
#include <cstdint>
#include <functional>
#include <limits>
#include <memory>
#include <optional>
#include <span>
#include <unordered_map>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    class Surface;
    class AnimationProgram;

    enum class AnimatedProperty : std::uint8_t
    {
        Opacity,
        TranslateX,
        TranslateY,
        Scale,
        ScaleX,
        ScaleY,
        Rotate,
        BackgroundColor,
        BorderColor,
        Count,
    };

    inline constexpr std::size_t animatedPropertyCount = static_cast<std::size_t>(AnimatedProperty::Count);

    // Ordered transforms, followed in array order, around the box's center.
    // Rotation is in radians; translations are logical pixels.
    struct Presentation
    {
        std::array<float, animatedPropertyCount> values { 1, 0, 0, 1, 1, 1, 0, 0, 0 };
        std::array<AnimatedProperty, 6> order {};
        // Straight sRGB RGBA in [0,1], interpolated channel by channel.
        std::array<std::array<float, 4>, 2> colors {};
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

    void mergeTransformOrder(Presentation& target, const Presentation& from);

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

    enum class Direction : std::uint8_t
    {
        Normal,
        Reverse,
        Alternate,
        AlternateReverse,
    };

    struct Timing
    {
        double duration = 300;
        double delay = 0;
        Easing easing = Easing::Linear;
        Fill fill = Fill::None;
        double iterations = 1;
        Direction direction = Direction::Normal;
    };

    struct SpringParameters
    {
        double stiffness = 100;
        double damping = 10;
        double mass = 1;
        double initialVelocity = 0; // property units per second
        double restDisplacement = 0.001;
        double restVelocity = 0.001;
    };

    struct SpringSample
    {
        double position = 0;
        double velocity = 0;
    };

    // Analytic damped oscillator, independent of tick frequency. Seconds in,
    // property units and units/second out; no numerical integration drift.
    [[nodiscard]] SpringSample sampleSpring(const SpringParameters& spring, double seconds, double origin,
                                            double target, double velocity) noexcept;
    void validateSpring(const SpringParameters& spring);

    using AnimationId = std::uint32_t;
    using PropertyMask = std::uint32_t;
    [[nodiscard]] constexpr PropertyMask propertyBit(AnimatedProperty property) noexcept
    {
        return PropertyMask { 1 } << static_cast<unsigned>(property);
    }
    inline constexpr PropertyMask transformPropertyMask = (propertyBit(AnimatedProperty::Rotate) << 1) - 2;
    inline constexpr PropertyMask paintPropertyMask =
        propertyBit(AnimatedProperty::BackgroundColor) | propertyBit(AnimatedProperty::BorderColor);

    struct Keyframe
    {
        Presentation value;
        double offset = 0;
        Easing easing = Easing::Linear;
        PropertyMask properties = 0;
    };

    enum class Composition : std::uint8_t
    {
        None,
        Sequence,
        Parallel,
        Stagger,
        Delay,
    };

    struct AnimationDescription
    {
        // A missing `from` starts at the current presentation (retargeting).
        std::optional<Presentation> from;
        Presentation to;
        PropertyMask properties = 0;
        Timing timing;
        std::optional<SpringParameters> spring;
        std::vector<Keyframe> keyframes;
        Composition composition = Composition::None;
        std::vector<AnimationDescription> children;
        std::optional<std::uint32_t> targetNode;
        double stagger = 0;
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

#if SOUNDOR_DEVTOOLS
    struct AnimationInspectionTarget
    {
        std::uint32_t node = 0;
        PropertyMask properties = 0;
        Presentation presentation;
    };
    struct AnimationInspection
    {
        AnimationId id = 0;
        std::uint32_t playbackGeneration = 0;
        PlaybackState state = PlaybackState::Running;
        double elapsed = 0;
        Timing timing;
        double delay = 0;
        bool program = false;
        std::optional<SpringParameters> spring;
        std::size_t keyframes = 0;
        std::vector<AnimationInspectionTarget> targets;
        bool targetsTruncated = false;
    };
    struct AnimationInspectionChange
    {
        AnimationId id = 0;
        std::uint32_t node = 0;
        std::uint32_t playbackGeneration = 0;
        PlaybackState state = PlaybackState::Running;
    };
#endif

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
        void seek(AnimationId id, double milliseconds);
        void removeNode(std::uint32_t node);
        [[nodiscard]] PlaybackState state(AnimationId id) const;
        [[nodiscard]] double currentTime(AnimationId id) const;
        [[nodiscard]] std::uint32_t generation(AnimationId id) const;
        [[nodiscard]] std::span<const AnimationCompletion> completions() const noexcept { return settled; }
        void clearCompletions() noexcept { settled.clear(); }
        [[nodiscard]] AnimationStatistics statistics() const noexcept { return counted; }
        [[nodiscard]] std::size_t size() const noexcept { return animations.size(); }
        // Explicit setup/reporting query; excludes allocator and hash-node overhead.
        [[nodiscard]] std::size_t storageBytes() const noexcept;
        void setClock(Clock provided);
        void setReducedMotion(bool reduced);
        [[nodiscard]] bool reducedMotion() const noexcept { return reduceMotion; }

#if SOUNDOR_DEVTOOLS
        [[nodiscard]] std::vector<AnimationInspection> inspect(std::uint32_t node = 0, bool* truncated = nullptr) const;
        void debugObserve(bool enabled);
        [[nodiscard]] bool debugRunning() const noexcept { return ! active.empty(); }
        [[nodiscard]] std::vector<AnimationInspectionChange> takeDebugChanges(bool& truncated);
#endif

        [[nodiscard]] static double ease(Easing easing, double progress) noexcept;

    private:
        friend class AnimationProgram;
        struct PropertyKeyframe
        {
            double offset = 0;
            Easing easing = Easing::Linear;
            std::array<float, 4> value {};
        };
        struct Animation
        {
            std::uint32_t node = 0;
            AnimationDescription description;
            Presentation from;
            double started = 0;
            double pausedAt = 0;
            double completedTime = 0;
            PlaybackState state = PlaybackState::Running;
            bool notified = false;
            std::uint32_t generation = 0;
            std::size_t activeIndex = std::numeric_limits<std::size_t>::max();
            std::array<double, animatedPropertyCount> velocity {};
            std::array<double, animatedPropertyCount> initialVelocity {};
            PropertyMask sampledProperties = 0;
            std::array<std::vector<PropertyKeyframe>, animatedPropertyCount> tracks;
            std::shared_ptr<AnimationProgram> program;
        };
        [[nodiscard]] Animation prepare(std::uint32_t node, const AnimationDescription& description, double time,
                                        const Presentation& initial,
                                        const std::array<double, animatedPropertyCount>& velocities,
                                        PropertyMask velocityMask);
        AnimationId animateProgram(std::uint32_t node, const AnimationDescription& description);
        [[nodiscard]] PropertyMask ownership(const Animation& animation, std::uint32_t node) const;
        void clearPresentation(const Animation& animation);
        void removeOwnership(AnimationId id, const Animation& animation);
        [[nodiscard]] double now();
        [[nodiscard]] Animation& get(AnimationId id);
        void sample(AnimationId id, Animation& animation, double time);
        void settle(AnimationId id, Animation& animation, bool cancelled);
        void reduce(Animation& animation);
        void present(const Animation& animation, double progress);
        [[nodiscard]] Presentation interpolate(const Animation& animation, double progress) const;
        [[nodiscard]] Presentation valueAt(Animation& animation, double elapsed);
        void activate(AnimationId id, Animation& animation);
        void deactivate(AnimationId id, Animation& animation);

#if SOUNDOR_DEVTOOLS
        void debugNotify(AnimationId id, const Animation& animation, PlaybackState state);
        bool debugObserved = false;
        bool debugOverflow = false;
        std::vector<AnimationInspectionChange> debugChanges;
#endif
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
