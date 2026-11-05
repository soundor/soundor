#include "HostWindow.h"

#include <SDL3/SDL.h>
#include <imgui.h>
#include <imgui_impl_sdl3.h>
#include <imgui_impl_sdlrenderer3.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <utility>

namespace soundor::vst3host
{
    namespace fonts
    {
        // Inter (OFL-1.1), embedded by the build (Vst3HostDependencies.cmake).
        extern const unsigned char regular[];
        extern const std::size_t regularSize;
        extern const unsigned char semibold[];
        extern const std::size_t semiboldSize;
    } // namespace fonts

    namespace
    {
        // Values the interface shows also change without input (the API, the
        // editor, the plugin): it builds a frame this often to see, which is
        // cheap, and presents it only if it differs.
        constexpr auto refreshInterval = std::chrono::milliseconds(100);
        // A window manager's drag has no end to see: the geometry has stopped
        // changing for this long.
        constexpr auto liveQuiet = std::chrono::milliseconds(150);
        // A view that goes live this soon after a resize is answering it.
        constexpr auto windowAnswer = std::chrono::milliseconds(200);
        // How long a bare window waits for a size it asked for.
        constexpr auto askedSizeTimeout = std::chrono::milliseconds(500);
        // How often it asks again for the editor's size after a drag: a window
        // manager may refuse while it holds the window.
        constexpr int settleAsks = 8;
        // How long the stage waits for the window to take the panel's width.
        constexpr auto stageFollowTimeout = std::chrono::milliseconds(500);

        bool initVideo(std::string& error)
        {
            if (SDL_WasInit(SDL_INIT_VIDEO) != 0)
                return true;
#if defined(__linux__)
            // VST3 editors on Linux are X11 windows.
            SDL_SetHint(SDL_HINT_VIDEO_DRIVER, "x11");
#endif
            SDL_SetHint(SDL_HINT_APP_NAME, "Soundor VST3 host");
            SDL_SetHint(SDL_HINT_QUIT_ON_LAST_WINDOW_CLOSE, "0");
            // Renderers that leave the editor's child view alone: Direct3D 9
            // presents by blitting, around child windows.
            const char* renderer = std::getenv("SOUNDOR_VST3_HOST_RENDERER"); // NOLINT(concurrency-mt-unsafe)
#if defined(_WIN32)
            SDL_SetHint(SDL_HINT_RENDER_DRIVER, renderer != nullptr ? renderer : "direct3d,direct3d11,software");
#elif defined(__APPLE__)
            SDL_SetHint(SDL_HINT_RENDER_DRIVER, renderer != nullptr ? renderer : "metal,opengl,software");
#else
            SDL_SetHint(SDL_HINT_FRAMEBUFFER_ACCELERATION, "0");
            // The window manager waits for the frame of each size it asks for
            // (OpenGL windows only: SDL answers it when they swap).
            SDL_SetHint(SDL_HINT_VIDEO_X11_ENABLE_XSYNC_EXT, "1");
            SDL_SetHint(SDL_HINT_RENDER_DRIVER, renderer != nullptr ? renderer : "opengl,software");
#endif
            if (! SDL_InitSubSystem(SDL_INIT_VIDEO))
            {
                error = std::string("no display is available for the host interface (") + SDL_GetError()
                        + "; is DISPLAY set? Use headless mode without one)";
                return false;
            }
            return true;
        }

