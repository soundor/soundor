#include <soundor/ui/Animation.h>
#include <soundor/ui/Surface.h>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    namespace
    {
        render::Transform multiply(const render::Transform& x, const render::Transform& y) noexcept
        {
            return { x.a * y.a + x.c * y.b, x.b * y.a + x.d * y.b,       x.a * y.c + x.c * y.d,
                     x.b * y.c + x.d * y.d, x.a * y.e + x.c * y.f + x.e, x.b * y.e + x.d * y.f + x.f };
        }
        double monotonicMilliseconds()
        {
            return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch())
                .count();
        }
        bool retains(Fill fill)
        {
            return fill == Fill::Forwards || fill == Fill::Both;
        }
        double activeDuration(const Timing& timing)
        {
            return timing.duration == 0 || timing.iterations == 0 ? 0 : timing.duration * timing.iterations;
        }
        double directedProgress(const Timing& timing, double elapsed)
        {
            double iteration = 0, progress = 0;
            const double total = activeDuration(timing);
            if (timing.iterations != 0)
            {
                if (timing.duration == 0)
                    progress = 1;
                else if (std::isfinite(total) && elapsed >= total)
                {
                    iteration = std::max(0.0, std::ceil(timing.iterations) - 1);
                    progress = timing.iterations - iteration;
                }
                else
                {
                    const double overall = std::max(0.0, elapsed) / timing.duration;
                    iteration = std::floor(overall);
                    progress = overall - iteration;
                }
            }
            const bool alternate =
                timing.direction == Direction::Alternate || timing.direction == Direction::AlternateReverse;
            const bool reversed =
                timing.direction == Direction::Reverse || timing.direction == Direction::AlternateReverse;
            return reversed != (alternate && std::fmod(iteration, 2) == 1) ? 1 - progress : progress;
        }
    } // namespace

    void mergeTransformOrder(Presentation& target, const Presentation& from)
    {
        const auto validateOrder = [](const Presentation& value)
        {
            PropertyMask seen = 0;
            if (value.count > value.order.size())
                throw std::invalid_argument("invalid transform order");
            for (std::size_t i = 0; i < value.count; ++i)
            {
                const auto property = value.order[i];
                if (property <= AnimatedProperty::Opacity || property > AnimatedProperty::Rotate
                    || (seen & propertyBit(property)) != 0)
                    throw std::invalid_argument("invalid transform order");
                seen |= propertyBit(property);
            }
        };
        validateOrder(from);
        validateOrder(target);
        // Preserve common operations' order. Missing operations interpolate
        // to identity, and new operations start at identity, without a flash.
        std::size_t previousCommon = 0;
        bool hasCommon = false;
        for (std::size_t i = 0; i < from.count; ++i)
        {
            const auto end = target.order.begin() + static_cast<std::ptrdiff_t>(target.count);
            const auto found = std::find(target.order.begin(), end, from.order[i]);
            if (found == end)
                continue;
            const auto index = static_cast<std::size_t>(found - target.order.begin());
            if (hasCommon && index < previousCommon)
                throw std::invalid_argument("retargeted transforms must preserve shared operation order");
            hasCommon = true;
            previousCommon = index;
        }
        for (std::size_t i = 0; i < from.count; ++i)
        {
            const auto end = target.order.begin() + static_cast<std::ptrdiff_t>(target.count);
            if (std::find(target.order.begin(), end, from.order[i]) != end)
                continue;
            std::size_t insert = target.count;
            for (std::size_t later = i + 1; later < from.count; ++later)
            {
                const auto next = std::find(target.order.begin(), end, from.order[later]);
                if (next != end)
                {
                    insert = static_cast<std::size_t>(next - target.order.begin());
                    break;
                }
            }
            for (std::size_t at = target.count; at > insert; --at)
                target.order[at] = target.order[at - 1];
            target.order[insert] = from.order[i];
            ++target.count;
        }
    }

    void validateSpring(const SpringParameters& spring)
    {
        if (! std::isfinite(spring.stiffness) || spring.stiffness <= 0 || ! std::isfinite(spring.damping)
            || spring.damping <= 0 || ! std::isfinite(spring.mass) || spring.mass <= 0
            || ! std::isfinite(spring.initialVelocity) || ! std::isfinite(spring.restDisplacement)
            || spring.restDisplacement <= 0 || ! std::isfinite(spring.restVelocity) || spring.restVelocity <= 0)
            throw std::invalid_argument("spring parameters must be finite, with positive physics and rest thresholds");
        const double rate = spring.damping / (2 * spring.mass);
        const double frequencySquared = spring.stiffness / spring.mass;
        if (! std::isfinite(rate) || rate <= 0 || ! std::isfinite(rate * rate) || ! std::isfinite(frequencySquared)
            || frequencySquared <= 0)
            throw std::invalid_argument("spring parameters exceed the supported numeric range");
    }

    SpringSample sampleSpring(const SpringParameters& spring, double seconds, double origin, double target,
                              double velocity) noexcept
    {
        if (seconds <= 0)
            return { origin, velocity };
        const double displacement = origin - target;
        const double rate = spring.damping / (2 * spring.mass);
        const double frequencySquared = spring.stiffness / spring.mass;
        const double discriminant = rate * rate - frequencySquared;
        const double tolerance = 1e-10 * std::max(rate * rate, frequencySquared);
        double position = 0, speed = 0;
        if (std::abs(discriminant) <= tolerance)
        {
            const double coefficient = velocity + rate * displacement;
            const double decay = std::exp(-rate * seconds);
            position = decay * (displacement + coefficient * seconds);
            speed = decay * (coefficient - rate * (displacement + coefficient * seconds));
        }
        else if (discriminant < 0)
        {
            const double frequency = std::sqrt(-discriminant);
            const double coefficient = (velocity + rate * displacement) / frequency;
            const double cosine = std::cos(frequency * seconds), sine = std::sin(frequency * seconds);
            const double decay = std::exp(-rate * seconds);
            position = decay * (displacement * cosine + coefficient * sine);
            speed = decay
                    * ((coefficient * frequency - rate * displacement) * cosine
                       - (displacement * frequency + rate * coefficient) * sine);
        }
        else
        {
            const double root = std::sqrt(discriminant);
            // This form avoids cancellation of the slow root for heavy damping.
            const double slow = -frequencySquared / (rate + root), fast = -rate - root;
            const double coefficient = (velocity - fast * displacement) / (slow - fast);
            const double slowValue = coefficient * std::exp(slow * seconds);
            const double fastValue = (displacement - coefficient) * std::exp(fast * seconds);
            position = slowValue + fastValue;
            speed = slow * slowValue + fast * fastValue;
        }
        return { target + position, speed };
    }

    namespace
    {
        double springDuration(const SpringParameters& spring, double origin, double target, double velocity)
        {
            const double displacement = origin - target;
            const double rate = spring.damping / (2 * spring.mass);
            const double frequencySquared = spring.stiffness / spring.mass;
            const double discriminant = rate * rate - frequencySquared;
            const double tolerance = 1e-10 * std::max(rate * rate, frequencySquared);
            // Bound both coordinates' envelopes, so completion does not occur
            // merely because an oscillation happens to cross its target.
            const auto atRest = [&](double seconds)
            {
                double distance = 0, speed = 0;
                if (std::abs(discriminant) <= tolerance)
                {
                    const double coefficient = std::abs(velocity + rate * displacement);
                    const double decay = std::exp(-rate * seconds);
                    distance = (std::abs(displacement) + coefficient * seconds) * decay;
                    speed = (coefficient + rate * std::abs(displacement) + rate * coefficient * seconds) * decay;
                }
                else if (discriminant < 0)
                {
                    const double frequency = std::sqrt(-discriminant);
                    const double coefficient = (velocity + rate * displacement) / frequency;
                    const double decay = std::exp(-rate * seconds);
                    distance = std::hypot(displacement, coefficient) * decay;
                    speed = std::hypot(coefficient * frequency - rate * displacement,
                                       displacement * frequency + rate * coefficient)
                            * decay;
                }
                else
                {
                    const double root = std::sqrt(discriminant);
                    const double slow = -frequencySquared / (rate + root), fast = -rate - root;
                    const double coefficient = (velocity - fast * displacement) / (slow - fast);
                    const double slowValue = std::abs(coefficient) * std::exp(slow * seconds);
                    const double fastValue = std::abs(displacement - coefficient) * std::exp(fast * seconds);
                    distance = slowValue + fastValue;
                    speed = -slow * slowValue - fast * fastValue;
                }
                return distance <= spring.restDisplacement && speed <= spring.restVelocity;
            };
            if (displacement == 0 && velocity == 0)
                return 0;
            double high = std::max(0.001, 2 / rate);
            while (! atRest(high))
            {
                high *= 2;
                if (! std::isfinite(high) || high > std::numeric_limits<double>::max() / 1000)
                    throw std::invalid_argument("spring has no finite supported settling time");
            }
            double low = std::abs(discriminant) <= tolerance ? std::min(high, 2 / rate) : 0;
            for (int i = 0; i < 48; ++i)
            {
                const double middle = (low + high) / 2;
                if (atRest(middle))
                    high = middle;
                else
                    low = middle;
            }
            return std::ceil(high * 1000);
        }
    } // namespace

    render::Transform Presentation::transform(float width, float height) const noexcept
    {
        if (count == 0)
            return {};
        render::Transform result = render::Transform::translate(width / 2, height / 2);
        for (std::size_t i = 0; i < count; ++i)
        {
            const AnimatedProperty property = order[i];
            const float value = (*this)[property];
            render::Transform operation;
            switch (property)
            {
                case AnimatedProperty::TranslateX:
                    operation.e = value;
                    break;
                case AnimatedProperty::TranslateY:
                    operation.f = value;
                    break;
                case AnimatedProperty::Scale:
                    operation.a = value;
                    operation.d = value;
                    break;
                case AnimatedProperty::ScaleX:
                    operation.a = value;
                    break;
                case AnimatedProperty::ScaleY:
                    operation.d = value;
                    break;
                case AnimatedProperty::Rotate:
                    operation = { std::cos(value), std::sin(value), -std::sin(value), std::cos(value), 0, 0 };
                    break;
                case AnimatedProperty::Opacity:
                case AnimatedProperty::BackgroundColor:
                case AnimatedProperty::BorderColor:
                case AnimatedProperty::Count:
                    break;
            }
            result = multiply(result, operation);
        }
        return multiply(result, render::Transform::translate(-width / 2, -height / 2));
    }

    namespace
    {
        std::size_t descriptionStorage(const AnimationDescription& description) noexcept
        {
            std::size_t bytes = description.keyframes.capacity() * sizeof(Keyframe)
                                + description.children.capacity() * sizeof(AnimationDescription);
            for (const auto& child : description.children)
                bytes += descriptionStorage(child);
            return bytes;
        }
    } // namespace

    // Compiled once. The existing timeline owns the program's playback and
    // completion; internal phases never enter JavaScript or another scheduler.
    class AnimationProgram
    {
    public:
        struct Target
        {
            std::uint32_t node = 0;
            PropertyMask properties = 0;
            Presentation initial;
            Presentation final;
            std::array<double, animatedPropertyCount> velocity {};
            PropertyMask velocityMask = 0;
            PropertyMask prepared = 0;
        };

        AnimationProgram(AnimationTimeline& owner, std::uint32_t node, const AnimationDescription& description,
                         double time)
            : timeline(owner), rootDelay(description.timing.delay), fill(description.timing.fill)
        {
            collect(description, node, 0);
            phases.reserve(phaseCount);
            for (Target& target : targets)
                if (const auto known = timeline.byNode.find(target.node); known != timeline.byNode.end())
                    for (const AnimationId id : known->second)
                        timeline.sample(id, timeline.get(id), time);
            for (Target& target : targets)
            {
                target.initial = timeline.surface.presentation(target.node);
                target.final = target.initial;
                if (const auto known = timeline.byNode.find(target.node); known != timeline.byNode.end())
                    for (const AnimationId id : known->second)
                    {
                        const auto& previous = timeline.get(id);
                        const auto* source = previous.program ? previous.program->find(target.node) : nullptr;
                        if (! source && ! previous.description.spring)
                            continue;
                        const PropertyMask mask = source ? source->properties : previous.description.properties;
                        const auto& velocities = source ? source->velocity : previous.velocity;
                        for (std::size_t i = 0; i < animatedPropertyCount; ++i)
                            if ((mask & (PropertyMask { 1 } << i)) != 0)
                            {
                                target.velocity[i] = velocities[i];
                                target.velocityMask |= PropertyMask { 1 } << i;
                            }
                    }
            }
            root = compile(description, node);
        }

        [[nodiscard]] std::size_t storageBytes() const noexcept
        {
            std::size_t bytes = sizeof(*this) + targets.capacity() * sizeof(Target) + phases.capacity() * sizeof(Phase);
            for (const auto& phase : phases)
            {
                bytes += phase.children.capacity() * sizeof(std::size_t) + phase.starts.capacity() * sizeof(double)
                         + phase.owned.capacity() * sizeof(std::pair<std::uint32_t, PropertyMask>);
                if (phase.effect)
                {
                    bytes += descriptionStorage(phase.effect->description);
                    for (const auto& track : phase.effect->tracks)
                        bytes += track.capacity() * sizeof(AnimationTimeline::PropertyKeyframe);
                }
            }
            return bytes;
        }
        [[nodiscard]] double duration() const { return phases[root].span; }
        [[nodiscard]] const Target* find(std::uint32_t node) const
        {
            const auto found = targetIndex.find(node);
            return found == targetIndex.end() ? nullptr : &targets[found->second];
        }
        void sample(double time, bool reduced = false)
        {
            if (reduced)
            {
                for (Target& target : targets)
                {
                    timeline.surface.setPresentation(target.node, target.initial, target.properties);
                    target.velocity.fill(0);
                }
                finishReduced(root);
                initialized = false;
                return;
            }
            if (time < rootDelay && fill != Fill::Both && fill != Fill::Backwards)
                return;
            const bool reconstruct = changed(root, time) || ! initialized;
            if (reconstruct)
                for (Target& target : targets)
                    timeline.surface.setPresentation(target.node, target.initial, target.properties);
            apply(root, time, reconstruct);
            initialized = true;
        }
        [[nodiscard]] double reducedDuration() const { return finiteSpan(root); }
        void clearVelocity() noexcept
        {
            for (Target& target : targets)
                target.velocity.fill(0);
        }
        std::vector<Target> targets;

    private:
        struct Phase
        {
            Composition composition = Composition::None;
            std::optional<AnimationTimeline::Animation> effect;
            std::vector<std::size_t> children;
            std::vector<double> starts;
            std::vector<std::pair<std::uint32_t, PropertyMask>> owned;
            Timing timing;
            double span = 0;
            double cachedIteration = -1;
            double cachedTime = -1;
            std::size_t appliedChild = std::numeric_limits<std::size_t>::max();
            std::size_t cachedChild = std::numeric_limits<std::size_t>::max();
            std::size_t target = 0;
        };
        static void merge(Presentation& target, const Presentation& value, PropertyMask mask)
        {
            for (std::size_t i = 0; i < animatedPropertyCount; ++i)
                if ((mask & (PropertyMask { 1 } << i)) != 0)
                    target.values[i] = value.values[i];
            if ((mask & transformPropertyMask) != 0)
            {
                target.order = value.order;
                target.count = value.count;
            }
            for (std::size_t color = 0; color < 2; ++color)
                if ((mask & (propertyBit(AnimatedProperty::BackgroundColor) << color)) != 0)
                    target.colors[color] = value.colors[color];
        }
        void collect(const AnimationDescription& description, std::uint32_t inherited, unsigned depth)
        {
            if (depth > 64 || ++phaseCount > 16384)
                throw std::invalid_argument("animation composition exceeds its depth or phase limit");
            const std::uint32_t node = description.targetNode.value_or(inherited);
            if (description.composition == Composition::None)
            {
                if (! description.children.empty())
                    throw std::invalid_argument("leaf animation effects cannot contain child phases");
                if (timeline.surface.find(node) == nullptr)
                    throw std::invalid_argument("unknown animation target");
                auto [entry, added] = targetIndex.emplace(node, targets.size());
                if (added)
                    targets.push_back({ node });
                targets[entry->second].properties |= description.properties;
            }
            else
            {
                if (description.composition != Composition::Delay && description.children.empty())
                    throw std::invalid_argument("animation composition requires child effects");
                for (const auto& child : description.children)
                    collect(child, node, depth + 1);
            }
        }
        std::size_t compile(const AnimationDescription& description, std::uint32_t inherited)
        {
            const std::uint32_t node = description.targetNode.value_or(inherited);
            const std::size_t index = phases.size();
            phases.emplace_back();
            Phase& phase = phases[index]; // capacity reserved by collect
            phase.composition = description.composition;
            phase.timing = description.timing;
            if (! std::isfinite(phase.timing.delay) || phase.timing.delay < 0 || std::isnan(phase.timing.iterations)
                || phase.timing.iterations < 0 || ! std::isfinite(description.stagger) || description.stagger < 0)
                throw std::invalid_argument("composition timing must be finite and nonnegative");
            if (description.composition == Composition::None)
            {
                phase.target = targetIndex.at(node);
                phase.owned.emplace_back(node, description.properties);
                Target& target = targets[phase.target];
                phase.effect = timeline.prepare(node, description, 0, target.final, target.velocity,
                                                target.velocityMask & ~target.prepared);
                target.prepared |= description.properties;
                phase.timing = phase.effect->description.timing;
                const double end = activeDuration(phase.timing);
                const Presentation final =
                    std::isfinite(end) ? timeline.valueAt(*phase.effect, end) : timeline.interpolate(*phase.effect, 1);
                merge(target.final, final, description.properties);
            }
            else if (description.composition == Composition::Delay)
            {
                if (! description.children.empty() || ! std::isfinite(phase.timing.duration)
                    || phase.timing.duration < 0)
                    throw std::invalid_argument("delay phases require a finite nonnegative duration and no children");
            }
            else
            {
                std::vector<Presentation> before;
                before.reserve(targets.size());
                for (const Target& target : targets)
                    before.push_back(target.final);
                double cursor = 0;
                std::unordered_map<std::uint32_t, PropertyMask> siblings;
                for (std::size_t i = 0; i < description.children.size(); ++i)
                {
                    const std::size_t child = compile(description.children[i], node);
                    phase.children.push_back(child);
                    const double start = description.composition == Composition::Sequence ? cursor
                                         : description.composition == Composition::Stagger
                                             ? description.stagger * static_cast<double>(i)
                                             : 0;
                    phase.starts.push_back(start);
                    if (description.composition == Composition::Sequence)
                    {
                        if (! std::isfinite(cursor))
                            throw std::invalid_argument("an infinite sequence phase must be last");
                        cursor += phases[child].span;
                    }
                    else
                    {
                        cursor = std::max(cursor, start + phases[child].span);
                        // Parallel phases have independent ownership on each node.
                        for (const auto& [target, used] : phases[child].owned)
                        {
                            if ((siblings[target] & used) != 0)
                                throw std::invalid_argument(
                                    "parallel phases require disjoint properties on each target");
                            siblings[target] |= used;
                        }
                    }
                    for (const auto& [target, mask] : phases[child].owned)
                    {
                        const auto found =
                            std::ranges::find(phase.owned, target, &std::pair<std::uint32_t, PropertyMask>::first);
                        if (found == phase.owned.end())
                            phase.owned.emplace_back(target, mask);
                        else
                            found->second |= mask;
                    }
                }
                phase.timing.duration = cursor;
                for (std::size_t i = 0; i < targets.size(); ++i)
                    targets[i].final = before[i];
                const double end = activeDuration(phase.timing) + phase.timing.delay;
                if (std::isfinite(end))
                    applyVirtual(index, end);
            }
            if (! std::isfinite(phase.timing.duration)
                && (phase.timing.iterations != 1 || phase.timing.direction != Direction::Normal))
                throw std::invalid_argument("infinite compositions require normal direction and one outer iteration");
            phase.span = activeDuration(phase.timing) + phase.timing.delay;
            if (std::isnan(phase.span))
                throw std::invalid_argument("composition duration is outside the supported range");
            return index;
        }
        struct Position
        {
            double time = 0;
            double iteration = 0;
        };
        static Position position(const Phase& phase, double time)
        {
            const double elapsed = std::max(0.0, time - phase.timing.delay);
            if (! std::isfinite(phase.timing.duration))
                return { elapsed, 0 };
            const double total = activeDuration(phase.timing);
            const bool finished = elapsed >= total - 1e-7;
            const double iteration = phase.timing.duration == 0 ? 0
                                     : finished && std::isfinite(total)
                                         ? std::max(0.0, std::ceil(phase.timing.iterations) - 1)
                                         : std::floor(elapsed / phase.timing.duration);
            return { AnimationTimeline::ease(phase.timing.easing,
                                             directedProgress(phase.timing, finished ? total : elapsed))
                         * phase.timing.duration,
                     iteration };
        }
        static std::size_t selected(const Phase& phase, double time)
        {
            const auto next = std::upper_bound(phase.starts.begin(), phase.starts.end(), time);
            return next == phase.starts.begin() ? 0 : static_cast<std::size_t>(next - phase.starts.begin() - 1);
        }
        bool changed(std::size_t index, double time)
        {
            Phase& phase = phases[index];
            const Position current = position(phase, time);
            bool result = phase.cachedIteration >= 0 && current.iteration != phase.cachedIteration;
            result = result || (phase.cachedTime >= 0 && current.time < phase.cachedTime);
            phase.cachedIteration = current.iteration;
            phase.cachedTime = current.time;
            if (phase.children.empty())
                return result;
            if (phase.composition == Composition::Sequence)
            {
                const std::size_t child = selected(phase, current.time);
                result = result
                         || (phase.cachedChild != std::numeric_limits<std::size_t>::max() && child < phase.cachedChild);
                phase.cachedChild = child;
                return changed(phase.children[child], current.time - phase.starts[child]) || result;
            }
            for (std::size_t i = 0; i < phase.children.size(); ++i)
                if (current.time >= phase.starts[i])
                    result = changed(phase.children[i], current.time - phase.starts[i]) || result;
            return result;
        }
        void apply(std::size_t index, double time, bool reconstruct, double rate = 1)
        {
            Phase& phase = phases[index];
            if (phase.effect)
            {
                auto& effect = *phase.effect;
                const Presentation value =
                    timeline.valueAt(effect, std::max(0.0, time - effect.description.timing.delay));
                Target& target = targets[phase.target];
                timeline.surface.setPresentation(target.node, value, effect.description.properties);
                for (std::size_t i = 0; i < animatedPropertyCount; ++i)
                    if ((effect.description.properties & (PropertyMask { 1 } << i)) != 0)
                        target.velocity[i] = time < effect.description.timing.delay || time >= phase.span
                                                 ? 0
                                                 : effect.velocity[i] * rate;
                return;
            }
            if (phase.children.empty())
                return;
            const auto current = position(phase, time);
            const double local = current.time;
            if (std::isfinite(phase.timing.duration) && phase.timing.duration > 0)
            {
                const auto direction = phase.timing.direction;
                const bool reversed =
                    (direction == Direction::Reverse || direction == Direction::AlternateReverse)
                    != ((direction == Direction::Alternate || direction == Direction::AlternateReverse)
                        && std::fmod(current.iteration, 2) == 1);
                rate *= reversed ? -1 : 1;
                if (phase.timing.easing != Easing::Linear)
                {
                    const double progress = directedProgress(phase.timing, std::max(0.0, time - phase.timing.delay));
                    const double low = std::max(0.0, progress - 1e-5), high = std::min(1.0, progress + 1e-5);
                    rate *= (AnimationTimeline::ease(phase.timing.easing, high)
                             - AnimationTimeline::ease(phase.timing.easing, low))
                            / (high - low);
                }
            }
            if (phase.composition == Composition::Sequence)
            {
                const std::size_t child = selected(phase, local);
                // Ordinary forward phase changes finalize only the departed
                // phases. Seeks/reverse/repeats reconstruct the earlier prefix.
                const std::size_t first = reconstruct ? 0 : std::min(phase.appliedChild, child);
                for (std::size_t i = first; i < child; ++i)
                    apply(phase.children[i], phases[phase.children[i]].span, true, rate);
                apply(phase.children[child], local - phase.starts[child], reconstruct, rate);
                phase.appliedChild = child;
            }
            else
                for (std::size_t i = 0; i < phase.children.size(); ++i)
                    if (local >= phase.starts[i])
                        apply(phase.children[i], local - phase.starts[i], reconstruct, rate);
        }
        // Setup-only reconstruction determines the next phase's implicit
        // origin, including a preceding group's reverse/fractional endpoint.
        void applyVirtual(std::size_t index, double time)
        {
            Phase& phase = phases[index];
            if (phase.effect)
            {
                auto& effect = *phase.effect;
                const auto value = timeline.valueAt(effect, std::max(0.0, time - effect.description.timing.delay));
                merge(targets[phase.target].final, value, effect.description.properties);
                return;
            }
            const double local = position(phase, time).time;
            for (std::size_t i = 0; i < phase.children.size(); ++i)
            {
                if (local < phase.starts[i])
                    break;
                const auto child = phase.children[i];
                applyVirtual(child, std::min(local - phase.starts[i], phases[child].span));
                if (phase.composition == Composition::Sequence && local < phase.starts[i] + phases[child].span)
                    break;
            }
        }
        double finiteSpan(std::size_t index) const
        {
            const Phase& phase = phases[index];
            if (std::isfinite(phase.span))
                return phase.span;
            double duration = phase.timing.duration;
            if (! phase.effect && ! phase.children.empty())
            {
                duration = 0;
                for (std::size_t i = 0; i < phase.children.size(); ++i)
                    if (phase.composition == Composition::Sequence)
                        duration += finiteSpan(phase.children[i]);
                    else
                        duration = std::max(duration, phase.starts[i] + finiteSpan(phase.children[i]));
            }
            return duration + phase.timing.delay;
        }
        void finishReduced(std::size_t index)
        {
            Phase& phase = phases[index];
            if (std::isfinite(phase.span))
                apply(index, phase.span, true);
            else if (phase.effect)
            {
                auto& effect = *phase.effect;
                const double iterations = effect.description.timing.iterations;
                effect.description.timing.iterations = 1;
                const auto value = timeline.valueAt(effect, activeDuration(effect.description.timing));
                effect.description.timing.iterations = iterations;
                timeline.surface.setPresentation(effect.node, value, effect.description.properties);
            }
            else
                for (const auto child : phase.children)
                    finishReduced(child);
        }
        AnimationTimeline& timeline;
        std::unordered_map<std::uint32_t, std::size_t> targetIndex;
        std::vector<Phase> phases;
        std::size_t phaseCount = 0;
        std::size_t root = 0;
        double rootDelay = 0;
        Fill fill = Fill::None;
        bool initialized = false;
    };

    AnimationTimeline::AnimationTimeline(Surface& target, Clock provided)
        : surface(target), clock(provided ? std::move(provided) : Clock([] { return monotonicMilliseconds(); }))
    {
    }

    std::size_t AnimationTimeline::storageBytes() const noexcept
    {
        std::size_t bytes = sizeof(*this) + animations.size() * sizeof(Animation)
                            + active.capacity() * sizeof(AnimationId)
                            + settled.capacity() * sizeof(AnimationCompletion);
        for (const auto& [id, animation] : animations)
        {
            (void)id;
            bytes += descriptionStorage(animation.description);
            for (const auto& track : animation.tracks)
                bytes += track.capacity() * sizeof(PropertyKeyframe);
            if (animation.program)
                bytes += animation.program->storageBytes();
        }
        for (const auto& [node, ids] : byNode)
        {
            (void)node;
            bytes += ids.capacity() * sizeof(AnimationId);
        }
        return bytes;
    }

    void AnimationTimeline::setClock(Clock provided)
    {
        if (! animations.empty())
            throw std::logic_error("cannot replace an active animation clock");
        if (! provided)
            throw std::invalid_argument("animation clock must be callable");
        clock = std::move(provided);
        lastTime = 0;
    }

    double AnimationTimeline::now()
    {
        const double time = clock();
        if (! std::isfinite(time))
            throw std::invalid_argument("animation clock must be finite");
        lastTime = std::max(lastTime, time);
        return lastTime;
    }

    double AnimationTimeline::ease(Easing easing, double progress) noexcept
    {
        const double x = std::clamp(progress, 0.0, 1.0);
        if (easing == Easing::Linear || x == 0 || x == 1)
            return x;
        // CSS's standard cubic Beziers, solved by bounded bisection.
        double x1 = 0.25, y1 = 0.1, x2 = 0.25, y2 = 1;
        if (easing == Easing::EaseIn)
        {
            x1 = 0.42;
            y1 = 0;
            x2 = 1;
        }
        else if (easing == Easing::EaseOut)
        {
            x1 = 0;
            y1 = 0;
            x2 = 0.58;
        }
        else if (easing == Easing::EaseInOut)
        {
            x1 = 0.42;
            y1 = 0;
            x2 = 0.58;
        }
        const auto cubic = [](double t, double first, double second)
        {
            const double inverse = 1 - t;
            return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t;
        };
        double low = 0, high = 1;
        for (int i = 0; i < 24; ++i)
        {
            const double middle = (low + high) / 2;
            if (cubic(middle, x1, x2) < x)
                low = middle;
            else
                high = middle;
        }
        return cubic((low + high) / 2, y1, y2);
    }

    AnimationTimeline::Animation AnimationTimeline::prepare(std::uint32_t node, const AnimationDescription& description,
                                                            double time, const Presentation& initial,
                                                            const std::array<double, animatedPropertyCount>& velocities,
                                                            PropertyMask velocityMask)
    {
        if (surface.find(node) == nullptr)
            throw std::invalid_argument("unknown animation node");
        const Timing& timing = description.timing;
        if (description.spring)
        {
            validateSpring(*description.spring);
            if ((description.properties & paintPropertyMask) != 0)
                throw std::invalid_argument("spring effects support numeric opacity and transform properties");
        }
        if (! std::isfinite(timing.duration) || timing.duration < 0 || ! std::isfinite(timing.delay)
            || timing.delay < 0)
            throw std::invalid_argument("animation duration and delay must be finite and nonnegative");
        if (std::isnan(timing.iterations) || timing.iterations < 0
            || (std::isfinite(timing.iterations) && ! std::isfinite(activeDuration(timing))))
            throw std::invalid_argument(
                "animation iterations require a nonnegative count and supported total duration");
        constexpr PropertyMask valid = (PropertyMask { 1 } << animatedPropertyCount) - 1;
        if (description.properties == 0 || (description.properties & ~valid) != 0)
            throw std::invalid_argument("animation must name supported properties");
        if (description.to.count > description.to.order.size())
            throw std::invalid_argument("invalid transform order");
        for (std::size_t i = 0; i < animatedPropertyCount; ++i)
            if (! std::isfinite(description.to.values[i])
                || (description.from && ! std::isfinite(description.from->values[i])))
                throw std::invalid_argument("animation values must be finite");
        if ((description.properties & paintPropertyMask) != 0)
            for (std::size_t color = 0; color < description.to.colors.size(); ++color)
                for (std::size_t channel = 0; channel < description.to.colors[color].size(); ++channel)
                {
                    const float target = description.to.colors[color][channel];
                    const float origin = description.from ? description.from->colors[color][channel] : 0;
                    if (! std::isfinite(target) || target < 0 || target > 1 || ! std::isfinite(origin) || origin < 0
                        || origin > 1)
                        throw std::invalid_argument("animation colors require finite channels in [0,1]");
                }
        Presentation from = description.from.value_or(initial);
        AnimationDescription normalized = description;
        std::array<double, animatedPropertyCount> inheritedVelocity {};
        if (description.spring)
        {
            inheritedVelocity.fill(description.spring->initialVelocity);
            if (! description.from)
                for (std::size_t i = 0; i < animatedPropertyCount; ++i)
                    if ((velocityMask & description.properties & (PropertyMask { 1 } << i)) != 0)
                        inheritedVelocity[i] = velocities[i];
        }
        auto& target = normalized.to;
        mergeTransformOrder(target, from);
        PropertyMask sampledProperties = description.properties & propertyBit(AnimatedProperty::Opacity);
        for (std::size_t i = 0; i < target.count; ++i)
            sampledProperties |= propertyBit(target.order[i]);
        sampledProperties &= description.properties;
        if (description.spring)
        {
            normalized.timing.duration = 0;
            for (std::size_t i = 0; i < animatedPropertyCount; ++i)
                if ((sampledProperties & (PropertyMask { 1 } << i)) != 0)
                    normalized.timing.duration =
                        std::max(normalized.timing.duration, springDuration(*description.spring, from.values[i],
                                                                            target.values[i], inheritedVelocity[i]));
                else
                    inheritedVelocity[i] = 0;
        }
        Animation animation { node, normalized, from, time };
        animation.velocity = inheritedVelocity;
        animation.initialVelocity = inheritedVelocity;
        animation.sampledProperties = sampledProperties;
        if (! normalized.keyframes.empty())
        {
            double previousOffset = -1;
            for (const Keyframe& frame : normalized.keyframes)
            {
                if (! std::isfinite(frame.offset) || frame.offset < previousOffset || frame.offset < 0
                    || frame.offset > 1 || (frame.properties & ~normalized.properties) != 0)
                    throw std::invalid_argument("animation keyframe offsets must be ordered within [0,1]");
                previousOffset = frame.offset;
                for (std::size_t i = 0; i < animatedPropertyCount; ++i)
                {
                    if ((frame.properties & (PropertyMask { 1 } << i)) == 0)
                        continue;
                    const auto channel =
                        i < 7 ? std::array<float, 4> { frame.value.values[i], 0, 0, 0 } : frame.value.colors[i - 7];
                    if (! std::ranges::all_of(channel, [](float value) { return std::isfinite(value); }))
                        throw std::invalid_argument("animation keyframe values must be finite");
                    animation.tracks[i].push_back({ frame.offset, frame.easing, channel });
                }
            }
            for (std::size_t i = 0; i < animatedPropertyCount; ++i)
            {
                auto& track = animation.tracks[i];
                if (track.empty())
                    continue;
                if (track.front().offset > 0)
                    track.insert(track.begin(),
                                 { 0, Easing::Linear,
                                   i < 7 ? std::array<float, 4> { from.values[i], 0, 0, 0 } : from.colors[i - 7] });
                if (track.back().offset < 1)
                    track.push_back({ 1, Easing::Linear, track.back().value });
            }
        }
        return animation;
    }

    PropertyMask AnimationTimeline::ownership(const Animation& animation, std::uint32_t node) const
    {
        if (animation.program)
        {
            const auto* target = animation.program->find(node);
            return target ? target->properties : 0;
        }
        return animation.node == node ? animation.description.properties : 0;
    }

    void AnimationTimeline::clearPresentation(const Animation& animation)
    {
        if (animation.program)
            for (const auto& target : animation.program->targets)
                surface.clearPresentation(target.node, target.properties);
        else
            surface.clearPresentation(animation.node, animation.description.properties);
    }

    void AnimationTimeline::removeOwnership(AnimationId id, const Animation& animation)
    {
        const auto remove = [&](std::uint32_t node)
        {
            const auto known = byNode.find(node);
            if (known == byNode.end())
                return;
            std::erase(known->second, id);
            if (known->second.empty())
                byNode.erase(known);
        };
        if (animation.program)
            for (const auto& target : animation.program->targets)
                remove(target.node);
        remove(animation.node);
    }

    AnimationId AnimationTimeline::animateProgram(std::uint32_t node, const AnimationDescription& description)
    {
        if (surface.find(node) == nullptr)
            throw std::invalid_argument("unknown animation node");
        if (nextId == std::numeric_limits<AnimationId>::max())
            throw std::overflow_error("animation ids exhausted");
        const double time = now();
        auto program = std::make_shared<AnimationProgram>(*this, node, description, time);
        std::vector<AnimationId> conflicts;
        for (const auto& target : program->targets)
            if (const auto known = byNode.find(target.node); known != byNode.end())
                for (const AnimationId id : known->second)
                    if ((ownership(get(id), target.node) & target.properties) != 0)
                        conflicts.push_back(id);
        std::ranges::sort(conflicts);
        const auto duplicate = std::ranges::unique(conflicts);
        conflicts.erase(duplicate.begin(), duplicate.end());
        for (const AnimationId id : conflicts)
        {
            Animation& previous = get(id);
            if (! previous.notified)
                settled.push_back({ id, true, previous.generation });
            const auto abandon = [&](std::uint32_t target, PropertyMask mask)
            {
                const auto* next = program->find(target);
                surface.clearPresentation(target, mask & ~(next ? next->properties : 0));
            };
            if (previous.program)
                for (const auto& target : previous.program->targets)
                    abandon(target.node, target.properties);
            else
                abandon(previous.node, previous.description.properties);
            deactivate(id, previous);
            removeOwnership(id, previous);
            animations.erase(id);
        }
        Animation animation;
        animation.node = node;
        animation.started = time;
        animation.description.timing.duration = program->duration();
        animation.description.timing.fill = description.timing.fill;
        animation.program = std::move(program);
        if (description.timing.delay > 0
            && (description.timing.fill == Fill::None || description.timing.fill == Fill::Forwards))
            clearPresentation(animation);
        const AnimationId id = nextId++;
        const auto [at, inserted] = animations.emplace(id, std::move(animation));
        (void)inserted;
        byNode[node].push_back(id);
        for (const auto& target : at->second.program->targets)
            if (target.node != node)
                byNode[target.node].push_back(id);
        activate(id, at->second);
        sample(id, at->second, time);
        return id;
    }

    AnimationId AnimationTimeline::animate(std::uint32_t node, const AnimationDescription& description)
    {
        if (description.composition != Composition::None)
            return animateProgram(node, description);
        node = description.targetNode.value_or(node);
        if (nextId == std::numeric_limits<AnimationId>::max())
            throw std::overflow_error("animation ids exhausted");
        if (surface.find(node) == nullptr)
            throw std::invalid_argument("unknown animation node");
        // Sample before taking the origin, preserving a mid-flight retarget.
        const double time = now();
        std::array<double, animatedPropertyCount> velocities {};
        PropertyMask velocityMask = 0;
        if (const auto known = byNode.find(node); known != byNode.end())
            for (const AnimationId id : known->second)
            {
                Animation& previous = get(id);
                sample(id, previous, time);
                const auto* source = previous.program ? previous.program->find(node) : nullptr;
                if (previous.description.spring || source)
                    for (std::size_t i = 0; i < animatedPropertyCount; ++i)
                        if ((ownership(previous, node) & (PropertyMask { 1 } << i)) != 0)
                        {
                            velocities[i] = source ? source->velocity[i] : previous.velocity[i];
                            velocityMask |= PropertyMask { 1 } << i;
                        }
            }
        Animation animation = prepare(node, description, time, surface.presentation(node), velocities, velocityMask);
        const Timing& timing = animation.description.timing;
        std::vector<AnimationId> conflicts;
        if (const auto known = byNode.find(node); known != byNode.end())
            for (const AnimationId id : known->second)
                if ((ownership(get(id), node) & description.properties) != 0)
                    conflicts.push_back(id);
        for (const AnimationId id : conflicts)
        {
            Animation& previous = get(id);
            if (! previous.notified)
                settled.push_back({ id, true, previous.generation });
            // Transfer overlapping presentation ownership atomically: its
            // cached pixels remain valid. Only abandoned properties revert.
            if (previous.program)
                for (const auto& target : previous.program->targets)
                    surface.clearPresentation(target.node,
                                              target.properties & ~(target.node == node ? description.properties : 0));
            else
                surface.clearPresentation(node, previous.description.properties & ~description.properties);
            deactivate(id, previous);
            removeOwnership(id, previous);
            animations.erase(id);
        }
        if (timing.delay > 0 && (timing.fill == Fill::None || timing.fill == Fill::Forwards))
            surface.clearPresentation(node, description.properties);
        if (nextId == std::numeric_limits<AnimationId>::max())
            throw std::overflow_error("animation ids exhausted");
        const AnimationId id = nextId++;
        const auto [at, inserted] = animations.emplace(id, std::move(animation));
        (void)inserted;
        byNode[node].push_back(id);
        activate(id, at->second);
        sample(id, at->second, time);
        return id;
    }

    AnimationTimeline::Animation& AnimationTimeline::get(AnimationId id)
    {
        const auto at = animations.find(id);
        if (at == animations.end())
            throw std::invalid_argument("unknown animation");
        return at->second;
    }

    Presentation AnimationTimeline::interpolate(const Animation& animation, double progress) const
    {
        Presentation value = animation.description.to;
        for (std::size_t i = 0; i < animatedPropertyCount; ++i)
            value.values[i] =
                static_cast<float>(static_cast<double>(animation.from.values[i])
                                   + progress * (static_cast<double>(value.values[i]) - animation.from.values[i]));
        for (std::size_t color = 0; color < value.colors.size(); ++color)
            for (std::size_t channel = 0; channel < value.colors[color].size(); ++channel)
                value.colors[color][channel] = static_cast<float>(
                    animation.from.colors[color][channel]
                    + progress * (value.colors[color][channel] - animation.from.colors[color][channel]));
        for (std::size_t i = 0; i < animatedPropertyCount; ++i)
        {
            const auto& track = animation.tracks[i];
            if (track.empty())
                continue;
            const auto upper =
                std::upper_bound(track.begin(), track.end(), progress,
                                 [](double offset, const PropertyKeyframe& frame) { return offset < frame.offset; });
            const auto& lower = upper == track.begin() ? track.front() : *std::prev(upper);
            const auto& next = upper == track.end() ? track.back() : *upper;
            const double local = next.offset == lower.offset
                                     ? 0
                                     : ease(lower.easing, (progress - lower.offset) / (next.offset - lower.offset));
            const std::size_t channels = i < 7 ? 1 : 4;
            for (std::size_t channel = 0; channel < channels; ++channel)
            {
                const auto interpolated =
                    static_cast<float>(static_cast<double>(lower.value[channel])
                                       + local * (static_cast<double>(next.value[channel]) - lower.value[channel]));
                if (i < 7)
                    value.values[i] = interpolated;
                else
                    value.colors[i - 7][channel] = interpolated;
            }
        }
        return value;
    }

    void AnimationTimeline::present(const Animation& animation, double progress)
    {
        surface.setPresentation(animation.node, interpolate(animation, progress), animation.description.properties);
    }

    Presentation AnimationTimeline::valueAt(Animation& animation, double elapsed)
    {
        const Timing& timing = animation.description.timing;
        const double total = activeDuration(timing);
        const bool completed = total == 0 || elapsed >= total - 1e-7;
        const double progress = directedProgress(timing, completed ? total : elapsed);
        if (! animation.description.spring || (completed && (progress == 0 || progress == 1)))
        {
            animation.velocity.fill(0);
            return interpolate(animation, ease(timing.easing, progress));
        }
        Presentation value = animation.description.to;
        const double iteration = completed ? std::max(0.0, std::ceil(timing.iterations) - 1)
                                           : std::floor(std::max(0.0, elapsed) / timing.duration);
        const bool alternate =
            timing.direction == Direction::Alternate || timing.direction == Direction::AlternateReverse;
        const bool reversed = timing.direction == Direction::Reverse || timing.direction == Direction::AlternateReverse;
        const double sign = reversed != (alternate && std::fmod(iteration, 2) == 1) ? -1 : 1;
        for (std::size_t i = 0; i < animatedPropertyCount; ++i)
        {
            if ((animation.sampledProperties & (PropertyMask { 1 } << i)) == 0)
                continue;
            if (animation.from.values[i] == value.values[i] && animation.initialVelocity[i] == 0)
            {
                animation.velocity[i] = 0;
                continue;
            }
            const auto state = sampleSpring(*animation.description.spring, progress * timing.duration / 1000,
                                            animation.from.values[i], value.values[i], animation.initialVelocity[i]);
            value.values[i] =
                static_cast<float>(std::clamp(state.position, -static_cast<double>(std::numeric_limits<float>::max()),
                                              static_cast<double>(std::numeric_limits<float>::max())));
            animation.velocity[i] = completed ? 0 : sign * state.velocity;
        }
        return value;
    }

    void AnimationTimeline::activate(AnimationId id, Animation& animation)
    {
        if (animation.activeIndex != std::numeric_limits<std::size_t>::max())
            return;
        animation.activeIndex = active.size();
        active.push_back(id);
    }

    void AnimationTimeline::deactivate(AnimationId id, Animation& animation)
    {
        if (animation.activeIndex == std::numeric_limits<std::size_t>::max())
            return;
        const std::size_t index = animation.activeIndex;
        const AnimationId last = active.back();
        active[index] = last;
        get(last).activeIndex = index;
        active.pop_back();
        animation.activeIndex = std::numeric_limits<std::size_t>::max();
        (void)id;
    }

    void AnimationTimeline::settle(AnimationId id, Animation& animation, bool cancelled)
    {
        deactivate(id, animation);
        const double duration = activeDuration(animation.description.timing) + animation.description.timing.delay;
        animation.completedTime = std::isfinite(duration) ? duration
                                  : animation.program
                                      ? animation.program->reducedDuration()
                                      : animation.description.timing.duration + animation.description.timing.delay;
        animation.velocity.fill(0);
        if (animation.program)
            animation.program->clearVelocity();
        animation.state = cancelled ? PlaybackState::Cancelled : PlaybackState::Finished;
        if (! animation.notified)
        {
            settled.push_back({ id, cancelled, animation.generation });
            animation.notified = true;
        }
        if (cancelled || ! retains(animation.description.timing.fill))
            clearPresentation(animation);
    }

    void AnimationTimeline::sample(AnimationId id, Animation& animation, double time)
    {
        if (animation.state != PlaybackState::Running)
            return;
        const Timing& timing = animation.description.timing;
        const double elapsed = time - animation.started - timing.delay;
        if (elapsed < 0 && ! reduceMotion)
        {
            if (timing.fill == Fill::Backwards || timing.fill == Fill::Both)
                present(animation, directedProgress(timing, 0));
            return;
        }
        // Fixed-step clocks can land a fraction of a nanosecond below an
        // endpoint. Do not accumulate a whole extra tick on every reversal.
        const double total = activeDuration(timing);
        const bool completed = reduceMotion || total == 0 || elapsed >= total - 1e-7;
        if (reduceMotion)
            reduce(animation);
        else if (animation.program)
            animation.program->sample(completed ? total : elapsed);
        else
            surface.setPresentation(animation.node, valueAt(animation, completed ? total : elapsed),
                                    animation.description.properties);
        if (completed)
            settle(id, animation, false);
    }

    void AnimationTimeline::tick()
    {
        if (active.empty())
            return;
        const auto begin = std::chrono::steady_clock::now();
        const double time = now();
        ++counted.updates;
        for (std::size_t index = 0; index < active.size();)
        {
            const AnimationId id = active[index];
            Animation& animation = get(id);
            ++counted.activeSamples;
            sample(id, animation, time);
            if (index < active.size() && active[index] == id)
                ++index;
        }
        counted.nanoseconds += static_cast<std::uint64_t>(
            std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now() - begin).count());
    }

    void AnimationTimeline::pause(AnimationId id)
    {
        Animation& animation = get(id);
        const double time = now();
        sample(id, animation, time);
        if (animation.state != PlaybackState::Running)
            return;
        deactivate(id, animation);
        animation.pausedAt = time;
        animation.state = PlaybackState::Paused;
    }

    void AnimationTimeline::play(AnimationId id)
    {
        Animation& animation = get(id);
        const double time = now();
        if (animation.state == PlaybackState::Paused)
            animation.started += time - animation.pausedAt;
        else if (animation.state != PlaybackState::Running)
        {
            animation.started = time;
            animation.notified = false;
            ++animation.generation;
        }
        animation.state = PlaybackState::Running;
        activate(id, animation);
        sample(id, animation, time);
    }

    void AnimationTimeline::cancel(AnimationId id)
    {
        Animation& animation = get(id);
        settle(id, animation, true);
        removeOwnership(id, animation);
        animations.erase(id);
    }

    void AnimationTimeline::finish(AnimationId id)
    {
        Animation& animation = get(id);
        if (animation.state == PlaybackState::Finished)
            return;
        const double total = activeDuration(animation.description.timing);
        if (! std::isfinite(total))
            throw std::invalid_argument("cannot finish an animation with infinite iterations");
        if (animation.program)
            animation.program->sample(total);
        else
            surface.setPresentation(animation.node, valueAt(animation, total), animation.description.properties);
        settle(id, animation, false);
    }

    void AnimationTimeline::seek(AnimationId id, double milliseconds)
    {
        if (! std::isfinite(milliseconds) || milliseconds < 0)
            throw std::invalid_argument("animation currentTime must be finite and nonnegative");
        Animation& animation = get(id);
        const double time = now();
        const double duration = activeDuration(animation.description.timing) + animation.description.timing.delay;
        const double position = std::min(milliseconds, duration);
        const bool paused = animation.state != PlaybackState::Running;
        if (animation.state == PlaybackState::Finished && position < duration)
        {
            animation.notified = false;
            ++animation.generation;
        }
        animation.started = time - position;
        animation.state = PlaybackState::Running;
        sample(id, animation, time);
        if (animation.state == PlaybackState::Running)
        {
            if (paused)
            {
                animation.pausedAt = time;
                animation.state = PlaybackState::Paused;
                deactivate(id, animation);
            }
            else
                activate(id, animation);
        }
    }

    void AnimationTimeline::removeNode(std::uint32_t node)
    {
        const auto known = byNode.find(node);
        if (known == byNode.end())
            return;
        const std::vector<AnimationId> ids = known->second;
        for (const AnimationId id : ids)
            if (animations.contains(id))
                cancel(id);
    }

    PlaybackState AnimationTimeline::state(AnimationId id) const
    {
        const auto at = animations.find(id);
        return at == animations.end() ? PlaybackState::Cancelled : at->second.state;
    }

    std::uint32_t AnimationTimeline::generation(AnimationId id) const
    {
        const auto at = animations.find(id);
        return at == animations.end() ? 0 : at->second.generation;
    }

    double AnimationTimeline::currentTime(AnimationId id) const
    {
        const auto at = animations.find(id);
        if (at == animations.end())
            return 0;
        const Animation& animation = at->second;
        if (animation.state == PlaybackState::Finished)
            return animation.completedTime;
        const double time = animation.state == PlaybackState::Paused ? animation.pausedAt : std::max(lastTime, clock());
        return std::clamp(time - animation.started, 0.0,
                          activeDuration(animation.description.timing) + animation.description.timing.delay);
    }

    void AnimationTimeline::reduce(Animation& animation)
    {
        if (animation.program)
            animation.program->sample(0, true);
        else
        {
            const double iterations = animation.description.timing.iterations;
            if (! std::isfinite(iterations))
                animation.description.timing.iterations = 1;
            const Presentation value = valueAt(animation, activeDuration(animation.description.timing));
            animation.description.timing.iterations = iterations;
            surface.setPresentation(animation.node, value, animation.description.properties);
        }
        animation.velocity.fill(0);
    }

    void AnimationTimeline::setReducedMotion(bool reduced)
    {
        reduceMotion = reduced;
        if (reduced)
            for (auto& [id, animation] : animations)
                if (animation.state == PlaybackState::Running || animation.state == PlaybackState::Paused)
                {
                    reduce(animation);
                    settle(id, animation, false);
                }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
