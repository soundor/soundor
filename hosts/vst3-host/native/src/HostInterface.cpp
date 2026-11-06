#include "HostInterface.h"

#include <SDL3/SDL.h>
#include <imgui.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <cstdio>

namespace soundor::vst3host
{
    namespace
    {
        // The web runtime's palette (shell/style.ts).
        constexpr ImU32 background = IM_COL32(0x0b, 0x0c, 0x0f, 0xff);
        constexpr ImU32 surface = IM_COL32(0x15, 0x16, 0x1a, 0xff);
        constexpr ImU32 line = IM_COL32(0x2a, 0x2c, 0x33, 0xff);
        constexpr ImU32 text = IM_COL32(0xe6, 0xe7, 0xea, 0xff);
        constexpr ImU32 muted = IM_COL32(0x8b, 0x8f, 0x98, 0xff);
        constexpr ImU32 accent = IM_COL32(0x3a, 0x7b, 0xfd, 0xff);
        constexpr ImU32 accentSoft = IM_COL32(0x3a, 0x7b, 0xfd, 0x33);
        constexpr ImU32 accentText = IM_COL32(0x8f, 0xb3, 0xff, 0xff);
        constexpr ImU32 hover = IM_COL32(0xff, 0xff, 0xff, 0x14);
        constexpr ImU32 good = IM_COL32(0x34, 0xc7, 0x7b, 0xff);
        constexpr ImU32 warn = IM_COL32(0xf2, 0xb1, 0x3a, 0xff);
        constexpr ImU32 bad = IM_COL32(0xff, 0x6b, 0x5e, 0xff);
        constexpr ImU32 dock = IM_COL32(0x1d, 0x1f, 0x24, 0xe0);

        constexpr std::array<const char*, 7> timeSignatures { "2/4", "3/4", "4/4", "5/4", "6/8", "7/8", "12/8" };
        constexpr int keyboardLow = 48;  // C3
        constexpr int keyboardHigh = 72; // C5

        enum class Icon
        {
            play,
            pause,
            stop,
            speaker,
            muted,
            panel,
            close,
        };

        ImVec4 color(ImU32 value)
        {
            return ImGui::ColorConvertU32ToFloat4(value);
        }

        // The web runtime's icons, drawn in their 24 × 24 box.
        void drawIcon(ImDrawList* list, Icon icon, ImVec2 center, float size, ImU32 colour)
        {
            const float unit = size / 24.0F;
            const ImVec2 origin(center.x - size / 2, center.y - size / 2);
            auto at = [&](float x, float y) { return ImVec2(origin.x + x * unit, origin.y + y * unit); };
            const float stroke = 2.0F * unit;
            auto speaker = [&]
            {
                const std::array<ImVec2, 6> body { at(4, 9.5F),   at(7.5F, 9.5F),  at(12, 5.5F),
                                                   at(12, 18.5F), at(7.5F, 14.5F), at(4, 14.5F) };
                list->AddConvexPolyFilled(body.data(), static_cast<int>(body.size()), colour);
            };
            switch (icon)
            {
                case Icon::play:
                    list->AddTriangleFilled(at(8, 5.5F), at(18.5F, 12), at(8, 18.5F), colour);
                    break;
                case Icon::pause:
                    list->AddRectFilled(at(7, 5), at(10.5F, 19), colour);
                    list->AddRectFilled(at(13.5F, 5), at(17, 19), colour);
                    break;
                case Icon::stop:
                    list->AddRectFilled(at(6.5F, 6.5F), at(17.5F, 17.5F), colour);
                    break;
                case Icon::speaker:
                    speaker();
                    list->PathArcTo(at(12, 12), 4 * unit, -0.85F, 0.85F, 12);
                    list->PathStroke(colour, stroke);
                    list->PathArcTo(at(11, 12), 7.5F * unit, -0.9F, 0.9F, 16);
                    list->PathStroke(colour, stroke);
                    break;
                case Icon::muted:
                    speaker();
                    list->AddLine(at(16, 9.5F), at(21, 14.5F), colour, stroke);
                    list->AddLine(at(21, 9.5F), at(16, 14.5F), colour, stroke);
                    break;
                case Icon::panel:
                    list->AddLine(at(4, 7), at(14, 7), colour, stroke);
                    list->AddLine(at(18, 7), at(20, 7), colour, stroke);
                    list->AddLine(at(4, 17), at(8, 17), colour, stroke);
                    list->AddLine(at(12, 17), at(20, 17), colour, stroke);
                    list->AddCircle(at(16, 7), 2 * unit, colour, 12, stroke);
                    list->AddCircle(at(10, 17), 2 * unit, colour, 12, stroke);
                    break;
                case Icon::close:
                    list->AddLine(at(6, 6), at(18, 18), colour, stroke);
                    list->AddLine(at(18, 6), at(6, 18), colour, stroke);
                    break;
            }
        }

        // The Soundor icon, in its 108 × 108 box (viewBox 6 6 108 108).
        void drawLogo(ImDrawList* list, ImVec2 origin, float size)
        {
            const float unit = size / 108.0F;
            auto at = [&](float x, float y) { return ImVec2(origin.x + (x - 6) * unit, origin.y + (y - 6) * unit); };
            list->AddRectFilled(origin, ImVec2(origin.x + size, origin.y + size), IM_COL32(0xf2, 0xf4, 0xf7, 0xff),
                                30 * unit);
            const ImU32 ink = IM_COL32(0x0e, 0x0f, 0x12, 0xff);
            const std::array<ImVec2, 3> left { at(38, 42), at(24, 60), at(38, 78) };
            const std::array<ImVec2, 3> right { at(82, 42), at(96, 60), at(82, 78) };
            list->AddPolyline(left.data(), 3, ink, 7 * unit);
            list->AddPolyline(right.data(), 3, ink, 7 * unit);
            const ImU32 orange = IM_COL32(0xff, 0x5a, 0x1f, 0xff);
            const std::array<std::array<float, 3>, 5> bars {
                { { 48, 64, 56 }, { 54, 69, 51 }, { 60, 74, 46 }, { 66, 68, 52 }, { 72, 63, 57 } }
            };
            for (const auto& [x, from, to] : bars)
                list->AddLine(at(x, from), at(x, to), orange, 4.5F * unit);
        }

