#include <soundor/runtime/DevSession.h>

#include <fstream>
#include <sstream>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
    namespace
    {
        void log(const RuntimeHost::Options& options, js::LogLevel level, const std::string& message)
        {
            if (options.runtime.log)
                options.runtime.log(level, message);
        }
    } // namespace

    DevSession::DevSession(Options provided) : options(std::move(provided))
    {
        start(readBuildId());
    }

    DevSession::~DevSession() = default;

    std::string DevSession::readBuildId() const
    {
        std::ifstream in(options.bundleDirectory / "build-id");
        std::stringstream content;
        content << in.rdbuf();
        return content.str();
    }

    void DevSession::start(const std::string& build)
    {
        // The old world goes completely before the new one starts: timers,
        // subscriptions, handles, pending work and open gestures with it.
        current.reset();

        RuntimeHost::Options hostOptions = options.host;
        if (! build.empty())
        {
            hostOptions.resources = std::make_shared<platform::DirectoryResources>(options.bundleDirectory);
            hostOptions.entry = options.entry;
        }
        const auto began = std::chrono::steady_clock::now();
        current = std::make_unique<RuntimeHost>(std::move(hostOptions));
        loadedBuild = build;

        if (build.empty())
        {
            log(options.host, js::LogLevel::Info, "Waiting for the first UI build…");
        }
        else if (current->entryResult())
        {
            const auto took =
                std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::steady_clock::now() - began);
            log(options.host, js::LogLevel::Info,
                (reloads == 0 ? "UI started (" : "UI reloaded (") + std::to_string(took.count()) + " ms)");
        }
        nextPoll = std::chrono::steady_clock::now() + options.pollInterval;
    }

    void DevSession::reload()
    {
        ++reloads;
        start(readBuildId());
    }

    void DevSession::tick()
    {
        if (std::chrono::steady_clock::now() >= nextPoll)
        {
            nextPoll = std::chrono::steady_clock::now() + options.pollInterval;
            if (const auto build = readBuildId(); build != loadedBuild && ! build.empty())
            {
                ++reloads;
                start(build);
            }
        }
        current->tick();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE
