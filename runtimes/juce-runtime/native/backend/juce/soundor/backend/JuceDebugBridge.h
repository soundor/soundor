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
        bool pointer(RuntimeHost& host, const ui::PointerInput& input);
        bool key(RuntimeHost& host, const ui::KeyInput& input);
        [[nodiscard]] bool picking() const noexcept { return inspector.picking(); }

    private:
        struct State;
        std::shared_ptr<State> state;
        std::deque<std::pair<unsigned, std::string>> outgoing;
        debug::Inspector inspector;
        unsigned observedEpoch = 0;
        js::LogSink log;
        int lastError = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
#endif
