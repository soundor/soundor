#pragma once

#include <soundor/a11y/Platform.h>

#ifndef NOMINMAX
    #define NOMINMAX
#endif
#ifndef WIN32_LEAN_AND_MEAN
    #define WIN32_LEAN_AND_MEAN
#endif
#include <UIAutomation.h>
#include <windows.h>

#include <memory>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::uia
{
    // One editor's plain-data snapshot and COM providers. Queries never wait
    // for the UI thread; actions are drained by PlatformAccessibility::tick.
    // Construct, update and close on the HWND's thread. Provider references
    // may outlive this object, but return UIA_E_ELEMENTNOTAVAILABLE after close.
    class Session
    {
    public:
        Session(HWND window, std::string name);
        ~Session();
        Session(const Session&) = delete;
        Session& operator=(const Session&) = delete;

        void update(const TreeUpdate& update, const ViewGeometry& geometry, bool focused);
        [[nodiscard]] std::vector<ActionRequest> takeRequests();
        // AddRef'd; caller owns the returned reference. Also activates events.
        [[nodiscard]] IRawElementProviderSimple* provider();
        [[nodiscard]] bool active() const;
        void close();

    private:
        struct State;
        class Provider;
        std::shared_ptr<State> state;
    };

    [[nodiscard]] std::unique_ptr<PlatformAccessibility> createPlatform(const PlatformOptions& options);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::uia
