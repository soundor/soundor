#pragma once

// What Soundor's macOS and iOS bridges share: how an element reaches its
// bridge (by token, never by pointer), the request queue, and the one
// runtime-made element class per binary. Objective-C++ only.

#include "a11y/PlatformSupport.h"

#include <soundor/a11y/Semantics.h>

#import <Foundation/Foundation.h>

#include <cstdint>
#include <mutex>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail::apple
{
    // What a bridge's elements share with it: requests for tick().
    struct Channel
    {
        std::mutex mutex;
        std::vector<ActionRequest> requests;
    };
    using Channels = Registry<Channel>;

    [[nodiscard]] std::uint32_t bit(Action action) noexcept;
    // The standard actions `node` offers, a bit each.
    [[nodiscard]] std::uint32_t offers(const Node& node) noexcept;

    // Marks `element` as `node`'s, of the bridge with `token`.
    void tag(id element, std::uintptr_t token, const Node& node);
    // Whether the element's node offers `action`.
    [[nodiscard]] bool offered(id element, Action action);
    // Queues a request from `element` for its bridge; whether it was taken
    // (false when the bridge is gone, or the action is not offered).
    bool ask(id element, Action action, std::string name = {},
             std::variant<std::monostate, double, std::string> value = {});
    // Queues a request for the bridge with `token` (custom actions).
    bool ask(std::uintptr_t token, ActionRequest request);
    // The requests queued since the last call.
    [[nodiscard]] std::vector<ActionRequest> take(Channel& channel);

    // The element class: a subclass of `base` with `methods` added (each with
    // the encoding of `base`'s own method of that selector), registered once
    // per binary under "SoundorAXElement_<ABI namespace>_<random>". The
    // binary is pinned first: the class is never disposed.
    [[nodiscard]] Class makeElementClass(Class base, const std::vector<std::pair<SEL, IMP>>& methods);

    [[nodiscard]] NSString* string(const std::string& text);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail::apple