        /** The position as bar.beat (1-based), in the time signature's beats. */
        std::string barBeat(const Transport& transport, double sampleRate)
        {
            const double quarters = static_cast<double>(transport.samplePosition) / sampleRate * transport.tempo / 60.0;
            const double beatLength = 4.0 / transport.denominator;
            const double barLength = transport.numerator * beatLength;
            const double bar = std::floor(quarters / barLength);
            const double beat = std::floor((quarters - bar * barLength) / beatLength);
            char buffer[32];
            std::snprintf(buffer, sizeof buffer, "%.0f.%.0f", bar + 1, beat + 1);
            return buffer;
        }

        bool blackKey(int pitch)
        {
            const int note = pitch % 12;
            return note == 1 || note == 3 || note == 6 || note == 8 || note == 10;
        }
    } // namespace

    HostInterface::HostInterface(EventLoop& loop, HostModel& model, SDL_Window* window, ImFont* semibold, bool bare)
        : bare_(bare),
          loop_(loop),
          model_(model),
          window_(window),
          semibold_(semibold),
          panelOpen_(! bare && model.settings.panelOpen)
    {
    }

    bool HostInterface::animating() const
    {
        return wantedSize_.has_value() || model_.audio.running() || meters_[0] > 0.001F || meters_[1] > 0.001F;
    }

    void HostInterface::startAudio()
    {
        audioFailure_.clear();
        try
        {
            model_.audio.start();
        }
        catch (const std::exception& error)
        {
            audioFailure_ = error.what();
        }
        audioChanged();
    }

    void HostInterface::audioChanged() const
    {
        model_.emit("audioChanged", model_.audio.status());
    }

    void HostInterface::play()
    {
        if (! model_.audio.running())
            startAudio();
        model_.plugin.editTransport([](Transport& transport) { transport.playing = true; });
    }

    void HostInterface::noteOn(int pitch)
    {
        if (! model_.audio.running())
            startAudio();
        noteOff();
        Vst::Event event {};
        event.type = Vst::Event::kNoteOnEvent;
        event.noteOn.pitch = static_cast<int16>(pitch);
        event.noteOn.velocity = 0.8F;
        event.noteOn.noteId = -1;
        model_.plugin.queueEvent(event);
        heldNote_ = pitch;
    }

    void HostInterface::noteOff()
    {
        if (heldNote_ < 0)
            return;
        Vst::Event event {};
        event.type = Vst::Event::kNoteOffEvent;
        event.noteOff.pitch = static_cast<int16>(heldNote_);
        event.noteOff.velocity = 0.8F;
        event.noteOff.noteId = -1;
        model_.plugin.queueEvent(event);
        heldNote_ = -1;
    }

    void HostInterface::chooseFile()
    {
        static const SDL_DialogFileFilter filters[] = { { "WAV audio", "wav;wave" } };
        SDL_ShowOpenFileDialog(
            [](void* self, const char* const* files, int /*filter*/)
            {
                // Any thread; the interface's work is on the main one.
                if (files == nullptr || files[0] == nullptr)
                    return;
                auto* interface = static_cast<HostInterface*>(self);
                const std::string path = files[0];
                interface->loop_.post(
                    [interface, path]
                    {
                        interface->audioFailure_.clear();
                        try
                        {
                            interface->model_.audio.setInput(AudioInput::file, path);
                        }
                        catch (const std::exception& error)
                        {
                            interface->audioFailure_ = error.what();
                        }
                        interface->audioChanged();
                    });
            },
            this, window_, filters, 1, nullptr, false);
    }

    // ── Drawing ──────────────────────────────────────────────────────────

    void HostInterface::draw(const InterfaceLayout& layout)
    {
        scale_ = layout.scale;
        if (bare_)
        {
            if (layout.editorImage != nullptr)
                drawEditorImage(layout);
            return;
        }
        if (parameterGeneration_ != model_.plugin.parameterGeneration())
        {
            parameterGeneration_ = model_.plugin.parameterGeneration();
            parameters_ = model_.plugin.hostParameters();
            // The bypass a plugin framework adds beside the plugin's own, of
            // the same name: the panel shows one, as the web panel does.
            std::erase_if(parameters_,
                          [this](const HostParameter& parameter)
                          {
                              return parameter.bypass
                                     && std::ranges::any_of(parameters_,
                                                            [&parameter](const HostParameter& other) {
                                                                return ! other.bypass && other.title == parameter.title;
                                                            });
                          });
        }
        // Preserve the meter's release time across different display rates.
        const float decay = std::pow(0.85F, ImGui::GetIO().DeltaTime / 0.033F);
        for (int side = 0; side < 2; ++side)
            meters_[side] = std::max(model_.audio.takePeak(side), meters_[side] * decay);
        if (heldNote_ >= 0 && ! ImGui::IsMouseDown(ImGuiMouseButton_Left))
            noteOff();

        drawStage(layout);
        drawDock(layout);
        if (layout.resizable)
            drawResizeGrip(layout);
        if (panelOpen_)
            drawPanel(layout);
    }

