#include "Controller.h"

#include "Editor.h"
#include "Log.h"
#include "Processor.h"
#include "StateDocument.h"
#include "Strings.h"

#include <pluginterfaces/base/ibstream.h>
#include <pluginterfaces/vst/ivstmessage.h>
#include <pluginterfaces/vst/ivsteditcontroller.h>

#include <algorithm>
#include <cmath>
#include <cstring>

namespace soundor::vst3
{
    using namespace Steinberg;
    namespace hist = soundor::history;

    namespace
    {
        // A Soundor parameter as VST3 sees it: the descriptor's behaviour
        // (mapping, step, text) throughout, so a host's text and its
        // normalized positions are the plugin's own, with the editor closed.
        class SoundorParameter final : public Vst::Parameter
        {
        public:
            SoundorParameter(const Plugin& plugin, std::size_t parameter) : definition(plugin), index(parameter)
            {
                const auto& declared = plugin.parameters[parameter];
                const auto& about = declared.info;
                info.id = declared.vstId;
                copyString128(about.label, info.title);
                copyString128(about.label, info.shortTitle);
                copyString128(about.unit, info.units);
                info.stepCount = declared.stepCount;
                info.defaultNormalizedValue = plugin.toNormalized(parameter, about.defaultValue);
                info.unitId = declared.unit;
                info.flags = 0;
                if (about.access == parameters::Access::Automatable)
                    info.flags |= Vst::ParameterInfo::kCanAutomate;
                if (about.access == parameters::Access::ReadOnly)
                    info.flags |= Vst::ParameterInfo::kIsReadOnly;
                if (about.type == parameters::Type::Choice)
                    info.flags |= Vst::ParameterInfo::kIsList;
                if (about.role == "bypass")
                    info.flags |= Vst::ParameterInfo::kIsBypass;
                setNormalized(info.defaultNormalizedValue);
            }

            void toString(Vst::ParamValue normalized, Vst::String128 string) const override
            {
                try
                {
                    copyString128(definition.format(index, definition.toValue(index, normalized)), string);
                }
                catch (...)
                {
                    string[0] = 0;
                }
            }

            bool fromString(const Vst::TChar* string, Vst::ParamValue& normalized) const override
            {
                try
                {
                    const auto value = definition.parse(index, utf8(string));
                    if (! value)
                        return false;
                    normalized = definition.toNormalized(index, *value);
                    return true;
                }
                catch (...)
                {
                    return false;
                }
            }

            [[nodiscard]] Vst::ParamValue toPlain(Vst::ParamValue normalized) const override
            {
                return definition.toValue(index, std::clamp(normalized, 0.0, 1.0));
            }

            [[nodiscard]] Vst::ParamValue toNormalized(Vst::ParamValue plain) const override
            {
                return definition.toNormalized(index, definition.constrain(index, plain));
            }

        private:
            const Plugin& definition;
            std::size_t index;
        };

        std::string readAll(IBStream* stream)
        {
            std::string out;
            if (stream == nullptr)
                return out;
            char buffer[65536];
            while (true)
            {
                int32 read = 0;
                if (stream->read(buffer, sizeof buffer, &read) != kResultOk || read <= 0)
                    break;
                out.append(buffer, static_cast<std::size_t>(read));
                if (out.size() > maxSnapshotBytes)
                    return {};
            }
            return out;
        }

        constexpr Vst::ProgramListID presetListId = programParameterId;
    } // namespace

    Controller::Controller(const Plugin& plugin)
        : definition(plugin), stateSchema(plugin), stateStore(std::make_unique<StateStore>(stateHistory))
    {
        plainValues.reserve(plugin.parameters.size());
        for (const auto& parameter : plugin.parameters)
            plainValues.push_back(parameter.info.defaultValue);
        for (std::size_t i = 0; i < stateSchema.size(); ++i)
        {
            const auto& field = stateSchema.field(i);
            stateStore->initialize(field.name, field.defaultJson,
                                   [this, i](const std::string& json)
                                   {
                                       if (stateSchema.canonical(i, std::string_view(json)) != json)
                                           throw std::invalid_argument("state." + stateSchema.field(i).name
                                                                       + ": not canonical state JSON");
                                   });
        }
        for (std::size_t i = 0; i < plugin.parameters.size(); ++i)
            parameterEditors.push_back(std::make_unique<ParameterEditor>(plugin, i, *this, stateHistory));
        factoryPresets = std::make_unique<FactoryPresets>(plugin, parameterEditors, *stateStore, stateHistory);
        // Every state change, from any path, reaches the processor whole.
        for (std::size_t i = 0; i < stateSchema.size(); ++i)
            stateSubscriptions.push_back(
                stateStore->subscribe(stateSchema.field(i).name, [this](const std::string&) { sendState(); }));
    }

