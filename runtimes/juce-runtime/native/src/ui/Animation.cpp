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
    } // namespace

    render::Transform Presentation::transform(float width, float height) const noexcept
    {
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
                case AnimatedProperty::Count:
                    break;
            }
            result = multiply(result, operation);
        }
        return multiply(result, render::Transform::translate(-width / 2, -height / 2));
    }

    AnimationTimeline::AnimationTimeline(Surface& target, Clock provided)
        : surface(target), clock(provided ? std::move(provided) : Clock([] { return monotonicMilliseconds(); }))
    {
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

    AnimationId AnimationTimeline::animate(std::uint32_t node, const AnimationDescription& description)
    {
        if (surface.find(node) == nullptr)
            throw std::invalid_argument("unknown animation node");
        const Timing& timing = description.timing;
        if (! std::isfinite(timing.duration) || timing.duration < 0 || ! std::isfinite(timing.delay)
            || timing.delay < 0)
            throw std::invalid_argument("animation duration and delay must be finite and nonnegative");
        constexpr PropertyMask valid = (PropertyMask { 1 } << animatedPropertyCount) - 1;
        if (description.properties == 0 || (description.properties & ~valid) != 0)
            throw std::invalid_argument("animation must name supported properties");
        if (description.to.count > description.to.order.size())
            throw std::invalid_argument("invalid transform order");
        for (std::size_t i = 0; i < animatedPropertyCount; ++i)
            if (! std::isfinite(description.to.values[i])
                || (description.from && ! std::isfinite(description.from->values[i])))
                throw std::invalid_argument("animation values must be finite");
        // Sample before taking the origin, preserving a mid-flight retarget.
        const double time = now();
        if (const auto known = byNode.find(node); known != byNode.end())
            for (const AnimationId id : known->second)
                sample(id, get(id), time);
        Presentation from = description.from.value_or(surface.presentation(node));
        AnimationDescription normalized = description;
        auto& target = normalized.to;
        const auto validateOrder = [](const Presentation& value)
        {
            PropertyMask seen = 0;
            if (value.count > value.order.size())
                throw std::invalid_argument("invalid transform order");
            for (std::size_t i = 0; i < value.count; ++i)
            {
                const auto property = value.order[i];
                if (property <= AnimatedProperty::Opacity || property >= AnimatedProperty::Count
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

        std::vector<AnimationId> conflicts;
        if (const auto known = byNode.find(node); known != byNode.end())
            for (const AnimationId id : known->second)
                if ((get(id).description.properties & description.properties) != 0)
                    conflicts.push_back(id);
        for (const AnimationId id : conflicts)
        {
            Animation& previous = get(id);
            if (! previous.notified)
                settled.push_back({ id, true, previous.generation });
            // Transfer overlapping presentation ownership atomically: its
            // cached pixels remain valid. Only abandoned properties revert.
            const PropertyMask abandoned = previous.description.properties & ~description.properties;
            if (abandoned != 0)
                surface.clearPresentation(node, abandoned);
            deactivate(id, previous);
            animations.erase(id);
            std::erase(byNode.at(node), id);
        }
        if (timing.delay > 0 && (timing.fill == Fill::None || timing.fill == Fill::Forwards))
            surface.clearPresentation(node, description.properties);
        if (nextId == std::numeric_limits<AnimationId>::max())
            throw std::overflow_error("animation ids exhausted");
        const AnimationId id = nextId++;
        Animation animation { node, normalized, from, time };
        const auto [at, inserted] = animations.emplace(id, animation);
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

    void AnimationTimeline::present(const Animation& animation, double progress)
    {
        Presentation value = animation.description.to;
        for (std::size_t i = 0; i < animatedPropertyCount; ++i)
            value.values[i] =
                static_cast<float>(static_cast<double>(animation.from.values[i])
                                   + progress * (static_cast<double>(value.values[i]) - animation.from.values[i]));
        surface.setPresentation(animation.node, value, animation.description.properties);
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
        animation.state = cancelled ? PlaybackState::Cancelled : PlaybackState::Finished;
        if (! animation.notified)
        {
            settled.push_back({ id, cancelled, animation.generation });
            animation.notified = true;
        }
        if (cancelled || ! retains(animation.description.timing.fill))
            surface.clearPresentation(animation.node, animation.description.properties);
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
                present(animation, 0);
            return;
        }
        // Fixed-step clocks can land a fraction of a nanosecond below an
        // endpoint. Do not accumulate a whole extra tick on every reversal.
        const bool completed = reduceMotion || timing.duration == 0 || elapsed >= timing.duration - 1e-7;
        const double progress = completed ? 1 : std::clamp(elapsed / timing.duration, 0.0, 1.0);
        present(animation, ease(timing.easing, progress));
        if (progress == 1)
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
        const std::uint32_t node = animation.node;
        settle(id, animation, true);
        animations.erase(id);
        auto& ids = byNode.at(node);
        std::erase(ids, id);
        if (ids.empty())
            byNode.erase(node);
    }

    void AnimationTimeline::finish(AnimationId id)
    {
        Animation& animation = get(id);
        present(animation, 1);
        settle(id, animation, false);
    }

    void AnimationTimeline::removeNode(std::uint32_t node)
    {
        const auto known = byNode.find(node);
        if (known == byNode.end())
            return;
        for (const AnimationId id : known->second)
        {
            Animation& animation = get(id);
            if (! animation.notified)
                settled.push_back({ id, true, animation.generation });
            deactivate(id, animation);
            animations.erase(id);
        }
        byNode.erase(known);
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
            return animation.description.timing.duration + animation.description.timing.delay;
        const double time = animation.state == PlaybackState::Paused ? animation.pausedAt : std::max(lastTime, clock());
        return std::clamp(time - animation.started, 0.0,
                          animation.description.timing.duration + animation.description.timing.delay);
    }

    void AnimationTimeline::setReducedMotion(bool reduced)
    {
        reduceMotion = reduced;
        if (reduced)
            for (auto& [id, animation] : animations)
                if (animation.state == PlaybackState::Running || animation.state == PlaybackState::Paused)
                {
                    present(animation, 1);
                    settle(id, animation, false);
                }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
