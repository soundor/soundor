// One loaded VST3 plugin: its module, the chosen class's component and
// controller, the negotiated buses and processing setup, the editor, and
// offline processing. Every method but runProcess() is for the main thread.
#pragma once

#include "EditorWindow.h"
#include "EventLoop.h"
#include "HostContext.h"
#include "Ipc.h"
#include "Json.h"
#include "pluginterfaces/gui/iplugview.h"
#include "pluginterfaces/vst/ivstaudioprocessor.h"
#include "pluginterfaces/vst/ivstcomponent.h"
#include "pluginterfaces/vst/ivsteditcontroller.h"
#include "pluginterfaces/vst/ivstevents.h"
#include "pluginterfaces/vst/ivstmessage.h"
#include "pluginterfaces/vst/ivstmidicontrollers.h"
#include "public.sdk/source/vst/hosting/module.h"

#include <functional>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace soundor::vst3host
{
    /** An error reported to the client as { code, message, details }. */
    class Failure : public std::runtime_error
    {
    public:
        Failure(std::string code, const std::string& message, Json details = {})
            : std::runtime_error(message), code_(std::move(code)), details_(std::move(details))
        {
        }
        const std::string& code() const { return code_; }
        const Json& details() const { return details_; }

    private:
        std::string code_;
        Json details_;
    };

    struct BusRequest
    {
        std::optional<Vst::SpeakerArrangement> arrangement;
        std::optional<bool> active;
    };

    struct Setup
    {
        double sampleRate = 48000;
        int32 blockSize = 512;
        int32 processMode = Vst::kRealtime;
        /** By audio bus index; a bus without a request keeps the plugin's
            default arrangement and activation. */
        std::vector<std::optional<BusRequest>> inputs;
        std::vector<std::optional<BusRequest>> outputs;
    };

    struct Transport
    {
        bool playing = false;
        double tempo = 120;
        int32 numerator = 4;
        int32 denominator = 4;
        int64 samplePosition = 0;
    };

    struct ParameterChange
    {
        Vst::ParamID id = 0;
        double value = 0;
        int64 time = 0;
    };

    /** One process request, validated on the main thread and run on the
        audio worker (runProcess). Times are frames from the request's start. */
    struct ProcessJob
    {
        int64 frames = 0;
        Payload input;
        /** Per audio input bus, per channel: a channel of `input`, or nullptr
            for silence (an omitted bus). */
        std::vector<std::vector<const float*>> inputs;
        std::vector<ParameterChange> changes;
        std::vector<Vst::Event> events;
        std::optional<Transport> transport;

        // Results.
        Payload output;
        std::vector<int32> outputChannels;
        std::vector<Vst::Event> outputEvents;
        std::vector<ParameterChange> outputChanges;
        std::vector<std::string> warnings;
        std::string error;
    };

    struct PluginCallbacks
    {
        std::function<void(const std::string& event, Json params)> emit;
    };

    class Plugin final : public HostListener
    {
    public:
        Plugin(EventLoop& loop, bool ui, PluginCallbacks callbacks);
        ~Plugin() override;

        Plugin(const Plugin&) = delete;
        Plugin& operator=(const Plugin&) = delete;

        /** Loads the module (once) and creates, connects, configures and
            activates an instance of the selected class. */
        void load(const std::string& path, const std::string& className, const std::string& classId,
                  const Setup& setup);
        /** A new instance of the same class and setup; the module stays. */
        void recreate();
        /** Deactivates and reactivates: the plugin clears its processing state. */
        void reset();
        /** Applies a new setup (sample rate, block size, mode, buses). */
        void configure(const Setup& setup);
        void unload();

        Json info() const;
        Json parameters() const;
        Json parameter(Vst::ParamID id) const;
        Json setParameter(Vst::ParamID id, std::optional<double> normalized, std::optional<double> plain);
        Json latencyAndTail() const;

        /** Component state, then controller state; sizes in `sizes`. */
        std::vector<uint8_t> getState(size_t& componentSize);
        void setState(const uint8_t* component, size_t componentSize, const uint8_t* controller, size_t controllerSize);

        /** Validates a process request and prepares its job. */
        std::unique_ptr<ProcessJob> prepareProcess(const Json& params, Payload&& payload);
        /** On the audio worker. */
        void runProcess(ProcessJob& job);
        /** Back on the main thread: results to JSON, controller in sync. */
        Json finishProcess(ProcessJob& job);

        Json openEditor(std::optional<double> scale);
        void closeEditor();
        Json resizeEditor(int width, int height);
        Json editorInfo() const;

        /** Runs restarts the plugin asked for while busy. */
        void applyPendingRestarts();
        bool loaded() const { return component_ != nullptr; }
        const Setup& setup() const { return setup_; }

        // HostListener
        void beginEdit(Vst::ParamID id) override;
        void performEdit(Vst::ParamID id, Vst::ParamValue value) override;
        void endEdit(Vst::ParamID id) override;
        void restartComponent(int32 flags) override;
        void setDirty(bool dirty) override;
        void requestOpenEditor() override;
        bool resizeView(IPlugView* view, ViewRect* size) override;

        /** True while the audio worker runs a job: lifecycle waits. */
        bool busy = false;

    private:
        struct Bus
        {
            std::string name;
            int32 type = Vst::kMain;
            int32 channels = 0;
            Vst::SpeakerArrangement arrangement = 0;
            bool active = false;
            bool defaultActive = false;
        };

        void createInstance();
        void destroyInstance();
        void negotiate(const Setup& setup);
        void activate();
        void deactivate();
        void flushParameters();
        void readBuses();
        Json busesJson() const;
        Json parameterJson(int32 index) const;
        void requireLoaded() const;

        EventLoop& loop_;
        bool ui_;
        PluginCallbacks callbacks_;

#if defined(__linux__)
        IPtr<RunLoop> runLoop_;
#endif
        IPtr<HostApplication> hostContext_;
        IPtr<ComponentHandler> componentHandler_;

        VST3::Hosting::Module::Ptr module_;
        std::string path_;
        VST3::Hosting::ClassInfo class_;
        Setup setup_;

        IPtr<Vst::IComponent> component_;
        IPtr<Vst::IAudioProcessor> processor_;
        IPtr<Vst::IEditController> controller_;
        IPtr<Vst::IMidiMapping> midiMapping_;
        IPtr<Vst::IConnectionPoint> componentConnection_;
        IPtr<Vst::IConnectionPoint> controllerConnection_;
        bool separateController_ = false;
        bool active_ = false;

        std::vector<Bus> audioInputs_;
        std::vector<Bus> audioOutputs_;
        std::vector<Bus> eventInputs_;
        std::vector<Bus> eventOutputs_;

        Transport transport_;
        int64 continuousSamples_ = 0;

        // Edits from setParameter and the editor, for the next process call.
        std::mutex pendingMutex_;
        std::vector<ParameterChange> pending_;
        int32 pendingRestart_ = 0;

        // The editor (UI mode).
        IPtr<IPlugView> view_;
        IPtr<PlugFrame> frame_;
        std::unique_ptr<EditorWindow> window_;
        double scale_ = 1;
        bool resizing_ = false;
        int editorGeneration_ = 0;
    };
} // namespace soundor::vst3host