    Controller::~Controller()
    {
        if (controller != nullptr)
            controller->shutdown();
        controller.reset();
        for (auto& unsubscribe : stateSubscriptions)
            unsubscribe();
    }

    FUnknown* Controller::create(void*)
    {
        const auto* described = soundor::vst3::plugin();
        if (described == nullptr)
            return nullptr;
        return static_cast<Vst::IEditController*>(new Controller(*described));
    }

    tresult PLUGIN_API Controller::initialize(FUnknown* context)
    {
        const auto result = EditControllerEx1::initialize(context);
        if (result != kResultOk)
            return result;
        // Units: the root (with the factory presets as its program list),
        // then one per parameter group.
        const bool programs = ! definition.presets.empty();
        addUnit(new Vst::Unit(u"Root", Vst::kRootUnitId, Vst::kNoParentUnitId,
                              programs ? presetListId : Vst::kNoProgramListId));
        for (const auto& group : definition.groups)
        {
            Vst::String128 name {};
            copyString128(group.label, name);
            addUnit(new Vst::Unit(name, group.unit, Vst::kRootUnitId));
        }
        for (std::size_t i = 0; i < definition.parameters.size(); ++i)
            parameters.addParameter(new SoundorParameter(definition, i));
        if (programs)
        {
            auto* list = new Vst::ProgramList(u"Factory Presets", presetListId, Vst::kRootUnitId);
            for (const auto& preset : definition.presets)
            {
                Vst::String128 name {};
                copyString128(preset.name, name);
                list->addProgram(name);
            }
            addProgramList(list);
            if (auto* parameter = list->getParameter())
            {
                parameter->getInfo().flags &= ~Vst::ParameterInfo::kCanAutomate;
                parameters.addParameter(parameter);
            }
        }
        // MIDI controllers, pitch bend and channel pressure reach VST3
        // plugins as parameters (IMidiMapping): hidden ones, one for each.
        if (definition.midiInput)
            for (int channel = 0; channel < 16; ++channel)
                for (int controllerNumber = 0; controllerNumber < midiControllersPerChannel; ++controllerNumber)
                {
                    Vst::ParameterInfo info {};
                    info.id = midiParameterId(channel, controllerNumber);
                    const auto title = "MIDI " + std::to_string(channel + 1) + " CC " + std::to_string(controllerNumber);
                    copyString128(title, info.title);
                    copyString128(title, info.shortTitle);
                    info.flags = Vst::ParameterInfo::kIsHidden | Vst::ParameterInfo::kCanAutomate;
                    info.defaultNormalizedValue = controllerNumber == Vst::kPitchBend ? 0.5 : 0;
                    parameters.addParameter(info);
                }
        // A run loop without a view, where the host lends one: the Rust
        // controller's scheduled work then runs with the editor closed.
        if (context != nullptr)
        {
            Linux::IRunLoop* loop = nullptr;
            if (context->queryInterface(Linux::IRunLoop::iid, reinterpret_cast<void**>(&loop)) == kResultOk
                && loop != nullptr)
            {
                runLoop = owned(loop);
                runLoop->registerTimer(this, 16);
            }
        }
        return kResultOk;
    }

    tresult PLUGIN_API Controller::terminate()
    {
        shutDown = true;
        if (runLoop)
            runLoop->unregisterTimer(this);
        runLoop = nullptr;
        for (auto* editor : std::vector<Editor*>(openEditors.begin(), openEditors.end()))
            editor->controllerGone();
        openEditors.clear();
        if (controller != nullptr)
            controller->shutdown();
        controller.reset();
        midi.reset();
        processorLink.reset();
        return EditControllerEx1::terminate();
    }