    std::optional<std::pair<int, int>> HostInterface::takeEditorSize()
    {
        return std::exchange(wantedSize_, std::nullopt);
    }

    std::pair<float, float> HostInterface::pointer() const
    {
        float x = 0;
        float y = 0;
        int windowX = 0;
        int windowY = 0;
        // The window's own coordinates, inside or outside it.
        SDL_GetGlobalMouseState(&x, &y);
        SDL_GetWindowPosition(window_, &windowX, &windowY);
        return { x - static_cast<float>(windowX), y - static_cast<float>(windowY) };
    }

    void HostInterface::drawResizeGrip(const InterfaceLayout& layout)
    {
        const ImVec2 origin(layout.editorX + layout.editorWidth, layout.editorY + layout.editorHeight);
        const float size = 14 * scale_;
        ImGui::SetNextWindowPos(origin);
        ImGui::SetNextWindowSize(ImVec2(size, size));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0);
        ImGui::Begin("resize-grip", nullptr,
                     ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings
                         | ImGuiWindowFlags_NoBackground | ImGuiWindowFlags_NoBringToFrontOnFocus);
        ImGui::InvisibleButton("Resize the plugin view", ImVec2(size, size));
        const bool hovered = ImGui::IsItemHovered();
        const bool active = ImGui::IsItemActive();
        gripActive_ = active;
        if (hovered || active)
            ImGui::SetMouseCursor(ImGuiMouseCursor_ResizeNWSE);
        ImGui::GetWindowDrawList()->AddTriangleFilled(ImVec2(origin.x + 3 * scale_, origin.y + 11 * scale_),
                                                      ImVec2(origin.x + 11 * scale_, origin.y + 3 * scale_),
                                                      ImVec2(origin.x + 11 * scale_, origin.y + 11 * scale_),
                                                      hovered || active ? text : muted);
        if (ImGui::IsItemActivated())
        {
            const auto [x, y] = pointer();
            dragX_ = x - origin.x;
            dragY_ = y - origin.y;
            dragWanted_ = { static_cast<int>(layout.editorWidth), static_cast<int>(layout.editorHeight) };
        }
        // Also on the release: it can come in one frame with the last move.
        if (active || ImGui::IsItemDeactivated())
        {
            // The corner stays under the pointer, as the web host's handle
            // does: the editor is centred, so it grows twice as far as the
            // pointer moves, and stops at the stage's room. The window never
            // grows for it.
            const auto [x, y] = pointer();
            const float cornerX = x - dragX_;
            const float cornerY = y - dragY_;
            const float pad = padding * scale_;
            const float dock = dockSpace * scale_;
            const float stage = layout.width - layout.panelWidth;
            const float roomX = stage - 2 * pad;
            const float roomY = layout.height - pad - dock;
            const float width = std::min(2 * (cornerX - stage / 2), std::max(roomX, layout.editorWidth));
            const float height =
                std::min(2 * (cornerY - (layout.height + pad - dock) / 2), std::max(roomY, layout.editorHeight));
            const std::pair wanted { std::max(1, static_cast<int>(std::round(width))),
                                     std::max(1, static_cast<int>(std::round(height))) };
            if (wanted != dragWanted_)
            {
                dragWanted_ = wanted;
                wantedSize_ = wanted;
            }
        }
        else
            ImGui::SetItemTooltip("Resize the plugin view (%d × %d)", static_cast<int>(layout.editorWidth),
                                  static_cast<int>(layout.editorHeight));
        ImGui::End();
        ImGui::PopStyleVar(2);
    }

    void HostInterface::drawStage(const InterfaceLayout& layout) const
    {
        ImDrawList* list = ImGui::GetBackgroundDrawList();
        const float stageWidth = layout.width - layout.panelWidth;
        const float right = layout.editorX + layout.editorWidth;
        const float bottom = layout.editorY + layout.editorHeight;
        list->AddRectFilled(ImVec2(0, 0), ImVec2(stageWidth, layout.editorY), background);
        list->AddRectFilled(ImVec2(0, bottom), ImVec2(stageWidth, layout.height), background);
        list->AddRectFilled(ImVec2(0, layout.editorY), ImVec2(layout.editorX, bottom), background);
        list->AddRectFilled(ImVec2(right, layout.editorY), ImVec2(stageWidth, bottom), background);
        // The web stage's dot grid.
        const float step = 20 * scale_;
        const ImU32 dot = IM_COL32(0xff, 0xff, 0xff, 0x0d);
        const auto rows = static_cast<int>(layout.height / step);
        const auto columns = static_cast<int>(stageWidth / step);
        for (int row = 0; row <= rows; ++row)
            for (int column = 0; column <= columns; ++column)
            {
                const float x = (static_cast<float>(column) + 0.5F) * step;
                const float y = (static_cast<float>(row) + 0.5F) * step;
                if (x + scale_ <= layout.editorX || x >= right || y + scale_ <= layout.editorY || y >= bottom)
                    list->AddRectFilled(ImVec2(x, y), ImVec2(x + scale_, y + scale_), dot);
            }
        // A frame around the editor; the editor itself covers the inside.
        const ImVec2 min(layout.editorX, layout.editorY);
        const ImVec2 max(layout.editorX + layout.editorWidth, layout.editorY + layout.editorHeight);
        for (int ring = 1; ring <= 6; ++ring)
        {
            const auto spread = static_cast<float>(ring) * 3 * scale_;
            list->AddRect(ImVec2(min.x - spread, min.y - spread + 4 * scale_),
                          ImVec2(max.x + spread, max.y + spread + 8 * scale_), IM_COL32(0, 0, 0, 40 - ring * 6),
                          6 * scale_ + spread, 3 * scale_);
        }
        list->AddRect(ImVec2(min.x - 1, min.y - 1), ImVec2(max.x + 1, max.y + 1), line, 0, 1.0F);
        if (layout.editorImage != nullptr)
            drawEditorImage(layout);
    }

    void HostInterface::drawEditorImage(const InterfaceLayout& layout)
    {
        ImGui::GetBackgroundDrawList()->AddImage(
            reinterpret_cast<ImTextureID>(layout.editorImage), ImVec2(layout.editorImageX, layout.editorImageY),
            ImVec2(layout.editorImageX + layout.editorImageWidth, layout.editorImageY + layout.editorImageHeight),
            ImVec2(layout.editorImageU0, layout.editorImageV0), ImVec2(layout.editorImageU1, layout.editorImageV1));
    }

    void HostInterface::drawDock(const InterfaceLayout& layout)
    {
        const float stageWidth = layout.width - layout.panelWidth;
        const float height = 42 * scale_;
        const float width = dockWidth_ * scale_;
        ImGui::SetNextWindowPos(
            ImVec2(std::floor((stageWidth - width) / 2), std::floor(layout.height - 16 * scale_ - height)));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowRounding, 12 * scale_);
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(4 * scale_, 4 * scale_));
        ImGui::PushStyleVar(ImGuiStyleVar_ItemSpacing, ImVec2(4 * scale_, 0));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 1);
        ImGui::PushStyleColor(ImGuiCol_WindowBg, color(dock));
        ImGui::PushStyleColor(ImGuiCol_Border, color(line));
        ImGui::Begin("dock", nullptr,
                     ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings
                         | ImGuiWindowFlags_AlwaysAutoResize | ImGuiWindowFlags_NoFocusOnAppearing
                         | ImGuiWindowFlags_NoBringToFrontOnFocus);
        ImDrawList* list = ImGui::GetWindowDrawList();
        const float button = 32 * scale_;

        auto iconButton = [&](const char* id, Icon icon, const char* tip, bool pressed, ImU32 tint = text)
        {
            const bool clicked = ImGui::InvisibleButton(id, ImVec2(button, button));
            const ImVec2 min = ImGui::GetItemRectMin();
            const ImVec2 max = ImGui::GetItemRectMax();
            if (pressed)
                list->AddRectFilled(min, max, accentSoft, 8 * scale_);
            else if (ImGui::IsItemHovered())
                list->AddRectFilled(min, max, hover, 8 * scale_);
            drawIcon(list, icon, ImVec2((min.x + max.x) / 2, (min.y + max.y) / 2), 18 * scale_,
                     pressed ? accentText : tint);
            ImGui::SetItemTooltip("%s", tip);
            ImGui::SameLine();
            return clicked;
        };
        auto divider = [&]
        {
            const ImVec2 at = ImGui::GetCursorScreenPos();
            const float x = at.x + 4 * scale_;
            list->AddLine(ImVec2(x, at.y + 6 * scale_), ImVec2(x, at.y + button - 6 * scale_), line, 1);
            ImGui::Dummy(ImVec2(9 * scale_, button));
            ImGui::SameLine();
        };

        LiveAudio& audio = model_.audio;
        const bool failed = ! audio.running() && ! audioFailure_.empty();
        const bool silent = audio.muted();
        const char* audioTip = failed ? "Retry audio" : ! audio.running() ? "Start audio" : silent ? "Unmute" : "Mute";
        if (iconButton("audio", silent ? Icon::muted : Icon::speaker, audioTip, audio.running() && silent,
                       failed            ? bad
                       : audio.running() ? text
                                         : muted))
        {
            if (! audio.running())
                startAudio();
            else
            {
                audio.setMuted(! silent);
                audioChanged();
            }
        }

        // Volume: a thin track and a knob, with a meter under the track.
        {
            const ImVec2 size(84 * scale_, button);
            ImGui::InvisibleButton("volume", size);
            const ImVec2 min = ImGui::GetItemRectMin();
            const float left = min.x + 6 * scale_;
            const float right = min.x + size.x - 6 * scale_;
            if (ImGui::IsItemActive())
            {
                const float value = (ImGui::GetIO().MousePos.x - left) / (right - left);
                audio.setVolume(std::clamp(value, 0.0F, 1.0F));
                model_.settings.volume = audio.volume();
            }
            if (ImGui::IsItemDeactivated())
            {
                model_.settings.save();
                audioChanged();
            }
            const float y = min.y + size.y / 2;
            const auto volume = static_cast<float>(audio.volume());
            const float knob = left + (right - left) * volume;
            list->AddRectFilled(ImVec2(left, y - 2 * scale_), ImVec2(right, y + 2 * scale_), line, 2 * scale_);
            list->AddRectFilled(ImVec2(left, y - 2 * scale_), ImVec2(knob, y + 2 * scale_), silent ? muted : accent,
                                2 * scale_);
            const float level = std::min(1.0F, std::max(meters_[0], meters_[1]));
            if (level > 0.001F)
                list->AddRectFilled(ImVec2(left, y + 5 * scale_), ImVec2(left + (right - left) * level, y + 7 * scale_),
                                    level > 0.99F  ? bad
                                    : level > 0.7F ? warn
                                                   : good,
                                    scale_);
            list->AddCircleFilled(ImVec2(knob, y), 6 * scale_,
                                  ImGui::IsItemHovered() || ImGui::IsItemActive() ? IM_COL32(0xff, 0xff, 0xff, 0xff)
                                                                                  : text);
            ImGui::SetItemTooltip("Output volume");
            ImGui::SameLine();
        }
        divider();

        const Transport transport = model_.plugin.transport();
        if (iconButton("play", transport.playing ? Icon::pause : Icon::play, transport.playing ? "Pause" : "Play",
                       transport.playing))
        {
            if (transport.playing)
                model_.plugin.editTransport([](Transport& edited) { edited.playing = false; });
            else
                play();
        }
        if (iconButton("stop", Icon::stop, "Stop", false))
            model_.plugin.editTransport(
                [](Transport& edited)
                {
                    edited.playing = false;
                    edited.samplePosition = 0;
                });
        {
            const std::string position = barBeat(transport, model_.plugin.setup().sampleRate);
            const ImVec2 size(48 * scale_, button);
            const ImVec2 at = ImGui::GetCursorScreenPos();
            ImGui::Dummy(size);
            const ImVec2 textSize = ImGui::CalcTextSize(position.c_str());
            list->AddText(ImVec2(at.x + (size.x - textSize.x) / 2, at.y + (size.y - textSize.y) / 2),
                          transport.playing ? text : muted, position.c_str());
            ImGui::SetItemTooltip("Position (bar.beat)");
            ImGui::SameLine();
        }
        divider();
        if (iconButton("panel", Icon::panel, "Host settings", panelOpen_))
        {
            panelOpen_ = ! panelOpen_;
            model_.settings.panelOpen = panelOpen_;
            model_.settings.save();
        }
        ImGui::NewLine();
        dockWidth_ = ImGui::GetWindowSize().x / scale_;
        ImGui::End();
        ImGui::PopStyleColor(2);
        ImGui::PopStyleVar(4);
    }

    bool HostInterface::section(const char* title, bool collapsible)
    {
        // Sections are divided as the web panel's: a line across the panel.
        ImGui::Dummy(ImVec2(0, 6 * scale_));
        if (! firstSection_)
        {
            const float y = ImGui::GetCursorScreenPos().y;
            const float left = ImGui::GetWindowPos().x;
            ImGui::GetWindowDrawList()->AddLine(ImVec2(left, y), ImVec2(left + ImGui::GetWindowWidth(), y), line, 1);
            ImGui::Dummy(ImVec2(0, 8 * scale_));
        }
        firstSection_ = false;
        std::string label = title;
        for (char& c : label)
            c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        ImGui::PushFont(semibold_, 11);
        ImGui::PushStyleColor(ImGuiCol_Text, color(muted));
        bool open = true;
        if (collapsible)
        {
            ImGui::PushStyleColor(ImGuiCol_HeaderHovered, ImVec4(0, 0, 0, 0));
            ImGui::PushStyleColor(ImGuiCol_HeaderActive, ImVec4(0, 0, 0, 0));
            open = ImGui::TreeNodeEx(label.c_str(),
                                     ImGuiTreeNodeFlags_NoTreePushOnOpen | ImGuiTreeNodeFlags_SpanAvailWidth);
            ImGui::PopStyleColor(2);
        }
        else
            ImGui::TextUnformatted(label.c_str());
        ImGui::PopStyleColor();
        ImGui::PopFont();
        if (open)
            ImGui::Dummy(ImVec2(0, 2 * scale_));
        return open;
    }

    bool HostInterface::rangeSlider(const char* id, double& value, double defaultValue) const
    {
        // A range input, as the web panel's: a track, its filled part and a knob.
        const float height = 20 * scale_;
        const ImVec2 size(ImGui::GetContentRegionAvail().x, height);
        ImGui::InvisibleButton(id, size);
        const ImVec2 min = ImGui::GetItemRectMin();
        const float knobRadius = 7 * scale_;
        const float left = min.x + knobRadius;
        const float right = min.x + size.x - knobRadius;
        bool changed = false;
        const bool enabled = (ImGui::GetItemFlags() & ImGuiItemFlags_Disabled) == 0;
        if (ImGui::IsItemActive() && enabled)
        {
            const double next = std::clamp((ImGui::GetIO().MousePos.x - left) / (right - left), 0.0F, 1.0F);
            changed = next != value;
            value = next;
        }
        if (enabled && ImGui::IsItemHovered() && ImGui::IsMouseDoubleClicked(ImGuiMouseButton_Left))
        {
            value = defaultValue;
            changed = true;
        }
        ImDrawList* list = ImGui::GetWindowDrawList();
        const float y = min.y + height / 2;
        const float knob = left + (right - left) * static_cast<float>(value);
        list->AddRectFilled(ImVec2(left, y - 2 * scale_), ImVec2(right, y + 2 * scale_), line, 2 * scale_);
        list->AddRectFilled(ImVec2(left, y - 2 * scale_), ImVec2(knob, y + 2 * scale_), enabled ? accent : muted,
                            2 * scale_);
        list->AddCircleFilled(ImVec2(knob, y), knobRadius,
                              ! enabled                                         ? muted
                              : ImGui::IsItemHovered() || ImGui::IsItemActive() ? IM_COL32(0xff, 0xff, 0xff, 0xff)
                                                                                : text);
        return changed;
    }

    void HostInterface::drawPanel(const InterfaceLayout& layout)
    {
        const float x = layout.width - layout.panelWidth;
        ImGui::SetNextWindowPos(ImVec2(x, 0));
        ImGui::SetNextWindowSize(ImVec2(layout.panelWidth, layout.height));
        ImGui::PushStyleColor(ImGuiCol_WindowBg, color(surface));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(0, 0));
        ImGui::PushStyleVar(ImGuiStyleVar_WindowBorderSize, 0);
        ImGui::Begin("panel", nullptr,
                     ImGuiWindowFlags_NoDecoration | ImGuiWindowFlags_NoMove | ImGuiWindowFlags_NoSavedSettings
                         | ImGuiWindowFlags_NoBringToFrontOnFocus);
        ImDrawList* list = ImGui::GetWindowDrawList();
        list->AddLine(ImVec2(x, 0), ImVec2(x, layout.height), line, 1);

        // Header: the logo, the plugin's name and the close button.
        {
            const float height = 52 * scale_;
            const ImVec2 origin = ImGui::GetCursorScreenPos();
            drawLogo(list, ImVec2(origin.x + 16 * scale_, origin.y + 12 * scale_), 28 * scale_);
            ImGui::PushFont(semibold_, 13);
            const std::string name = model_.plugin.name();
            list->AddText(ImVec2(origin.x + 54 * scale_, origin.y + 9 * scale_), text, name.c_str());
            ImGui::PopFont();
            ImGui::PushFont(nullptr, 11);
            list->AddText(ImVec2(origin.x + 54 * scale_, origin.y + 28 * scale_), muted, "Soundor VST3 host");
            ImGui::PopFont();
            ImGui::SetCursorScreenPos(ImVec2(origin.x + layout.panelWidth - 40 * scale_, origin.y + 10 * scale_));
            const float button = 32 * scale_;
            if (ImGui::InvisibleButton("close", ImVec2(button, button)))
            {
                panelOpen_ = false;
                model_.settings.panelOpen = false;
                model_.settings.save();
            }
            const ImVec2 min = ImGui::GetItemRectMin();
            const ImVec2 max = ImGui::GetItemRectMax();
            if (ImGui::IsItemHovered())
                list->AddRectFilled(min, max, hover, 8 * scale_);
            drawIcon(list, Icon::close, ImVec2((min.x + max.x) / 2, (min.y + max.y) / 2), 18 * scale_, text);
            ImGui::SetItemTooltip("Close");
            ImGui::SetCursorScreenPos(ImVec2(origin.x, origin.y + height));
            list->AddLine(ImVec2(x, origin.y + height), ImVec2(layout.width, origin.y + height), line, 1);
            ImGui::Dummy(ImVec2(1, 1));
        }

        ImGui::PushStyleVar(ImGuiStyleVar_WindowPadding, ImVec2(16 * scale_, 8 * scale_));
        ImGui::BeginChild("body", ImVec2(0, 0), ImGuiChildFlags_AlwaysUseWindowPadding);
        ImGui::PushItemWidth(-1);
        firstSection_ = true;
        drawTransport();
        drawAudio();
        if (model_.plugin.hasEventInput())
            drawKeyboard();
        drawParameters();
        drawPlugin();
        drawSettings();
        ImGui::PopItemWidth();
        ImGui::EndChild();
        ImGui::PopStyleVar();

        ImGui::End();
        ImGui::PopStyleVar(2);
        ImGui::PopStyleColor();
    }

    namespace
    {
        /** A row: a muted label, and a control of `width` units at the right. */
        void rowLabel(const char* label, float width, float scale)
        {
            const float right = ImGui::GetCursorPosX() + ImGui::GetContentRegionAvail().x;
            ImGui::AlignTextToFramePadding();
            ImGui::TextColored(color(muted), "%s", label);
            ImGui::SameLine(right - width * scale);
            ImGui::SetNextItemWidth(width * scale);
        }
    } // namespace

    void HostInterface::drawTransport()
    {
        if (! section("Transport"))
            return;
        const Transport transport = model_.plugin.transport();
        auto tempo = static_cast<float>(transport.tempo);
        rowLabel("Tempo (BPM)", 72, scale_);
        if (ImGui::DragFloat("##tempo", &tempo, 0.25F, 20, 999, "%.0f", ImGuiSliderFlags_AlwaysClamp))
            model_.plugin.editTransport([tempo](Transport& edited) { edited.tempo = tempo; });
        ImGui::SetItemTooltip("Drag, or double-click to type");

        char current[16];
        std::snprintf(current, sizeof current, "%d/%d", transport.numerator, transport.denominator);
        rowLabel("Time signature", 132, scale_);
        if (ImGui::BeginCombo("##signature", current))
        {
            for (const char* signature : timeSignatures)
                if (ImGui::Selectable(signature, std::string_view(signature) == current))
                {
                    int numerator = 4;
                    int denominator = 4;
                    std::sscanf(signature, "%d/%d", &numerator, &denominator);
                    model_.plugin.editTransport(
                        [numerator, denominator](Transport& edited)
                        {
                            edited.numerator = numerator;
                            edited.denominator = denominator;
                        });
                }
            ImGui::EndCombo();
        }
    }

    void HostInterface::drawAudio()
    {
        if (! section("Audio"))
            return;
        LiveAudio& audio = model_.audio;
        static constexpr std::array<std::pair<AudioInput, const char*>, 4> inputs { {
            { AudioInput::oscillator, "Oscillator" },
            { AudioInput::file, "Audio file…" },
            { AudioInput::microphone, "Microphone" },
            { AudioInput::none, "No input" },
        } };
        const char* currentLabel = "No input";
        for (const auto& [input, label] : inputs)
            if (input == audio.input())
                currentLabel = label;
        std::string preview = currentLabel;
        if (audio.input() == AudioInput::file && ! audio.fileName().empty())
            preview = audio.fileName();
        rowLabel("Input", 132, scale_);
        if (ImGui::BeginCombo("##input", preview.c_str()))
        {
            for (const auto& [input, label] : inputs)
                if (ImGui::Selectable(label, input == audio.input()))
                {
                    audioFailure_.clear();
                    if (input == AudioInput::file)
                        chooseFile();
                    else
                    {
                        audio.setInput(input);
                        audioChanged();
                    }
                }
            ImGui::EndCombo();
        }

        ImGui::PushFont(nullptr, 12);
        const Setup& setup = model_.plugin.setup();
        ImGui::TextColored(color(muted), "%g kHz · %d samples", setup.sampleRate / 1000, setup.blockSize);
        if (audio.running())
        {
            const std::string device = audio.device();
            ImGui::TextColored(color(muted), "Audio on%s%s", device.empty() ? "" : " · ", device.c_str());
            if (audio.input() == AudioInput::microphone && ! model_.plugin.transport().playing)
                ImGui::TextColored(color(muted), "Press Play to use the microphone");
        }
        else
            ImGui::TextColored(color(muted), "Audio off");
        for (const std::string& failure : { audio.error(), audio.inputError(), audioFailure_ })
            if (! failure.empty())
            {
                ImGui::PushStyleColor(ImGuiCol_Text, color(bad));
                ImGui::TextWrapped("%s", failure.c_str());
                ImGui::PopStyleColor();
            }
        ImGui::PopFont();
        ImGui::Spacing();
        if (ImGui::Button(audio.running() ? "Stop audio###audio-power" : "Start audio###audio-power",
                          ImVec2(132 * scale_, 0)))
        {
            if (audio.running())
            {
                audio.stop();
                audioChanged();
            }
            else
                startAudio();
        }
    }

    void HostInterface::drawKeyboard()
    {
        if (! section("Keyboard"))
            return;
        ImDrawList* list = ImGui::GetWindowDrawList();
        const float width = ImGui::GetContentRegionAvail().x;
        const float height = 56 * scale_;
        const ImVec2 origin = ImGui::GetCursorScreenPos();
        ImGui::InvisibleButton("keyboard", ImVec2(width, height));
        const bool pressed = ImGui::IsItemActive();

        int whites = 0;
        for (int pitch = keyboardLow; pitch <= keyboardHigh; ++pitch)
            whites += blackKey(pitch) ? 0 : 1;
        const float whiteWidth = width / static_cast<float>(whites);
        const float blackWidth = whiteWidth * 0.6F;
        const float blackHeight = height * 0.6F;

        // Where each key is, white keys first, then the black ones over them.
        struct Key
        {
            int pitch;
            ImVec2 min;
            ImVec2 max;
        };
        std::vector<Key> keys;
        int white = 0;
        for (int pitch = keyboardLow; pitch <= keyboardHigh; ++pitch)
            if (! blackKey(pitch))
            {
                const float left = origin.x + static_cast<float>(white++) * whiteWidth;
                keys.push_back({ pitch, ImVec2(left, origin.y), ImVec2(left + whiteWidth, origin.y + height) });
            }
        white = 0;
        for (int pitch = keyboardLow; pitch <= keyboardHigh; ++pitch)
        {
            if (! blackKey(pitch))
            {
                ++white;
                continue;
            }
            const float center = origin.x + static_cast<float>(white) * whiteWidth;
            keys.push_back({ pitch, ImVec2(center - blackWidth / 2, origin.y),
                             ImVec2(center + blackWidth / 2, origin.y + blackHeight) });
        }

        int under = -1;
        const ImVec2 mouse = ImGui::GetIO().MousePos;
        for (auto it = keys.rbegin(); it != keys.rend() && pressed; ++it)
            if (mouse.x >= it->min.x && mouse.x < it->max.x && mouse.y >= it->min.y && mouse.y < it->max.y)
            {
                under = it->pitch;
                break;
            }
        if (pressed && under >= 0 && under != heldNote_)
            noteOn(under);

        for (const auto& key : keys)
        {
            const bool black = blackKey(key.pitch);
            const bool held = key.pitch == heldNote_;
            const ImU32 fill = held    ? accent
                               : black ? IM_COL32(0x0e, 0x0f, 0x12, 0xff)
                                       : IM_COL32(0xe6, 0xe7, 0xea, 0xff);
            list->AddRectFilled(key.min, key.max, fill, black ? 2 * scale_ : 3 * scale_,
                                ImDrawFlags_RoundCornersBottom);
            if (! black)
                list->AddRect(key.min, key.max, line, 3 * scale_, 1.0F, ImDrawFlags_RoundCornersBottom);
        }
        ImGui::PushFont(nullptr, 11);
        ImGui::TextColored(color(muted), "C3 to C5");
        ImGui::PopFont();
    }

    bool HostInterface::drawToggle(const char* title, bool on) const
    {
        const ImVec2 origin = ImGui::GetCursorScreenPos();
        const float width = ImGui::GetContentRegionAvail().x;
        const float height = ImGui::GetTextLineHeight();
        const bool pressed = ImGui::InvisibleButton("##toggle", ImVec2(width, height));
        ImDrawList* list = ImGui::GetWindowDrawList();
        list->AddText(origin, ImGui::GetColorU32(ImGuiCol_Text), title);
        // A browser's dark checkbox, which the web panel shows.
        const float box = 13 * scale_;
        const ImVec2 min(origin.x + width - box, origin.y + (height - box) / 2);
        const ImVec2 max(min.x + box, min.y + box);
        const float rounding = 2 * scale_;
        const ImU32 fill = IM_COL32(0x3b, 0x3b, 0x3b, 0xff);
        if (on)
        {
            list->AddRectFilled(min, max, IM_COL32(0x99, 0xc8, 0xff, 0xff), rounding);
            const ImVec2 points[] = { ImVec2(min.x + box * 0.22F, min.y + box * 0.52F),
                                      ImVec2(min.x + box * 0.42F, min.y + box * 0.72F),
                                      ImVec2(min.x + box * 0.78F, min.y + box * 0.28F) };
            list->AddPolyline(points, 3, fill, 1.6F * scale_);
        }
        else
        {
            list->AddRectFilled(min, max, fill, rounding);
            list->AddRect(min, max, IM_COL32(0x85, 0x85, 0x85, 0xff), rounding, scale_);
        }
        return pressed;
    }

    void HostInterface::drawParameters()
    {
        char title[64];
        std::snprintf(title, sizeof title, "Parameters (%zu)", parameters_.size());
        if (! section(title))
            return;
        if (parameters_.empty())
        {
            ImGui::TextColored(color(muted), "None");
            ImGui::Spacing();
            return;
        }
        Plugin& plugin = model_.plugin;
        const float sliderHeight =
            ImGui::GetTextLineHeightWithSpacing() + ImGui::GetFrameHeightWithSpacing() + 6 * scale_;
        const float toggleHeight = ImGui::GetTextLineHeight() + 12 * scale_;
        // Rows out of sight take their height and draw nothing: a plugin can
        // have thousands, of two heights.
        for (const HostParameter& parameter : parameters_)
        {
            const float rowHeight = parameter.stepCount == 1 ? toggleHeight : sliderHeight;
            if (! ImGui::IsRectVisible(ImVec2(ImGui::GetContentRegionAvail().x, rowHeight)))
            {
                ImGui::SetCursorPosY(ImGui::GetCursorPosY() + rowHeight);
                continue;
            }
            ImGui::PushID(static_cast<int>(parameter.id));
            const double value = plugin.normalizedValue(parameter.id);
            const std::string display = plugin.valueText(parameter.id, value);
            const float top = ImGui::GetCursorPosY();
            const float right = ImGui::GetCursorPosX() + ImGui::GetContentRegionAvail().x;

            ImGui::BeginDisabled(parameter.readOnly);
            if (parameter.stepCount == 1)
            {
                // As the web panel's: the name, and a checkbox at the row's end.
                bool on = value >= 0.5;
                if (drawToggle(parameter.title.c_str(), on))
                    plugin.editParameter(parameter.id, on ? 0.0 : 1.0);
            }
            else
            {
                std::string shown = display;
                if (! parameter.units.empty())
                    shown += " " + parameter.units;
                ImGui::TextUnformatted(parameter.title.c_str());
                const float shownWidth = ImGui::CalcTextSize(shown.c_str()).x;
                ImGui::SameLine(std::max(right - shownWidth, ImGui::GetCursorPosX() + 8 * scale_));
                ImGui::TextColored(color(muted), "%s", shown.c_str());
                if (parameter.stepCount > 1 && parameter.stepCount <= 128 && parameter.list)
                {
                    if (ImGui::BeginCombo("##value", display.c_str()))
                    {
                        const int current = static_cast<int>(std::lround(value * parameter.stepCount));
                        for (int step = 0; step <= parameter.stepCount; ++step)
                        {
                            const double normalized = static_cast<double>(step) / parameter.stepCount;
                            const std::string label = plugin.valueText(parameter.id, normalized);
                            ImGui::PushID(step);
                            if (ImGui::Selectable(label.c_str(), step == current))
                                plugin.editParameter(parameter.id, normalized);
                            ImGui::PopID();
                        }
                        ImGui::EndCombo();
                    }
                }
                else
                {
                    double next = value;
                    if (rangeSlider("##value", next, parameter.defaultValue))
                    {
                        if (parameter.stepCount > 1)
                            next = std::round(next * parameter.stepCount) / parameter.stepCount;
                        plugin.editParameter(parameter.id, next);
                    }
                    ImGui::SetItemTooltip("Double-click: the default value");
                }
            }
            ImGui::EndDisabled();
            ImGui::SetCursorPosY(top + rowHeight);
            ImGui::PopID();
        }
    }

    void HostInterface::drawPlugin()
    {
        if (! section("Plugin", true))
            return;
        Plugin& plugin = model_.plugin;
        ImGui::PushFont(nullptr, 12);
        auto fact = [&](const char* label, const std::string& value)
        {
            ImGui::TextColored(color(muted), "%s", label);
            ImGui::SameLine(96 * scale_);
            ImGui::TextWrapped("%s", value.c_str());
        };
        fact("Vendor", plugin.vendor());
        fact("Version", plugin.version());
        fact("Inputs", std::to_string(plugin.mainInputChannels()) + " channels");
        fact("Outputs", std::to_string(plugin.mainOutputChannels()) + " channels");
        fact("Latency", std::to_string(plugin.latencySamples()) + " samples");
        fact("MIDI input", plugin.hasEventInput() ? "yes" : "no");
        ImGui::PopFont();
    }

    void HostInterface::drawSettings()
    {
        if (! section("Settings", true))
            return;
        bool withInterface = model_.settings.presentation == "host";
        if (ImGui::Checkbox("Open plugins with this interface", &withInterface))
        {
            model_.settings.presentation = withInterface ? "host" : "editor";
            model_.settings.save();
        }
        ImGui::PushFont(nullptr, 11);
        ImGui::PushStyleColor(ImGuiCol_Text, color(muted));
        ImGui::TextWrapped("When off, the next plugin opens in a window of its editor alone. A launch that asks for "
                           "a presentation gets it.");
        ImGui::PopStyleColor();
        ImGui::PopFont();
    }
} // namespace soundor::vst3host