        void applyStyle(float scale)
        {
            ImGuiStyle& style = ImGui::GetStyle();
            style = ImGuiStyle();
            ImGui::StyleColorsDark(&style);
            style.WindowRounding = 0;
            style.ChildRounding = 0;
            style.FrameRounding = 6;
            style.PopupRounding = 6;
            style.GrabRounding = 6;
            style.ScrollbarRounding = 6;
            style.FramePadding = ImVec2(8, 5);
            style.ItemSpacing = ImVec2(8, 6);
            style.FrameBorderSize = 1;
            style.PopupBorderSize = 1;
            style.GrabMinSize = 12;
            style.ScrollbarSize = 10;
            style.SeparatorTextBorderSize = 1;
            auto rgb = [](int r, int g, int b, float a = 1) {
                return ImVec4(static_cast<float>(r) / 255, static_cast<float>(g) / 255, static_cast<float>(b) / 255, a);
            };
            ImVec4* colors = style.Colors;
            colors[ImGuiCol_Text] = rgb(0xe6, 0xe7, 0xea);
            colors[ImGuiCol_TextDisabled] = rgb(0x8b, 0x8f, 0x98);
            colors[ImGuiCol_WindowBg] = rgb(0x15, 0x16, 0x1a);
            colors[ImGuiCol_ChildBg] = rgb(0x15, 0x16, 0x1a, 0);
            colors[ImGuiCol_PopupBg] = rgb(0x1d, 0x1f, 0x24);
            colors[ImGuiCol_Border] = rgb(0x2a, 0x2c, 0x33);
            colors[ImGuiCol_FrameBg] = rgb(0x1d, 0x1f, 0x24);
            colors[ImGuiCol_FrameBgHovered] = rgb(0x24, 0x26, 0x2c);
            colors[ImGuiCol_FrameBgActive] = rgb(0x24, 0x26, 0x2c);
            colors[ImGuiCol_CheckMark] = rgb(0x8f, 0xb3, 0xff);
            colors[ImGuiCol_SliderGrab] = rgb(0x3a, 0x7b, 0xfd);
            colors[ImGuiCol_SliderGrabActive] = rgb(0x8f, 0xb3, 0xff);
            colors[ImGuiCol_Button] = rgb(0x1d, 0x1f, 0x24);
            colors[ImGuiCol_ButtonHovered] = rgb(0x26, 0x28, 0x2f);
            colors[ImGuiCol_ButtonActive] = rgb(0x3a, 0x7b, 0xfd, 0.3F);
            colors[ImGuiCol_Header] = rgb(0x3a, 0x7b, 0xfd, 0.2F);
            colors[ImGuiCol_HeaderHovered] = rgb(0xff, 0xff, 0xff, 0.08F);
            colors[ImGuiCol_HeaderActive] = rgb(0x3a, 0x7b, 0xfd, 0.3F);
            colors[ImGuiCol_ScrollbarBg] = rgb(0, 0, 0, 0);
            colors[ImGuiCol_ScrollbarGrab] = rgb(0x2a, 0x2c, 0x33);
            colors[ImGuiCol_ScrollbarGrabHovered] = rgb(0x3a, 0x3c, 0x44);
            colors[ImGuiCol_ScrollbarGrabActive] = rgb(0x4a, 0x4c, 0x54);
            colors[ImGuiCol_Separator] = rgb(0x2a, 0x2c, 0x33);
            colors[ImGuiCol_NavCursor] = rgb(0x3a, 0x7b, 0xfd);
            style.ScaleAllSizes(scale);
            style.FontSizeBase = 13;
            style.FontScaleDpi = scale;
        }

        /** FNV-1a over the bytes of the frame's drawing. */
        uint64_t hashDrawData(const ImDrawData* data)
        {
            uint64_t hash = 1469598103934665603ULL;
            auto mix = [&hash](const void* bytes, size_t size)
            {
                const auto* at = static_cast<const unsigned char*>(bytes);
                for (size_t index = 0; index < size; ++index)
                    hash = (hash ^ at[index]) * 1099511628211ULL;
            };
            mix(&data->DisplaySize, sizeof data->DisplaySize);
            mix(&data->FramebufferScale, sizeof data->FramebufferScale);
            for (const ImDrawList* list : data->CmdLists)
            {
                mix(list->VtxBuffer.Data, static_cast<size_t>(list->VtxBuffer.Size) * sizeof(ImDrawVert));
                mix(list->IdxBuffer.Data, static_cast<size_t>(list->IdxBuffer.Size) * sizeof(ImDrawIdx));
                for (const ImDrawCmd& command : list->CmdBuffer)
                {
                    mix(&command.ClipRect, sizeof command.ClipRect);
                    // The texture's identity, uploaded or not yet.
                    mix(&command.TexRef, sizeof command.TexRef);
                    mix(&command.ElemCount, sizeof command.ElemCount);
                    mix(&command.IdxOffset, sizeof command.IdxOffset);
                    mix(&command.VtxOffset, sizeof command.VtxOffset);
                }
            }
            return hash;
        }

        bool texturesChanging(const ImDrawData* data)
        {
            if (data->Textures == nullptr)
                return false;
            return std::ranges::any_of(*data->Textures, [](const ImTextureData* texture)
                                       { return texture->Status != ImTextureStatus_OK; });
        }
    } // namespace

    std::unique_ptr<EditorWindow> HostWindow::create(EventLoop& loop, HostModel& model, const std::string& title,
                                                     int width, int height, bool bare, Callbacks callbacks,
                                                     std::string& error)
    {
        if (! initVideo(error))
            return nullptr;
        auto window = std::make_unique<HostWindow>(loop, model, bare, std::move(callbacks));
        if (! window->open(title, width, height, error))
            return nullptr;
        return window;
    }

    HostWindow::HostWindow(EventLoop& loop, HostModel& model, bool bare, Callbacks callbacks)
        : loop_(loop), model_(model), callbacks_(std::move(callbacks)), bare_(bare)
    {
    }

    bool HostWindow::open(const std::string& title, int width, int height, std::string& error)
    {
        editorWidth_ = width;
        editorHeight_ = height;
        constexpr SDL_WindowFlags flags = SDL_WINDOW_HIDDEN | SDL_WINDOW_HIGH_PIXEL_DENSITY;
#if defined(__linux__)
        window_ = SDL_CreateWindow(title.c_str(), width, height, flags | SDL_WINDOW_OPENGL);
        if (window_ != nullptr)
        {
            renderer_ = SDL_CreateRenderer(window_, nullptr);
            // Only an OpenGL renderer answers the window manager's requests.
            if (renderer_ == nullptr || std::strcmp(SDL_GetRendererName(renderer_), "opengl") != 0)
            {
                if (renderer_ != nullptr)
                    SDL_DestroyRenderer(renderer_);
                renderer_ = nullptr;
                SDL_DestroyWindow(window_);
                window_ = nullptr;
            }
        }
#endif
        if (window_ == nullptr)
        {
            SDL_SetHint(SDL_HINT_VIDEO_X11_ENABLE_XSYNC_EXT, "0");
            window_ = SDL_CreateWindow(title.c_str(), width, height, flags);
        }
        if (window_ == nullptr)
        {
            error = std::string("the host interface's window could not be created: ") + SDL_GetError();
            return false;
        }
        if (renderer_ == nullptr)
            renderer_ = SDL_CreateRenderer(window_, nullptr);
        if (renderer_ == nullptr)
        {
            error = std::string("the host interface could not draw: ") + SDL_GetError();
            return false;
        }
        std::fprintf(stderr, "[vst3-host] host interface renderer: %s\n", SDL_GetRendererName(renderer_));
        area_ = EditorArea::create(window_, error);
        if (area_ == nullptr)
            return false;
        if (bare_)
        {
            area_->allowOnlyMoveResizeClose();
            area_->keepTopLeft(true);
        }

        IMGUI_CHECKVERSION();
        context_ = ImGui::CreateContext();
        ImGui::SetCurrentContext(context_);
        ImGuiIO& io = ImGui::GetIO();
        io.IniFilename = nullptr;
        io.LogFilename = nullptr;
        ImFontConfig config;
        config.FontDataOwnedByAtlas = false;
        // ImGui does not write to font data it does not own.
        ImFont* regular = io.Fonts->AddFontFromMemoryTTF(const_cast<unsigned char*>(fonts::regular),
                                                         static_cast<int>(fonts::regularSize), 13, &config);
        ImFont* semibold = io.Fonts->AddFontFromMemoryTTF(const_cast<unsigned char*>(fonts::semibold),
                                                          static_cast<int>(fonts::semiboldSize), 13, &config);
        io.FontDefault = regular;
        ImGui_ImplSDL3_InitForSDLRenderer(window_, renderer_);
        ImGui_ImplSDLRenderer3_Init(renderer_);

        interface_ = std::make_unique<HostInterface>(loop_, model_, window_, semibold, bare_);
        panelOpen_ = interface_->panelOpen();
        stagePanelOpen_ = panelOpen_;
        applyScale();
        fitWindow();
        applyRefreshRate();
#if defined(__APPLE__)
        // SDL reads Cocoa's events itself (its keyboard handling depends on
        // it), and sends every event on to the application, the editor's
        // included.
        loop_.setWaiter(
            [this](double seconds)
            {
                SDL_WaitEventTimeout(nullptr, static_cast<Sint32>(seconds * 1000));
                pump();
            });
#endif
        return true;
    }

    HostWindow::~HostWindow()
    {
        closing_ = true;
#if defined(__APPLE__)
        loop_.setWaiter(nullptr);
#endif
        if (timer_ != 0)
            loop_.removeTimer(timer_);
        interface_.reset();
        if (live_)
            endLive();
        if (context_ != nullptr)
        {
            ImGui::SetCurrentContext(context_);
            ImGui_ImplSDLRenderer3_Shutdown();
            ImGui_ImplSDL3_Shutdown();
            ImGui::DestroyContext(context_);
        }
        area_.reset();
        if (renderer_ != nullptr)
            SDL_DestroyRenderer(renderer_);
        if (window_ != nullptr)
            SDL_DestroyWindow(window_);
    }

