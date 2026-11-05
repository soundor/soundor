#include "Settings.h"

#include "Json.h"
#include "Paths.h"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <sstream>

namespace soundor::vst3host
{
    namespace
    {
#if ! defined(_WIN32)
        std::string environment(const char* name)
        {
            const char* value = std::getenv(name); // NOLINT(concurrency-mt-unsafe): read on the main thread
            return value != nullptr ? value : "";
        }
#endif

        std::filesystem::path settingsPath()
        {
#if defined(_WIN32)
            // Windows' environment is UTF-16.
            if (const wchar_t* path = _wgetenv(L"SOUNDOR_VST3_HOST_SETTINGS"); path != nullptr && *path != L'\0')
                return path;
            const wchar_t* base = _wgetenv(L"APPDATA");
            return base == nullptr || *base == L'\0' ? std::filesystem::path()
                                                     : std::filesystem::path(base) / "Soundor" / "vst3-host.json";
#else
            if (const std::string path = environment("SOUNDOR_VST3_HOST_SETTINGS"); ! path.empty())
                return toPath(path);
#endif
#if defined(_WIN32)
#elif defined(__APPLE__)
            const std::string home = environment("HOME");
            return home.empty() ? std::filesystem::path()
                                : toPath(home) / "Library" / "Application Support" / "Soundor" / "vst3-host.json";
#else
            if (const std::string config = environment("XDG_CONFIG_HOME"); ! config.empty())
                return toPath(config) / "soundor" / "vst3-host.json";
            const std::string home = environment("HOME");
            return home.empty() ? std::filesystem::path() : toPath(home) / ".config" / "soundor" / "vst3-host.json";
#endif
        }
    } // namespace

    Settings Settings::load()
    {
        Settings settings;
        const auto path = settingsPath();
        if (path.empty())
            return settings;
        std::ifstream input(path, std::ios::binary);
        if (! input)
            return settings;
        std::stringstream text;
        text << input.rdbuf();
        try
        {
            const Json json = Json::parse(text.str());
            if (const Json* value = json.find("presentation");
                value != nullptr && value->isString() && (value->asString() == "host" || value->asString() == "editor"))
                settings.presentation = value->asString();
            if (const Json* value = json.find("panelOpen"); value != nullptr && value->isBool())
                settings.panelOpen = value->asBool();
            if (const Json* value = json.find("volume");
                value != nullptr && value->isNumber() && value->asNumber() >= 0 && value->asNumber() <= 1)
                settings.volume = value->asNumber();
        }
        catch (const std::exception&) // NOLINT(bugprone-empty-catch): a damaged file means the defaults
        {
        }
        return settings;
    }

    void Settings::save() const
    {
        const auto path = settingsPath();
        if (path.empty())
            return;
        std::error_code error;
        std::filesystem::create_directories(path.parent_path(), error);
        Json json = Json::object();
        json.set("presentation", presentation);
        json.set("panelOpen", panelOpen);
        json.set("volume", volume);
        std::ofstream output(path, std::ios::binary | std::ios::trunc);
        output << json.dump() << "\n";
    }
} // namespace soundor::vst3host
