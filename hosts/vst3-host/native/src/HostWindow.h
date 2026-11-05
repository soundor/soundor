// An SDL window drawing the host interface (HostInterface) around a native view
// the editor attaches to (EditorArea).
//
// In the `host` presentation the editor's area always has the editor's size:
// resizing or maximizing the window, or opening or closing the panel, changes
// the stage around it, never the editor, whether or not the editor can be
// resized. As in the web host, its grip and its own requests can use the stage,
// and the window never grows for them. The window's minimum keeps room for the
// editor.
//
// On Linux, the `editor` presentation is a bare window that is the editor. Its
// border asks the editor for each size, and the editor takes the answer at once
// (VST3 has no call for a shape, so an edge that the answer refuses is asked
// again, with the other side left to the editor). The window manager owns the
// window through a drag: the window takes the editor's size once it has stopped.
//
// A change of the editor's geometry is presented as one, as a browser's are:
// where the platform needs it, the window draws the editor's images itself
// until the change is over (EditorArea's live presentation), and a window
// manager waits for the frame of a size it asks for (_NET_WM_SYNC_REQUEST).
// The window and the interface follow the user every frame, with the editor's
// last image stretched to its new size; the editor is asked for one size at a
// time, and for another only once it has painted the last.
//
// The interface is presented when its drawing changes, never in a loop: a
// frame is built on input, at the monitor refresh rate while audio plays, and every 100 ms
// otherwise (values change without input too), and presented only if it
// differs from the last one.
#pragma once

#include "EditorArea.h"
#include "EditorWindow.h"
#include "HostInterface.h"

#include <array>
#include <chrono>
#include <cstdint>
#include <memory>

struct SDL_Renderer;
struct SDL_Texture;
struct SDL_Window;
union SDL_Event;
struct ImGuiContext;

namespace soundor::vst3host
{
    class HostWindow final : public EditorWindow
    {
    public:
        /** nullptr and `error` when no window can be made (no display). A bare
            window has no interface: the editor is all of it, its border resizes
            the editor, and it cannot be maximized or minimized. */
        static std::unique_ptr<EditorWindow> create(EventLoop& loop, HostModel& model, const std::string& title,
                                                    int width, int height, bool bare, Callbacks callbacks,
                                                    std::string& error);

        HostWindow(EventLoop& loop, HostModel& model, bool bare, Callbacks callbacks);
        ~HostWindow() override;
        HostWindow(const HostWindow&) = delete;
        HostWindow& operator=(const HostWindow&) = delete;

        [[nodiscard]] const char* platformType() const override { return area_->platformType(); }
        [[nodiscard]] void* parentHandle() const override { return area_->handle(); }
        void setResizable(bool resizable) override;
        void setContentSize(int width, int height) override;
        void constrainContentSize(int width, int height) override;
        void setEditorMinimum(int width, int height) override;
        void setEditorMaximum(int width, int height) override;
        [[nodiscard]] std::optional<std::pair<int, int>> editorRoom() const override;
        void show() override;
        [[nodiscard]] double scale() const override;
        [[nodiscard]] const char* presentation() const override { return bare_ ? "editor" : "host"; }
        [[nodiscard]] std::pair<int, int> windowSize() const override;

        /** Tests check that an idle window draws nothing. */
        [[nodiscard]] std::optional<uint64_t> interfaceFrames() const override { return presented_; }

