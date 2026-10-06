#pragma once

#include "a11y/accesskit/Mapping.h"

#include <soundor/a11y/Platform.h>

#include <atomic>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    // The AccessKit adapter for this platform (Windows, Linux), or null.
    [[nodiscard]] std::unique_ptr<PlatformAccessibility> createAccessKitPlatform(const PlatformOptions& options);

    // What the platform's callbacks share with the UI thread.
    struct Channel
    {
        std::mutex mutex;
        std::vector<PlatformRequest> requests;
        std::atomic<bool> active { false };
        // The platform (re)activated: send it the whole tree.
        std::atomic<bool> wantsFull { false };
    };

    // What an adapter's update_if_active() builds its update from.
    struct Pending
    {
        const TreeUpdate& changes;
        const Tree& tree;
        const Presentation& presentation;
        bool withRoot = false;
        bool built = false;
    };

    // The callbacks AccessKit is given, with a token (tokenPointer()) as their
    // userdata; any thread. A token whose platform is gone finds nothing.
    void* tokenPointer(std::uintptr_t token);
    accesskit_tree_update* activate(void* userdata);
    void deactivate(void* userdata);
    void request(accesskit_action_request* raw, void* userdata);
    // request() once AccessKit's request is copied (what tests call).
    void deliver(void* userdata, PlatformRequest request);
    // The update_factory for update_if_active(), with a Pending.
    accesskit_tree_update* buildUpdate(void* userdata);

    // The part of every AccessKit adapter that is not the platform's: the
    // queue of requests, activation, and turning the semantic tree's changes
    // into AccessKit updates.
    class AccessKitPlatform : public PlatformAccessibility
    {
    public:
        explicit AccessKitPlatform(std::string name);
        ~AccessKitPlatform() override;

        AccessKitPlatform(const AccessKitPlatform&) = delete;
        AccessKitPlatform& operator=(const AccessKitPlatform&) = delete;
        AccessKitPlatform(AccessKitPlatform&&) = delete;
        AccessKitPlatform& operator=(AccessKitPlatform&&) = delete;

        void tick(RuntimeHost& host) final;
        void setGeometry(const ViewGeometry& next) final;
        [[nodiscard]] bool active() const final;

        // What the platform's callbacks are given as userdata.
        [[nodiscard]] std::uintptr_t token() const noexcept { return channelToken; }

    protected:
        // Hands `pending` to the adapter's update_if_active().
        virtual void send(Pending* pending) = 0;
        // The view moved on screen.
        virtual void moved() {}

        [[nodiscard]] const ViewGeometry& viewGeometry() const noexcept { return geometry; }

    private:
        std::shared_ptr<Channel> channel;
        std::uintptr_t channelToken;
        ViewGeometry geometry;
        Presentation presentation;
        Tree mirror;
        const RuntimeHost* lastHost = nullptr;
        bool presentationChanged = false;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
