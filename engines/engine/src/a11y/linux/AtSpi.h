#pragma once

#include <soundor/a11y/Platform.h>

#include <memory>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
{
    // One editor, one private connection and event context. Only plain semantic
    // data crosses to the bus thread. No UI object is reachable from it.
    class Session
    {
    public:
        // Empty address: discover org.a11y.Bus on a private session connection.
        // Explicit address: an accessibility bus (also used by protocol tests).
        explicit Session(std::string name, std::string address = {});
        ~Session();
        Session(const Session&) = delete;
        Session& operator=(const Session&) = delete;

        void update(TreeUpdate update, ViewGeometry geometry, bool focused);
        [[nodiscard]] std::vector<ActionRequest> takeRequests();
        [[nodiscard]] bool active() const;

    private:
        class Impl;
        std::unique_ptr<Impl> impl;
    };

    [[nodiscard]] std::unique_ptr<PlatformAccessibility> createPlatform(const PlatformOptions& options);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