    private:
        bool open(const std::string& title, int width, int height, std::string& error);
        void pump();
        void handle(const SDL_Event& event);
        /** The window's natural size for the editor and the panel. */
        [[nodiscard]] std::pair<int, int> naturalSize() const;
        /** What the editor, the dock and the panel take, however short the
            panel scrolls. */
        [[nodiscard]] std::pair<int, int> requiredSize() const;
        void windowResized();
        /** Maximized or restored since the last frame: the editor follows. */
        /** The window for the editor and the panel, keeping the space the
            user made: `extraWidth` more of it for a panel that opened. */
        void fitWindow(int extraWidth = 0);
        void applyLimits();
        void layout();
        void askWindowSize(int width, int height);
        /** A bare window's border has changed the editor it is. */
        void bareWindowResized();
        /** Gives a bare window the editor's size after a drag has stopped. */
        void settleWindow(std::chrono::steady_clock::time_point now);
        /** What the interface takes around the editor: nothing in a bare window. */
        [[nodiscard]] float paddingSpace() const;
        [[nodiscard]] float dockHeight() const;
        [[nodiscard]] float dockSpan() const;
        /** What the panel takes from the stage now. */
        [[nodiscard]] float panelSpace() const;
        void applyScale();
        void applyRefreshRate();
        void invalidate(int frames = 2) { pending_ = std::max(pending_, frames); }
        void render();
        /** The editor's geometry is changing: presents it live until it stops. */
        void touchLive();
        void endLive();
        /** The editor's size for the window's stage. */
        [[nodiscard]] std::pair<int, int> stageEditorSize() const;
        void updateLiveImage();

        EventLoop& loop_;
        HostModel& model_;
        Callbacks callbacks_;
        SDL_Window* window_ = nullptr;
        SDL_Renderer* renderer_ = nullptr;
        ImGuiContext* context_ = nullptr;
        std::unique_ptr<EditorArea> area_;
        std::unique_ptr<HostInterface> interface_;
        EventLoop::Id timer_ = 0;

        int editorWidth_ = 0;
        int editorHeight_ = 0;
        std::array<int, 4> editorFrame_ {};
        bool resizable_ = false;
        bool shown_ = false;
        bool live_ = false;
        std::chrono::steady_clock::time_point liveTouched_ {};
        SDL_Texture* liveTexture_ = nullptr;
        int liveWidth_ = 0;
        int liveHeight_ = 0;
        /** The part of the image that holds the editor's pixels, and where it
            goes in the window; none for a whole image, which fills the editor. */
        struct LivePart
        {
            float x, y, width, height, u0, v0, u1, v1;
        };
        std::optional<LivePart> livePart_;
        bool livePartial_ = false;
        bool viewHidden_ = false;
        /** The image to draw is an older one, not what the view shows. */
        bool hideViewFirst_ = false;
        std::chrono::steady_clock::time_point windowResizedAt_ {};
        int minimumWidth_ = 1;
        int minimumHeight_ = 1;
        /** The panel the stage leaves room for: panelOpen_ once the window has
            taken its width. */
        bool stagePanelOpen_ = false;
        std::chrono::steady_clock::time_point stageFollowsAt_ {};
        /** The user's newest grip drag, for the editor to take when it can. */
        std::optional<std::pair<int, int>> gripSize_;
        bool bare_ = false;
        int maximumWidth_ = 0;
        int maximumHeight_ = 0;
        /** A drag has changed a bare window: it takes the editor's size once
            the drag has stopped. */
        bool settling_ = false;
        int settlingAsks_ = 0;
        /** The bare window's size at the last step of a drag. */
        std::pair<int, int> draggedSize_ { 0, 0 };
        /** A size a bare window has asked for and not yet got. */
        std::optional<std::pair<int, int>> askedSize_;
        std::chrono::steady_clock::time_point askedUntil_ {};
        bool panelOpen_ = false;
        float scale_ = 1;
        /** The natural size the window was last fitted to. */
        std::pair<int, int> fitted_ { 0, 0 };
        /** The window's limits, as last set. */
        std::pair<int, int> limits_ { 0, 0 };
        int pending_ = 0;
        bool forcePresent_ = true;
        uint64_t lastHash_ = 0;
        uint64_t presented_ = 0;
        std::chrono::steady_clock::time_point lastFrame_ {};
        std::chrono::steady_clock::time_point nextFrame_ {};
        std::chrono::steady_clock::duration frameInterval_ {};
        bool closing_ = false;
    };
} // namespace soundor::vst3host
