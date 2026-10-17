#pragma once

#include <soundor/debug/Inspector.h>

#if SOUNDOR_DEVTOOLS
    #include <deque>
    #include <memory>
    #include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // Development Standalone adapter. Workers own all networking; tick and
    // input interception run exclusively on the engine's UI thread.
    class JuceDebugBridge
    {
    public:
        JuceDebugBridge(std::string descriptor, std::string name, js::LogSink log = {});
        ~JuceDebugBridge();
        JuceDebugBridge(const JuceDebugBridge&) = delete;
        JuceDebugBridge& operator=(const JuceDebugBridge&) = delete;
        void tick(RuntimeHost& host, unsigned generation);
        [[nodiscard]] bool recording() const noexcept { return inspector.recording(); }
        void renderFrame(RuntimeHost& host, render::Compositor& compositor, const render::Capabilities& capabilities)
        {
            inspector.renderFrame(host, compositor, capabilities);
        }
        bool pointer(RuntimeHost& host, const ui::PointerInput& input);
        bool key(RuntimeHost& host, const ui::KeyInput& input);
        [[nodiscard]] bool picking() const noexcept { return inspector.picking(); }

    private:
        struct State;
        std::shared_ptr<State> state;
        // A message for the server, and the binary it uploads first (a
        // capture's PNG, for request `attachmentId`).
        struct Message
        {
            unsigned epoch = 0;
            std::string text;
            std::string attachmentId;
            std::string attachment;
        };
        std::deque<Message> outgoing;
        debug::Inspector inspector;
        unsigned observedEpoch = 0;
        js::LogSink log;
        int lastError = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
#endif
