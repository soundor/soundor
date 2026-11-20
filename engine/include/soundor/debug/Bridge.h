#pragma once

// A plugin's connection to the DevTools server `soundor dev` runs: the
// session file names the server (on 127.0.0.1) and its credentials; the
// bridge registers the plugin, long-polls the server for the dashboard's
// commands, runs them through the engine's Inspector on the UI thread and
// sends the answers back. A client only: nothing listens in the plugin.
//
// Every runtime's: the requests go through the system's HTTP stack
// (platform::systemHttpClient(), proxies off), so the bridge is the same
// on every platform and in every runtime.

#include <soundor/debug/Inspector.h>

#if SOUNDOR_DEVTOOLS
    #include <soundor/platform/Platform.h>

    #include <deque>
    #include <memory>
    #include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
{
    // Workers own all networking; tick and input interception run only on
    // the engine's UI thread.
    class Bridge
    {
    public:
        struct Options
        {
            // The session file (SOUNDOR_DEVTOOLS_SESSION's value).
            std::string descriptor;
            // The plugin's name, and its runtime's ("VST3"), as the
            // dashboard lists them.
            std::string name;
            std::string runtime;
            // Warnings for the plugin's log (a failed connection).
            js::LogSink log;
            // The HTTP stack; the system's (systemHttpClient()) when empty.
            std::shared_ptr<platform::HttpClient> http;
        };

        explicit Bridge(Options options);
        ~Bridge();
        Bridge(const Bridge&) = delete;
        Bridge& operator=(const Bridge&) = delete;
        Bridge(Bridge&&) = delete;
        Bridge& operator=(Bridge&&) = delete;

        // Every tick, after the runtime's: runs the commands that arrived and
        // sends what the inspector has to say. `generation` counts reloads.
        void tick(RuntimeHost& host, unsigned generation);
        [[nodiscard]] bool recording() const noexcept { return inspector.recording(); }
        void renderFrame(RuntimeHost& host, render::Compositor& compositor, const render::Capabilities& capabilities)
        {
            inspector.renderFrame(host, compositor, capabilities);
        }
        // Input the inspector takes (a picker, Escape) before the view does:
        // whether it took it.
        bool pointer(RuntimeHost& host, const ui::PointerInput& input);
        bool key(RuntimeHost& host, const ui::KeyInput& input);
        [[nodiscard]] bool picking() const noexcept { return inspector.picking(); }

        // The session file a plugin process was given (SOUNDOR_DEVTOOLS_SESSION),
        // or "" when DevTools is not asked for.
        [[nodiscard]] static std::string sessionFromEnvironment();

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
        Inspector inspector;
        unsigned observedEpoch = 0;
        js::LogSink log;
        int lastError = 0;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
#endif
