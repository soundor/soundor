#pragma once

// The VST3 edit controller: the plugin's parameters as the host sees them
// (their behaviour from the descriptor's expressions), its persistent state,
// History and factory presets, its Rust controller (processor::
// RustController, through `soundor::export!`'s ABI) and its editor.
//
// Everything runs on the host's UI thread, which is the Rust controller's
// control thread, but wake(), which any thread may call. The controller
// never assumes its processor is in the same process: it learns its state
// from setComponentState() and sends state changes as messages; only the
// features that need shared memory (the Rust controller's audio resources,
// the UI's soundor:midi, native streams) wait for a Link (Link.h).

#include "Descriptor.h"
#include "Link.h"
#include "ParameterHost.h"
#include "Presets.h"
#include "State.h"

#include <soundor/midi/Midi.h>
#include <soundor/processor/RustController.h>

#include <pluginterfaces/gui/iplugview.h>
#include <pluginterfaces/vst/ivstmidicontrollers.h>
#include <public.sdk/source/vst/vsteditcontroller.h>

#include <atomic>
#include <functional>
#include <memory>
#include <set>
#include <vector>

namespace soundor::vst3
{
    namespace Vst = Steinberg::Vst;
    using Steinberg::tresult;

    class Editor;

    class Controller final : public Vst::EditControllerEx1,
                             public Vst::IMidiMapping,
                             public ParameterTarget,
                             public processor::ControllerServices,
                             public Steinberg::Linux::ITimerHandler
    {
    public:
        explicit Controller(const Plugin& plugin);
        ~Controller() override;
        Controller(const Controller&) = delete;
        Controller& operator=(const Controller&) = delete;
        Controller(Controller&&) = delete;
        Controller& operator=(Controller&&) = delete;

        static Steinberg::FUnknown* create(void* context);

        // IPluginBase, IConnectionPoint
        tresult PLUGIN_API initialize(Steinberg::FUnknown* context) override;
        tresult PLUGIN_API terminate() override;
        tresult PLUGIN_API notify(Vst::IMessage* message) override;

        // IEditController
        tresult PLUGIN_API setComponentState(Steinberg::IBStream* state) override;
        tresult PLUGIN_API setState(Steinberg::IBStream* state) override;
        tresult PLUGIN_API getState(Steinberg::IBStream* state) override;
        tresult PLUGIN_API setParamNormalized(Vst::ParamID tag, Vst::ParamValue value) override;
        Steinberg::IPlugView* PLUGIN_API createView(Steinberg::FIDString name) override;

        // IMidiMapping
        tresult PLUGIN_API getMidiControllerAssignment(Steinberg::int32 busIndex, Steinberg::int16 channel,
                                                       Vst::CtrlNumber midiControllerNumber, Vst::ParamID& id) override;

        // ITimerHandler: the run loop's timer, when the host lends one without a view.
        void PLUGIN_API onTimer() override;

        // ParameterTarget
        [[nodiscard]] double plain(std::size_t index) const override;
        void installPlain(std::size_t index, double value) override;
        void notifyPlain(std::size_t index) override;
        void beginHostEdit(std::size_t index) override;
        void endHostEdit(std::size_t index) override;

        // processor::ControllerServices (the Rust controller's)
        void wake() noexcept override;
        double parameter(std::uint32_t index) override;
        void setParameter(std::uint32_t index, double value) override;
        std::string state(std::uint32_t index) override;
        void setState(std::uint32_t index, std::string_view json) override;
        bool history(HistoryAction action) override;
        void loadPreset(std::string_view id) override;

        // For the editor.
        [[nodiscard]] const Plugin& plugin() const noexcept { return definition; }
        [[nodiscard]] const StateSchema& schema() const noexcept { return stateSchema; }
        [[nodiscard]] StateStore& store() noexcept { return *stateStore; }
        [[nodiscard]] soundor::history::StateHistory& historyManager() noexcept { return stateHistory; }
        [[nodiscard]] FactoryPresets& presets() noexcept { return *factoryPresets; }
        [[nodiscard]] std::span<const std::unique_ptr<ParameterEditor>> editors() const noexcept
        {
            return parameterEditors;
        }
        [[nodiscard]] const std::shared_ptr<processor::RustController>& rustController();
        [[nodiscard]] const std::shared_ptr<Link>& link() const noexcept { return processorLink; }
        [[nodiscard]] const std::shared_ptr<midi::Host>& midiHost() const noexcept { return midi; }
        // The UI's parameter hosts, whose change flags the host's changes mark.
        void addUi(UiParameters* ui);
        void removeUi(UiParameters* ui);
        void editorClosed(Editor* editor);
        // Runs the Rust controller's queue and MIDI's: the editor's tick, and
        // the run loop's timer, call it.
        void pump();

        OBJ_METHODS(Controller, EditControllerEx1)
        DEFINE_INTERFACES
        DEF_INTERFACE(Vst::IMidiMapping)
        DEF_INTERFACE(Steinberg::Linux::ITimerHandler)
        END_DEFINE_INTERFACES(EditControllerEx1)
        REFCOUNT_METHODS(EditControllerEx1)

    private:
        [[nodiscard]] Vst::Parameter* parameterAt(std::size_t index);
        void markChanged(std::size_t index);
        void sendState();
        void ensureRustController();

        const Plugin& definition;
        StateSchema stateSchema;
        soundor::history::StateHistory stateHistory;
        std::unique_ptr<StateStore> stateStore;
        std::vector<std::unique_ptr<ParameterEditor>> parameterEditors;
        std::unique_ptr<FactoryPresets> factoryPresets;
        std::vector<std::function<void()>> stateSubscriptions;
        std::vector<double> plainValues;
        std::set<UiParameters*> uis;
        std::set<Editor*> openEditors;
        std::shared_ptr<Link> processorLink;
        std::shared_ptr<processor::RustController> controller;
        std::shared_ptr<midi::Host> midi;
        Steinberg::IPtr<Steinberg::Linux::IRunLoop> runLoop;
        std::atomic<bool> woken { false };
        bool restoring = false;
        bool loadingProgram = false;
        bool shutDown = false;
    };
} // namespace soundor::vst3