    void HostWindow::setResizable(bool resizable)
    {
        resizable_ = resizable;
        // Only a bare window is the editor: the host's has a stage around it,
        // which the user can size whichever editor it shows.
        SDL_SetWindowResizable(window_, resizable || ! bare_);
        fitWindow();
    }

    void HostWindow::setContentSize(int width, int height)
    {
        if (width == editorWidth_ && height == editorHeight_)
            return;
        editorWidth_ = width;
        editorHeight_ = height;
        fitWindow();
    }

    std::optional<std::pair<int, int>> HostWindow::editorRoom() const
    {
        // A bare window grows with the editor, and so does one not yet shown,
        // for the size the editor opens at (its scale).
        if (bare_ || ! shown_)
            return std::nullopt;
        const auto [width, height] = stageEditorSize();
        return std::pair { std::max(width, editorWidth_), std::max(height, editorHeight_) };
    }

    void HostWindow::constrainContentSize(int width, int height)
    {
        editorWidth_ = width;
        editorHeight_ = height;
        // A bare window is the editor's size, whatever its limits made of a drag.
        if (bare_)
        {
            applyLimits();
            // The window manager owns the window through a drag: it takes the
            // editor's size once the drag has stopped (settleWindow()).
            if (settling_)
                layout();
            else
                fitWindow();
            return;
        }
        // The window manager owns a border drag. Keep any extra stage space
        // rather than resize the outer window back on every constraint check.
        applyLimits();
        const auto required = requiredSize();
        const auto current = windowSize();
        if (required.first > current.first || required.second > current.second)
            fitWindow();
        else
            layout();
    }

    void HostWindow::show()
    {
        SDL_ShowWindow(window_);
        SDL_RaiseWindow(window_);
        SDL_SyncWindow(window_);
        draggedSize_ = windowSize();
        layout();
        shown_ = true;
        forcePresent_ = true;
        invalidate();
        render();
    }

    double HostWindow::scale() const
    {
        // The interface's: the editor and what is around it are the same size
        // on the screen, as in the web host.
        return scale_;
    }

    std::pair<int, int> HostWindow::windowSize() const
    {
        int width = 0;
        int height = 0;
        SDL_GetWindowSize(window_, &width, &height);
        return { width, height };
    }

    void HostWindow::applyScale()
    {
#if defined(__APPLE__)
        // Points: the system scales them.
        scale_ = 1;
#else
        scale_ = std::max(1.0F, SDL_GetWindowDisplayScale(window_));
#endif
        ImGui::SetCurrentContext(context_);
        applyStyle(scale_);
    }

    void HostWindow::applyRefreshRate()
    {
        const SDL_DisplayMode* mode = SDL_GetCurrentDisplayMode(SDL_GetDisplayForWindow(window_));
        const double rate = mode != nullptr && std::isfinite(mode->refresh_rate) && mode->refresh_rate > 0
                                ? static_cast<double>(mode->refresh_rate)
                                : 60.0;
        frameInterval_ =
            std::chrono::duration_cast<std::chrono::steady_clock::duration>(std::chrono::duration<double>(1.0 / rate));
        // Wake just before a frame is due. The deadline below retains fractional
        // milliseconds (59.94 Hz, 144 Hz, etc.) instead of accumulating drift.
        const auto milliseconds = static_cast<unsigned>(std::max(1.0, std::floor(1000.0 / rate)));
        if (timer_ != 0)
            loop_.removeTimer(timer_);
        timer_ = loop_.addTimer(milliseconds, [this] { pump(); });
        nextFrame_ = std::chrono::steady_clock::now();
        invalidate();
    }

    std::pair<int, int> HostWindow::naturalSize() const
    {
        const float padding = paddingSpace();
        const float stage = std::max(static_cast<float>(editorWidth_), dockSpan()) + 2 * padding;
        const float panel = panelOpen_ ? HostInterface::panelWidth * scale_ : 0;
        float height = static_cast<float>(editorHeight_) + padding + dockHeight();
        if (panelOpen_)
            height = std::max(height, HostInterface::panelMinHeight * scale_);
        return { static_cast<int>(std::ceil(stage + panel)), static_cast<int>(std::ceil(height)) };
    }

