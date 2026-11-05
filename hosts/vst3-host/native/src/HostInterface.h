// The host interface, drawn with Dear ImGui around the editor, after the web
// runtime's host page (runtimes/web-runtime/src/client/shell):
//
// - a dock floating under the editor: mute and volume, play/pause and stop,
//   the position, and the button that opens the panel;
// - a side panel, closed by default: the transport, the audio input and
//   status, an on-screen keyboard (plugins with an event input), the
//   parameters, the plugin's details and the host's settings.
//
// It controls what the protocol controls (the transport, live audio,
// parameter values), through the same objects: it is one more client of
// the session.
#pragma once

#include "EventLoop.h"
#include "Json.h"
#include "LiveAudio.h"
#include "Plugin.h"
#include "Settings.h"

#include <functional>
#include <optional>
#include <string>
#include <utility>
#include <vector>

struct ImFont;
struct SDL_Window;

namespace soundor::vst3host
{
    /** What the interface controls. */
    struct HostModel
    {
        Plugin& plugin;
        LiveAudio& audio;
        Settings& settings;
        /** Emits a protocol event (changes made in the interface). */
        std::function<void(const std::string& event, Json params)> emit;
    };

    struct InterfaceLayout
    {
        /** The window's size, in the interface's coordinates. */
        float width = 0;
        float height = 0;
        /** The interface's scale (its sizes are in units of 1 / scale). */
        float scale = 1;
        /** The panel's width, 0 when closed. */
        float panelWidth = 0;
        float editorX = 0;
        float editorY = 0;
        float editorWidth = 0;
        float editorHeight = 0;
        bool resizable = false;
        /** The editor's image while the window presents it (an SDL_Texture),
            and its part to draw where in the window. */
        void* editorImage = nullptr;
        float editorImageX = 0;
        float editorImageY = 0;
        float editorImageWidth = 0;
        float editorImageHeight = 0;
        float editorImageU0 = 0;
        float editorImageV0 = 0;
        float editorImageU1 = 1;
        float editorImageV1 = 1;
    };

    class HostInterface
    {
    public:
        HostInterface(EventLoop& loop, HostModel& model, SDL_Window* window, ImFont* semibold, bool bare);

        void draw(const InterfaceLayout& layout);
        /** A grip drag, consumed after the interface finishes drawing. */
        std::optional<std::pair<int, int>> takeEditorSize();

        [[nodiscard]] bool resizingEditor() const { return gripActive_ || wantedSize_.has_value(); }
        [[nodiscard]] bool panelOpen() const { return panelOpen_; }
        /** The dock's width in units, as last drawn. */
        [[nodiscard]] float dockWidth() const { return dockWidth_; }
        /** Live audio moves the meters and the position: draw again soon. */
        [[nodiscard]] bool animating() const;

        // Layout, in units.
        static constexpr float padding = 16;
        static constexpr float dockSpace = 76;
        static constexpr float panelWidth = 300;
        static constexpr float panelMinHeight = 560;

    private:
        /** Draws the editor's image and nothing else. */
        bool bare_ = false;
        void drawStage(const InterfaceLayout& layout) const;
        static void drawEditorImage(const InterfaceLayout& layout);
        void drawDock(const InterfaceLayout& layout);
        void drawResizeGrip(const InterfaceLayout& layout);
        [[nodiscard]] std::pair<float, float> pointer() const;
        void drawPanel(const InterfaceLayout& layout);
        void drawTransport();
        void drawAudio();
        void drawKeyboard();
        void drawParameters();
        /** True when pressed. */
        [[nodiscard]] bool drawToggle(const char* title, bool on) const;
        void drawPlugin();
        void drawSettings();
        /** A section's heading; a collapsible one starts closed. False: closed. */
        bool section(const char* title, bool collapsible = false);
        bool rangeSlider(const char* id, double& value, double defaultValue) const;
        void startAudio();
        void play();
        void chooseFile();
        void audioChanged() const;
        void noteOn(int pitch);
        void noteOff();

        EventLoop& loop_;
        HostModel& model_;
        SDL_Window* window_;
        ImFont* semibold_;
        float scale_ = 1;
        bool gripActive_ = false;
        /** Where in the grip the pointer took it, from the editor's corner. */
        float dragX_ = 0;
        float dragY_ = 0;
        std::pair<int, int> dragWanted_ {};
        std::optional<std::pair<int, int>> wantedSize_;
        bool panelOpen_;
        float dockWidth_ = 330;
        bool firstSection_ = true;
        float meters_[2] = { 0, 0 };
        int heldNote_ = -1;
        int parameterGeneration_ = -1;
        std::vector<HostParameter> parameters_;
        std::string audioFailure_;
    };
} // namespace soundor::vst3host