    tresult PLUGIN_API Controller::notify(Vst::IMessage* message)
    {
        if (message == nullptr)
            return kInvalidArgument;
        if (std::strcmp(message->getMessageID(), "soundor.link") != 0)
            return EditControllerEx1::notify(message);
        int64 module = 0;
        int64 token = 0;
        if (message->getAttributes()->getInt("module", module) != kResultOk
            || message->getAttributes()->getInt("token", token) != kResultOk)
            return kInvalidArgument;
        // Another binary's processor (another process, or another plugin):
        // nothing is shared.
        if (module != moduleIdentity() || controller != nullptr)
            return kResultOk;
        processorLink = resolveLink(static_cast<std::uint64_t>(token));
        if (processorLink != nullptr && processorLink->rust != nullptr && processorLink->rust->valid())
            midi = std::make_shared<midi::Host>(processorLink->rust->nativeHandle(), midi::linkedMidi());
        ensureRustController();
        return kResultOk;
    }

    void Controller::ensureRustController()
    {
        if (controller != nullptr || shutDown)
            return;
        void* handle = processorLink != nullptr && processorLink->rust != nullptr && processorLink->rust->valid()
                           ? processorLink->rust->nativeHandle()
                           : nullptr;
        controller = std::make_shared<processor::RustController>(
            std::span<const std::uint8_t>(definition.controllerDescriptor), processor::linkedRustController(), *this,
            handle);
        if (controller->present() && ! controller->active())
            log("Soundor: " + controller->error());
    }

    const std::shared_ptr<processor::RustController>& Controller::rustController()
    {
        ensureRustController();
        return controller;
    }

    tresult PLUGIN_API Controller::setComponentState(IBStream* state)
    {
        const auto text = readAll(state);
        StateDocument document;
        try
        {
            document = readStateDocument(definition, stateSchema, text);
        }
        catch (const std::exception& error)
        {
            log(std::string("Soundor: the controller could not read the saved state: ") + error.what());
            return kResultFalse;
        }
        restoring = true;
        try
        {
            for (std::size_t i = 0; i < document.parameters.size(); ++i)
            {
                const double value = definition.constrain(i, document.parameters[i]);
                plainValues[i] = value;
                EditControllerEx1::setParamNormalized(definition.parameters[i].vstId, definition.toNormalized(i, value));
                markChanged(i);
            }
            stateStore->resetGestures();
            stateStore->replace(document.state);
            stateStore->restored();
            factoryPresets->restored();
        }
        catch (const std::exception& error)
        {
            log(std::string("Soundor: the saved state could not be applied: ") + error.what());
        }
        restoring = false;
        ensureRustController();
        return kResultOk;
    }

    // The controller keeps nothing of its own: the component's state is the
    // plugin's whole state.
    tresult PLUGIN_API Controller::setState(IBStream*) { return kResultOk; }
    tresult PLUGIN_API Controller::getState(IBStream*) { return kResultOk; }

    tresult PLUGIN_API Controller::setParamNormalized(Vst::ParamID tag, Vst::ParamValue value)
    {
        const auto result = EditControllerEx1::setParamNormalized(tag, value);
        if (const auto index = definition.indexOf(tag))
        {
            plainValues[*index] = definition.toValue(*index, std::clamp(value, 0.0, 1.0));
            markChanged(*index);
        }
        else if (tag == programParameterId && ! restoring && ! definition.presets.empty())
        {
            const auto count = static_cast<double>(definition.presets.size() - 1);
            const auto program = static_cast<int>(std::lround(std::clamp(value, 0.0, 1.0) * count));
            if (program != factoryPresets->selectedIndex())
                requestedProgram.store(program);
        }
        return result;
    }

    IPlugView* PLUGIN_API Controller::createView(FIDString name)
    {
        if (name == nullptr || std::strcmp(name, Vst::ViewType::kEditor) != 0 || shutDown)
            return nullptr;
        ensureRustController();
        auto* editor = new Editor(*this);
        openEditors.insert(editor);
        return editor;
    }

    void Controller::editorClosed(Editor* editor) { openEditors.erase(editor); }

