#pragma once

#include <soundor/runtime/RuntimeHost.h>

#include <chrono>
#include <filesystem>
#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
    // Development mode: runs the plugin UI from the bundle `soundor dev` keeps
    // rebuilding, and reloads it — a complete, fresh RuntimeHost — whenever a
    // new build lands.
    //
    // `soundor dev` writes `build-id` into the bundle directory after each
    // successful build (and only then), so a half-written bundle is never
    // loaded. A build whose entry fails is reported; the next good build
    // reloads as usual.
    class DevSession
    {
    public:
        struct Options
        {
            // Everything but resources/entry, used for every runtime created.
            RuntimeHost::Options host;
            std::filesystem::path bundleDirectory;
            std::string entry = "/bundle.js";
            // How often to look for a new build.
            std::chrono::milliseconds pollInterval { 200 };
        };

        explicit DevSession(Options provided);
        ~DevSession();

        DevSession(const DevSession&) = delete;
        DevSession& operator=(const DevSession&) = delete;

        // On the UI thread, every frame: reloads if a new build landed, then
        // ticks the current runtime.
        void tick();

        // Replaces the runtime now, with whatever bundle is on disk.
        void reload();

        [[nodiscard]] RuntimeHost& host() noexcept { return *current; }
        // The build currently running ("" before the first build).
        [[nodiscard]] const std::string& buildId() const noexcept { return loadedBuild; }
        [[nodiscard]] unsigned reloadCount() const noexcept { return reloads; }

    private:
        [[nodiscard]] std::string readBuildId() const;
        void start(const std::string& build);

        Options options;
        std::unique_ptr<RuntimeHost> current;
        std::string loadedBuild;
        unsigned reloads = 0;
        std::chrono::steady_clock::time_point nextPoll;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE
