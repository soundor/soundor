#include "a11y/linux/AtSpi.h"

#include <soundor/runtime/RuntimeHost.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
{
    namespace
    {
        class LinuxPlatform final : public PlatformAccessibility
        {
        public:
            explicit LinuxPlatform(std::string name) : session(std::move(name)) {}

            void tick(RuntimeHost& host) final
            {
                const bool sameHost = lastHost == &host;
                for (const ActionRequest& request : session.takeRequests())
                    if (sameHost)
                        host.performAccessibilityAction(request);
                TreeUpdate changes = host.accessibility().update(! sameHost);
                // TreeUpdate::empty() intentionally omits focus; a focus-only
                // update has a root but no changed nodes. Preserve that update.
                if (! changes.empty() || changes.root != noNode || presentationChanged)
                    session.update(std::move(changes), geometry, focused);
                lastHost = &host;
                presentationChanged = false;
            }

            void setGeometry(const ViewGeometry& next) final
            {
                if (geometry != next)
                {
                    geometry = next;
                    presentationChanged = true;
                }
            }
            void setFocused(bool next) final
            {
                if (focused != next)
                {
                    focused = next;
                    presentationChanged = true;
                }
            }
            [[nodiscard]] bool active() const final { return session.active(); }

        private:
            Session session;
            const RuntimeHost* lastHost = nullptr;
            ViewGeometry geometry;
            bool focused = false;
            bool presentationChanged = true;
        };
    } // namespace

    std::unique_ptr<PlatformAccessibility> createPlatform(const PlatformOptions& options)
    {
        return std::make_unique<LinuxPlatform>(options.name);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