    tresult PLUGIN_API Controller::getMidiControllerAssignment(int32 busIndex, int16 channel,
                                                               Vst::CtrlNumber midiControllerNumber, Vst::ParamID& id)
    {
        if (! definition.midiInput || busIndex != 0 || channel < 0 || channel > 15 || midiControllerNumber < 0
            || midiControllerNumber >= midiControllersPerChannel)
            return kResultFalse;
        id = midiParameterId(channel, midiControllerNumber);
        return kResultTrue;
    }

    void PLUGIN_API Controller::onTimer() { pump(); }

    void Controller::pump()
    {
        if (shutDown)
            return;
        if (const int program = requestedProgram.exchange(-1); program >= 0
            && static_cast<std::size_t>(program) < definition.presets.size())
        {
            try
            {
                factoryPresets->loadFactory(definition.presets[static_cast<std::size_t>(program)].id);
            }
            catch (const std::exception& error)
            {
                log(std::string("Soundor: the host's program could not be loaded: ") + error.what());
            }
        }
        if (midi != nullptr)
            midi->pump();
        if (controller != nullptr && (woken.exchange(false) || true))
            if (controller->pump())
                woken.store(true);
    }

    Vst::Parameter* Controller::parameterAt(std::size_t index)
    {
        return getParameterObject(definition.parameters[index].vstId);
    }

    void Controller::markChanged(std::size_t index)
    {
        for (auto* ui : uis)
            ui->changes().markChanged(index);
    }

    void Controller::addUi(UiParameters* ui) { uis.insert(ui); }
    void Controller::removeUi(UiParameters* ui) { uis.erase(ui); }

    double Controller::plain(std::size_t index) const { return plainValues[index]; }

    void Controller::installPlain(std::size_t index, double value)
    {
        plainValues[index] = value;
        if (auto* parameter = parameterAt(index))
            parameter->setNormalized(definition.toNormalized(index, value));
    }

    void Controller::notifyPlain(std::size_t index)
    {
        const auto& parameter = definition.parameters[index];
        performEdit(parameter.vstId, definition.toNormalized(index, plainValues[index]));
        markChanged(index);
    }

    void Controller::beginHostEdit(std::size_t index) { beginEdit(definition.parameters[index].vstId); }
    void Controller::endHostEdit(std::size_t index) { endEdit(definition.parameters[index].vstId); }

    void Controller::sendState()
    {
        if (restoring || shutDown)
            return;
        auto* message = allocateMessage();
        if (message == nullptr)
            return;
        try
        {
            const auto values = json::write(stateSchema.write(stateStore->snapshot()));
            message->setMessageID("soundor.state");
            message->getAttributes()->setBinary("values", values.data(), static_cast<uint32>(values.size()));
            sendMessage(message);
        }
        catch (const std::exception& error)
        {
            log(std::string("Soundor: the state could not be sent to the processor: ") + error.what());
        }
        message->release();
    }

    // ── The Rust controller's services ───────────────────────────────────────

    void Controller::wake() noexcept { woken.store(true); }

    double Controller::parameter(std::uint32_t index) { return parameterEditors.at(index)->get(); }

    void Controller::setParameter(std::uint32_t index, double value) { parameterEditors.at(index)->set(value); }

    std::string Controller::state(std::uint32_t index) { return stateStore->get(stateSchema.field(index).name); }

    void Controller::setState(std::uint32_t index, std::string_view json)
    {
        stateStore->set(stateSchema.field(index).name, stateSchema.canonical(index, json));
    }

    bool Controller::history(HistoryAction action)
    {
        switch (action)
        {
        case HistoryAction::Undo:
            if (! stateHistory.canUndo())
                return false;
            stateHistory.undo();
            return true;
        case HistoryAction::Redo:
            if (! stateHistory.canRedo())
                return false;
            stateHistory.redo();
            return true;
        case HistoryAction::CanUndo:
            return stateHistory.canUndo();
        case HistoryAction::CanRedo:
            return stateHistory.canRedo();
        }
        return false;
    }

    void Controller::loadPreset(std::string_view id) { factoryPresets->loadFactory(id); }
} // namespace soundor::vst3
