// The host interface's settings, kept between runs in a JSON file:
// $XDG_CONFIG_HOME/soundor/vst3-host.json (~/.config), ~/Library/Application
// Support/Soundor/vst3-host.json or %APPDATA%\Soundor\vst3-host.json;
// SOUNDOR_VST3_HOST_SETTINGS names another file. What a launch asks for
// explicitly always wins over them.
#pragma once

#include <string>

namespace soundor::vst3host
{
    struct Settings
    {
        /** Open editors with the host interface ("host") or without ("editor"). */
        std::string presentation = "host";
        bool panelOpen = false;
        double volume = 0.8;

        static Settings load();
        /** Best effort: a settings file that cannot be written is not an error. */
        void save() const;
    };
} // namespace soundor::vst3host
