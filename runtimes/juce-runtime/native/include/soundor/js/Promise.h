#pragma once

#include <soundor/Config.h>

#include <memory>
#include <string>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        struct PendingPromise;

        void rejectPromise(PendingPromise& pending, const std::string& message);
        [[nodiscard]] bool isPromisePending(const PendingPromise& pending) noexcept;
    } // namespace detail

    // The JavaScript promise an `async` native method returns, handed to its
    // C++ implementation to settle later.
    //
    // - Settle it on the runtime's thread (the UI/message thread). Work done on
    //   a background thread must be marshalled back before calling resolve().
    // - The first resolve() or reject() wins; later calls do nothing. Copies
    //   share one promise, so it can be captured by copyable callbacks.
    // - If every copy is destroyed unsettled, the promise rejects, so
    //   JavaScript never waits forever.
    // - After the JavaScript context is destroyed (e.g. on reload), settling is
    //   a no-op.
    //
    // Promise rejections and resolutions run JavaScript reactions only when
    // the runtime next pumps its jobs.
    template <typename T>
    class Promise
    {
    public:
        using Resolver = void (*)(detail::PendingPromise&, T&&);

        Promise(std::shared_ptr<detail::PendingPromise> pending, Resolver resolve)
            : state(std::move(pending)), resolver(resolve)
        {
        }

        void resolve(T value) const
        {
            if (state)
                resolver(*state, std::move(value));
        }

        void reject(const std::string& message) const
        {
            if (state)
                detail::rejectPromise(*state, message);
        }

        [[nodiscard]] bool isPending() const noexcept { return state && detail::isPromisePending(*state); }

    private:
        std::shared_ptr<detail::PendingPromise> state;
        Resolver resolver;
    };

    template <>
    class Promise<void>
    {
    public:
        using Resolver = void (*)(detail::PendingPromise&);

        Promise(std::shared_ptr<detail::PendingPromise> pending, Resolver resolve)
            : state(std::move(pending)), resolver(resolve)
        {
        }

        void resolve() const
        {
            if (state)
                resolver(*state);
        }

        void reject(const std::string& message) const
        {
            if (state)
                detail::rejectPromise(*state, message);
        }

        [[nodiscard]] bool isPending() const noexcept { return state && detail::isPromisePending(*state); }

    private:
        std::shared_ptr<detail::PendingPromise> state;
        Resolver resolver;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