    std::pair<int, int> HostWindow::requiredSize() const
    {
        const float padding = paddingSpace();
        const float panel = panelOpen_ ? HostInterface::panelWidth * scale_ : 0;
        const float stage = std::max(static_cast<float>(editorWidth_), dockSpan()) + 2 * padding;
        return { static_cast<int>(std::ceil(stage + panel)),
                 static_cast<int>(std::ceil(static_cast<float>(editorHeight_) + padding + dockHeight())) };
    }

    void HostWindow::setEditorMinimum(int width, int height)
    {
        minimumWidth_ = width;
        minimumHeight_ = height;
        limits_ = { 0, 0 };
        applyLimits();
    }

    void HostWindow::setEditorMaximum(int width, int height)
    {
        if (! bare_)
            return;
        maximumWidth_ = width;
        maximumHeight_ = height;
        limits_ = { 0, 0 };
        applyLimits();
    }

    void HostWindow::askWindowSize(int width, int height)
    {
        askedSize_ = std::pair { width, height };
        askedUntil_ = std::chrono::steady_clock::now() + askedSizeTimeout;
        SDL_SetWindowSize(window_, width, height);
    }

    void HostWindow::applyLimits()
    {
        // A bare window is the editor, so no smaller than the smallest editor.
        // The host's window leaves the editor's size alone: no smaller than
        // this editor, with its dock and its panel.
        const std::pair smallest { minimumWidth_, minimumHeight_ };
        const bool fixed = bare_ && ! resizable_;
        const auto minimum = fixed ? naturalSize() : bare_ ? smallest : requiredSize();
        if (minimum == limits_)
            return;
        limits_ = minimum;
        SDL_SetWindowMinimumSize(window_, minimum.first, minimum.second);
        if (fixed)
            SDL_SetWindowMaximumSize(window_, minimum.first, minimum.second);
        else
            SDL_SetWindowMaximumSize(window_, bare_ ? maximumWidth_ : 0, bare_ ? maximumHeight_ : 0);
    }

    void HostWindow::fitWindow(int extraWidth)
    {
        const auto natural = naturalSize();
        fitted_ = natural;
        limits_ = { 0, 0 };
        applyLimits();
        if ((SDL_GetWindowFlags(window_) & SDL_WINDOW_MAXIMIZED) == 0)
        {
            // Space the user made stays. Window-manager requests are
            // asynchronous: waiting here can block all plugin input and timers.
            const auto [width, height] = windowSize();
            const std::pair wanted =
                ! bare_ ? std::pair { std::max(natural.first, width + extraWidth), std::max(natural.second, height) }
                        : natural;
            if (wanted != std::pair { width, height })
            {
                area_->keepTopLeft(true);
                if (bare_)
                    askWindowSize(wanted.first, wanted.second);
                else
                    SDL_SetWindowSize(window_, wanted.first, wanted.second);
                // The window has not changed yet, and may take a while: the
                // stage stays until it has, or the editor would move away and
                // back.
                if (stagePanelOpen_ != panelOpen_)
                {
                    stageFollowsAt_ = std::chrono::steady_clock::now() + stageFollowTimeout;
                    layout();
                    return;
                }
            }
        }
        stagePanelOpen_ = panelOpen_;
        layout();
    }

    float HostWindow::paddingSpace() const
    {
        return bare_ ? 0 : HostInterface::padding * scale_;
    }

    float HostWindow::dockHeight() const
    {
        return bare_ ? 0 : HostInterface::dockSpace * scale_;
    }

    float HostWindow::dockSpan() const
    {
        return bare_ ? 0 : interface_->dockWidth() * scale_;
    }

    float HostWindow::panelSpace() const
    {
        return stagePanelOpen_ ? std::ceil(HostInterface::panelWidth * scale_) : 0;
    }

    void HostWindow::layout()
    {
        const auto [width, height] = windowSize();
        const float padding = paddingSpace();
        const float panel = panelSpace();
        const float stage = static_cast<float>(width) - panel;
        const float free = static_cast<float>(height) - padding - dockHeight() - static_cast<float>(editorHeight_);
        // Centred on the stage, as the web host's view is.
        const int x = std::max(0, static_cast<int>(std::floor((stage - static_cast<float>(editorWidth_)) / 2)));
        const int y = static_cast<int>(padding + std::max(0.0F, std::floor(free / 2)));
        const std::array frame { x, y, editorWidth_, editorHeight_ };
        if (frame != editorFrame_ || ! area_->isAt(x, y))
        {
            touchLive();
            editorFrame_ = frame;
            area_->setFrame(x, y, editorWidth_, editorHeight_);
        }
        forcePresent_ = true;
        invalidate();
    }

    void HostWindow::touchLive()
    {
        if (! shown_)
            return;
        if (! live_)
        {
            viewHidden_ = false;
            hideViewFirst_ = false;
            live_ = area_->beginLive();
            // Before the editor takes a size: its image as it stands.
            if (live_)
                updateLiveImage();
        }
        liveTouched_ = std::chrono::steady_clock::now();
    }

    void HostWindow::endLive()
    {
        live_ = false;
        area_->endLive();
        if (liveTexture_ != nullptr)
            SDL_DestroyTexture(liveTexture_);
        liveTexture_ = nullptr;
    }

    void HostWindow::updateLiveImage()
    {
        const auto image = area_->takeImage();
        if (! image)
            return;
        if (image->partial && liveTexture_ != nullptr)
        {
            hideViewFirst_ = true;
            return;
        }
        if (liveTexture_ == nullptr || liveWidth_ != image->width || liveHeight_ != image->height)
        {
            if (liveTexture_ != nullptr)
                SDL_DestroyTexture(liveTexture_);
            liveTexture_ = SDL_CreateTexture(renderer_, SDL_PIXELFORMAT_XRGB8888, SDL_TEXTUREACCESS_STREAMING,
                                             image->width, image->height);
            if (liveTexture_ == nullptr)
                return;
            liveWidth_ = image->width;
            liveHeight_ = image->height;
        }
        SDL_UpdateTexture(liveTexture_, nullptr, image->pixels, image->pitch);
        livePartial_ = image->partial;
        // The window manager has resized the window and waits for this frame,
        // which it shows as the new size: the final layout, not the view's.
        if (image->first && ! image->partial && std::chrono::steady_clock::now() - windowResizedAt_ < windowAnswer)
        {
            hideViewFirst_ = true;
            livePart_.reset();
        }
        else if (image->first)
        {
            const auto width = static_cast<float>(image->width);
            const auto height = static_cast<float>(image->height);
            livePart_ = LivePart { static_cast<float>(image->shownX),
                                   static_cast<float>(image->shownY),
                                   static_cast<float>(image->validWidth),
                                   static_cast<float>(image->validHeight),
                                   static_cast<float>(image->validX) / width,
                                   static_cast<float>(image->validY) / height,
                                   static_cast<float>(image->validX + image->validWidth) / width,
                                   static_cast<float>(image->validY + image->validHeight) / height };
        }
        else
        {
            livePart_.reset();
        }
        forcePresent_ = true;
    }

    std::pair<int, int> HostWindow::stageEditorSize() const
    {
        const auto [width, height] = windowSize();
        const float padding = paddingSpace();
        const float panel = panelSpace();
        return { std::max(1, static_cast<int>(static_cast<float>(width) - panel - 2 * padding)),
                 std::max(1, static_cast<int>(static_cast<float>(height) - padding - dockHeight())) };
    }

    void HostWindow::pump()
    {
        if (closing_)
            return;
        ImGui::SetCurrentContext(context_);
        SDL_Event event;
#if defined(_WIN32)
        // The host's message loop dispatches the window's messages; SDL's
        // window procedure queues what they mean.
        while (SDL_PeepEvents(&event, 1, SDL_GETEVENT, SDL_EVENT_FIRST, SDL_EVENT_LAST) > 0)
#else
        while (SDL_PollEvent(&event))
#endif
        {
            handle(event);
            if (closing_)
                return;
        }
        const auto now = std::chrono::steady_clock::now();
        settleWindow(now);
        // A window manager that does not resize the window as asked.
        if (stagePanelOpen_ != panelOpen_ && now >= stageFollowsAt_)
        {
            stagePanelOpen_ = panelOpen_;
            layout();
        }
        // Only once the geometry changes: a press alone changes nothing, and
        // starts nothing. Held, it goes on through a pause in the drag.
        if (gripSize_ || (live_ && interface_->resizingEditor()))
            touchLive();
        else if (live_ && now - liveTouched_ >= liveQuiet && area_->whole())
        {
            endLive();
            forcePresent_ = true;
            invalidate();
        }
        if (now - lastFrame_ >= refreshInterval || interface_->animating() || live_)
            invalidate(1);
        if (pending_ > 0 && now >= nextFrame_)
        {
            // Skip missed deadlines rather than rendering catch-up frames.
            nextFrame_ += frameInterval_ * ((now - nextFrame_) / frameInterval_ + 1);
            render();
        }
    }

    void HostWindow::settleWindow(std::chrono::steady_clock::time_point now)
    {
        if (! settling_)
            return;
        if (askedSize_ && now >= askedUntil_)
            askedSize_.reset();
        // Not before the editor has its last size from the drag.
        if (askedSize_ || gripSize_ || now - windowResizedAt_ < liveQuiet)
            return;
        // Fullscreen, the window's size is not its own to change.
        const bool matches = windowSize() == std::pair { editorWidth_, editorHeight_ };
        if (matches || settlingAsks_ >= settleAsks || (SDL_GetWindowFlags(window_) & SDL_WINDOW_FULLSCREEN) != 0)
        {
            settling_ = false;
            return;
        }
        ++settlingAsks_;
        fitWindow();
    }

    void HostWindow::windowResized()
    {
        area_->windowChanged();
        windowResizedAt_ = std::chrono::steady_clock::now();
        stagePanelOpen_ = panelOpen_;
        // Maximized, the next size is the restore's, which cuts the editor off
        // whichever way it goes: its top left is the part that says what it is.
        area_->keepTopLeft(bare_ || (SDL_GetWindowFlags(window_) & SDL_WINDOW_MAXIMIZED) != 0);
        if (bare_)
            bareWindowResized();
        // The stage around the editor changes, and its place on it.
        layout();
    }

    void HostWindow::bareWindowResized()
    {
        const auto [width, height] = windowSize();
        const auto last = std::exchange(draggedSize_, std::pair { width, height });
        // On its way to a size the host asked for: what comes before it is
        // older than the editor's size, and must not change the editor.
        if (askedSize_)
        {
            const bool arrived = std::abs(width - askedSize_->first) <= 2 && std::abs(height - askedSize_->second) <= 2;
            if (arrived || std::chrono::steady_clock::now() >= askedUntil_)
                askedSize_.reset();
            if (arrived || askedSize_)
                return;
        }
        if (! resizable_ || std::pair { width, height } == std::pair { editorWidth_, editorHeight_ })
            return;
        // Shown at once, and handed to the editor in render(), once it can take it.
        touchLive();
        settling_ = true;
        settlingAsks_ = 0;
        model_.plugin.previewEditorDrag(width, height, last.first, last.second);
        gripSize_ = std::pair { editorWidth_, editorHeight_ };
    }

    void HostWindow::handle(const SDL_Event& event)
    {
        const SDL_WindowID id = SDL_GetWindowID(window_);
        switch (event.type)
        {
            case SDL_EVENT_WINDOW_CLOSE_REQUESTED:
                if (event.window.windowID == id && callbacks_.closed)
                {
                    // The callback destroys this window.
                    closing_ = true;
                    loop_.post(callbacks_.closed);
                }
                return;
            case SDL_EVENT_WINDOW_RESIZED:
                if (event.window.windowID == id)
                    windowResized();
                return;
            case SDL_EVENT_WINDOW_FOCUS_GAINED:
            case SDL_EVENT_WINDOW_FOCUS_LOST:
                if (event.window.windowID == id && callbacks_.focusChanged)
                    callbacks_.focusChanged(event.type == SDL_EVENT_WINDOW_FOCUS_GAINED);
                break;
            case SDL_EVENT_DISPLAY_CURRENT_MODE_CHANGED:
            case SDL_EVENT_DISPLAY_DESKTOP_MODE_CHANGED:
                if (event.display.displayID == SDL_GetDisplayForWindow(window_))
                    applyRefreshRate();
                return;
            case SDL_EVENT_WINDOW_DISPLAY_CHANGED:
                if (event.window.windowID == id)
                    applyRefreshRate();
                return;
            case SDL_EVENT_WINDOW_DISPLAY_SCALE_CHANGED:
                if (event.window.windowID != id)
                    return;
                applyScale();
                fitWindow();
#if ! defined(__APPLE__)
                if (callbacks_.scaleChanged)
                    callbacks_.scaleChanged(scale());
#endif
                return;
            case SDL_EVENT_WINDOW_EXPOSED:
            case SDL_EVENT_WINDOW_SHOWN:
            case SDL_EVENT_WINDOW_PIXEL_SIZE_CHANGED:
                forcePresent_ = true;
                invalidate();
                return;
            default:
                break;
        }
        ImGui_ImplSDL3_ProcessEvent(&event);
        // Input moves hover and focus: a few frames let ImGui settle.
        invalidate(3);
    }

    void HostWindow::render()
    {
        // Apply the previous input frame's grip request before measuring and
        // drawing. The native editor and the host frame then share one size.
        if (const auto wanted = interface_->takeEditorSize())
        {
            gripSize_ = wanted;
            model_.plugin.previewEditorSize(wanted->first, wanted->second);
        }
        if (live_)
            updateLiveImage();
        pending_ = std::max(0, pending_ - 1);
        lastFrame_ = std::chrono::steady_clock::now();
        ImGui::SetCurrentContext(context_);

        const auto [width, height] = windowSize();
        const float panel = panelSpace();
        InterfaceLayout layout;
        layout.width = static_cast<float>(width);
        layout.height = static_cast<float>(height);
        layout.scale = scale_;
        layout.panelWidth = panel;
        layout.editorX = static_cast<float>(editorFrame_[0]);
        layout.editorY = static_cast<float>(editorFrame_[1]);
        layout.editorWidth = static_cast<float>(editorWidth_);
        layout.editorHeight = static_cast<float>(editorHeight_);
        layout.resizable = resizable_;
        layout.editorImage = live_ ? liveTexture_ : nullptr;
        const bool part = livePart_.has_value();
        layout.editorImageX = part ? livePart_->x : layout.editorX;
        layout.editorImageY = part ? livePart_->y : layout.editorY;
        layout.editorImageWidth = part ? livePart_->width : layout.editorWidth;
        layout.editorImageHeight = part ? livePart_->height : layout.editorHeight;
        layout.editorImageU0 = part ? livePart_->u0 : 0;
        layout.editorImageV0 = part ? livePart_->v0 : 0;
        layout.editorImageU1 = part ? livePart_->u1 : 1;
        layout.editorImageV1 = part ? livePart_->v1 : 1;

        ImGui_ImplSDLRenderer3_NewFrame();
        ImGui_ImplSDL3_NewFrame();
        ImGui::NewFrame();
        interface_->draw(layout);
        ImGui::Render();

        ImDrawData* data = ImGui::GetDrawData();
        const uint64_t hash = hashDrawData(data);
        if (hash != lastHash_ || forcePresent_ || texturesChanging(data))
        {
            lastHash_ = hash;
            forcePresent_ = false;
            SDL_SetRenderScale(renderer_, data->FramebufferScale.x, data->FramebufferScale.y);
            SDL_SetRenderDrawColor(renderer_, 0x0b, 0x0c, 0x0f, 0xff);
            SDL_RenderClear(renderer_);
            ImGui_ImplSDLRenderer3_RenderDrawData(data, renderer_);
            // A development aid: SOUNDOR_VST3_HOST_CAPTURE=<file.png> keeps
            // the interface's last frame (without the editor, which draws
            // itself).
            if (const char* capture = std::getenv("SOUNDOR_VST3_HOST_CAPTURE"); // NOLINT(concurrency-mt-unsafe)
                capture != nullptr && *capture != '\0')
                if (SDL_Surface* pixels = SDL_RenderReadPixels(renderer_, nullptr))
                {
                    SDL_SavePNG(pixels, capture);
                    SDL_DestroySurface(pixels);
                }
            // The last whole image is not where the view is: the view goes first.
            const bool shown = live_ && layout.editorImage != nullptr;
            if (shown && hideViewFirst_)
                viewHidden_ = area_->hideView();
            SDL_RenderPresent(renderer_);
            // The image is exactly what the view shows, so nothing changes.
            if (shown && ! viewHidden_ && area_->hideView())
            {
                viewHidden_ = true;
                if (! livePartial_)
                    livePart_.reset();
                forcePresent_ = true;
                invalidate();
            }
            ++presented_;
        }

        // After presenting: the frame at the new size shows the editor's last
        // image while the editor takes its time over the size.
        if (gripSize_ && area_->settled())
        {
            const std::pair wanted = *gripSize_;
            gripSize_.reset();
            model_.emit("editorResized", model_.plugin.requestEditorSize(wanted.first, wanted.second));
            area_->editorGiven(editorWidth_, editorHeight_);
        }
        // The panel opened or closed: the window grows or shrinks beside the
        // stage, which stays as it is. A dock wider than the window makes room
        // for itself.
        if (interface_->panelOpen() != panelOpen_)
        {
            panelOpen_ = interface_->panelOpen();
            const int change = static_cast<int>(std::ceil(HostInterface::panelWidth * scale_));
            fitWindow(panelOpen_ ? change : -change);
        }
        else if (const auto natural = naturalSize();
                 ! settling_ && (SDL_GetWindowFlags(window_) & SDL_WINDOW_MAXIMIZED) == 0 && natural != fitted_
                 && (width < requiredSize().first || height < requiredSize().second))
            fitWindow();
    }
} // namespace soundor::vst3host
