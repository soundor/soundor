#include "Plugin.h"

#include "Bundle.h"
#include "pluginterfaces/base/funknownimpl.h"
#include "pluginterfaces/gui/iplugviewcontentscalesupport.h"
#include "pluginterfaces/vst/ivstprocesscontext.h"
#include "pluginterfaces/vst/vstspeaker.h"
#include "public.sdk/source/common/memorystream.h"
#include "public.sdk/source/vst/hosting/connectionproxy.h"
#include "public.sdk/source/vst/hosting/eventlist.h"
#include "public.sdk/source/vst/hosting/parameterchanges.h"
#include "public.sdk/source/vst/utility/stringconvert.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <limits>
#include <map>
#include <sstream>

#if ! defined(_WIN32)
    #include <dlfcn.h>
#endif

namespace soundor::vst3host
{
    using namespace Steinberg::Vst;

    namespace
    {
        std::string classIdString(const VST3::UID& uid)
        {
            return uid.toString(false);
        }

        std::string arrangementName(SpeakerArrangement arrangement)
        {
            const char* name = SpeakerArr::getSpeakerArrangementString(arrangement, false);
            if (name != nullptr && *name != '\0' && std::string_view(name) != "Unknown")
                return name;
            std::ostringstream hex;
            hex << "0x" << std::hex << arrangement;
            return hex.str();
        }

        std::string busTypeName(int32 type)
        {
            return type == kMain ? "main" : "aux";
        }

        std::string tresultName(tresult result)
        {
            switch (result)
            {
                case kResultOk:
                    return "kResultOk";
                case kResultFalse:
                    return "kResultFalse";
                case kInvalidArgument:
                    return "kInvalidArgument";
                case kNotImplemented:
                    return "kNotImplemented";
                case kInternalError:
                    return "kInternalError";
                case kNotInitialized:
                    return "kNotInitialized";
                case kOutOfMemory:
                    return "kOutOfMemory";
                default:
                    return std::to_string(result);
            }
        }

        std::string processModeName(int32 mode)
        {
            return mode == kOffline ? "offline" : mode == kPrefetch ? "prefetch" : "realtime";
        }
    } // namespace

    Plugin::Plugin(EventLoop& loop, bool ui, PluginCallbacks callbacks)
        : loop_(loop), ui_(ui), callbacks_(std::move(callbacks))
    {
#if defined(__linux__)
        runLoop_ = owned(new RunLoop(loop_));
        hostContext_ = owned(new HostApplication(runLoop_->unknownCast()));
#else
        hostContext_ = owned(new HostApplication(nullptr));
#endif
        componentHandler_ = owned(new ComponentHandler(*this));
    }

    Plugin::~Plugin()
    {
        unload();
    }

    void Plugin::requireLoaded() const
    {
        if (component_ == nullptr)
            throw Failure("invalid-state", "no plugin is loaded");
    }

    // ── Loading ──────────────────────────────────────────────────────────

    void Plugin::load(const std::string& path, const std::string& className, const std::string& classId,
                      const Setup& setup)
    {
        const std::scoped_lock processing(processing_);
        if (module_ != nullptr)
            throw Failure("invalid-state", "a plugin is already loaded; launch another host for another plugin");

        const BundleCheck check = checkBundle(path);
        if (! check.code.empty())
        {
            Json details = Json::object();
            Json architectures = Json::array();
            for (const auto& architecture : check.architectures)
                architectures.push(architecture);
            details.set("architectures", std::move(architectures));
            details.set("hostArchitecture", hostArchitecture());
            throw Failure(check.code, check.message, std::move(details));
        }

#if ! defined(_WIN32)
        // Resolve every symbol now: the SDK's loader binds lazily, and a
        // plugin missing a symbol would end the process at its first call.
        void* probe = dlopen(check.binary.c_str(), RTLD_NOW | RTLD_LOCAL);
        if (probe == nullptr)
        {
            const char* reason = dlerror(); // NOLINT(concurrency-mt-unsafe): main thread only
            throw Failure("load-failed", "the plugin's binary could not be loaded: "
                                             + std::string(reason != nullptr ? reason : check.binary));
        }
        // Kept open until the SDK has its own handle, so it is loaded once.
        const std::unique_ptr<void, int (*)(void*)> probeHandle(probe, &dlclose);
#endif
        std::string error;
        auto module = VST3::Hosting::Module::create(path, error);
        if (module == nullptr)
            throw Failure("load-failed", "the plugin's module could not be loaded from " + path
                                             + (error.empty() ? std::string() : ": " + error));

        const auto& factory = module->getFactory();
        factory.setHostContext(hostContext_.get());

        std::vector<VST3::Hosting::ClassInfo> candidates;
        Json available = Json::array();
        for (const auto& info : factory.classInfos())
        {
            if (info.category() != kVstAudioEffectClass)
                continue;
            Json entry = Json::object();
            entry.set("name", info.name());
            entry.set("classId", classIdString(info.ID()));
            available.push(std::move(entry));
            if ((className.empty() || info.name() == className)
                && (classId.empty() || classIdString(info.ID()) == classId))
                candidates.push_back(info);
        }
        Json details = Json::object();
        details.set("classes", available);
        if (available.asArray().empty())
            throw Failure("unsupported-plugin", path + " has no VST3 audio processor class", std::move(details));
        if (candidates.empty())
            throw Failure("no-matching-class",
                          "no audio processor class in " + path + " matches "
                              + (className.empty() ? "class id " + classId : "\"" + className + "\""),
                          std::move(details));
        if (candidates.size() > 1)
        {
            std::string names;
            for (const auto& candidate : candidates)
                names += (names.empty() ? "" : ", ") + ("\"" + candidate.name() + "\"");
            throw Failure("ambiguous-class",
                          path + " has several audio processor classes (" + names
                              + "); choose one with `className` or `classId`",
                          std::move(details));
        }

        module_ = std::move(module);
        path_ = path;
        class_ = candidates.front();
        setup_ = setup;
        try
        {
            createInstance();
        }
        catch (...)
        {
            unload();
            throw;
        }
    }

    void Plugin::createInstance()
    {
        const auto& factory = module_->getFactory();
        const std::string name = class_.name();

        component_ = factory.createInstance<IComponent>(class_.ID());
        if (component_ == nullptr)
            throw Failure("load-failed", "the plugin's factory did not create \"" + name + "\"");
        const tresult initialized = component_->initialize(hostContext_.get());
        if (initialized != kResultOk)
        {
            component_ = nullptr;
            throw Failure("initialization-failed", "\"" + name
                                                       + "\" failed to initialize (IComponent::initialize returned "
                                                       + tresultName(initialized) + ")");
        }
        processor_ = U::cast<IAudioProcessor>(component_);
        if (processor_ == nullptr)
            throw Failure("unsupported-plugin", "\"" + name + "\" is not an audio processor (no IAudioProcessor)");

        // A single-component plugin is its own controller; otherwise the
        // controller is a second class of the same factory.
        controller_ = U::cast<IEditController>(component_);
        separateController_ = controller_ == nullptr;
        if (separateController_)
        {
            TUID controllerId {};
            if (component_->getControllerClassId(controllerId) == kResultOk)
            {
                controller_ = factory.createInstance<IEditController>(VST3::UID::fromTUID(controllerId));
                if (controller_ != nullptr)
                {
                    const tresult result = controller_->initialize(hostContext_.get());
                    if (result != kResultOk)
                    {
                        controller_ = nullptr;
                        throw Failure("initialization-failed",
                                      "the controller of \"" + name
                                          + "\" failed to initialize (IEditController::initialize returned "
                                          + tresultName(result) + ")");
                    }
                }
            }
        }

        if (controller_ != nullptr)
        {
            controller_->setComponentHandler(componentHandler_);
            if (separateController_)
            {
                auto componentPoint = U::cast<IConnectionPoint>(component_);
                auto controllerPoint = U::cast<IConnectionPoint>(controller_);
                if (componentPoint != nullptr && controllerPoint != nullptr)
                {
                    componentConnection_ = owned(new ConnectionProxy(componentPoint));
                    controllerConnection_ = owned(new ConnectionProxy(controllerPoint));
                    componentConnection_->connect(controllerPoint);
                    controllerConnection_->connect(componentPoint);
                }
                // The controller starts from the component's state.
                auto stream = owned(new MemoryStream());
                if (component_->getState(stream) == kResultOk)
                {
                    stream->seek(0, IBStream::kIBSeekSet, nullptr);
                    controller_->setComponentState(stream);
                }
            }
            midiMapping_ = U::cast<IMidiMapping>(controller_);
            parameterCount_ = controller_->getParameterCount();
        }
        ++parameterGeneration_;

        if (processor_->canProcessSampleSize(kSample32) != kResultTrue)
            throw Failure("unsupported-plugin", "\"" + name + "\" cannot process 32-bit float samples");

        negotiate(setup_);
        activate();
    }

    void Plugin::destroyInstance()
    {
        closeEditor();
        deactivate();
        if (componentConnection_ != nullptr)
            static_cast<ConnectionProxy*>(componentConnection_.get())->disconnect();
        if (controllerConnection_ != nullptr)
            static_cast<ConnectionProxy*>(controllerConnection_.get())->disconnect();
        componentConnection_ = nullptr;
        controllerConnection_ = nullptr;
        midiMapping_ = nullptr;
        if (controller_ != nullptr)
        {
            controller_->setComponentHandler(nullptr);
            if (separateController_)
                controller_->terminate();
        }
        controller_ = nullptr;
        processor_ = nullptr;
        if (component_ != nullptr)
            component_->terminate();
        component_ = nullptr;
        audioInputs_.clear();
        audioOutputs_.clear();
        eventInputs_.clear();
        eventOutputs_.clear();
        const std::scoped_lock lock(pendingMutex_);
        pending_.clear();
        pendingEvents_.clear();
        pendingRestart_ = 0;
        parameterCount_ = 0;
        ++parameterGeneration_;
    }

    void Plugin::unload()
    {
        const std::scoped_lock processing(processing_);
        destroyInstance();
#if defined(__linux__)
        // Handlers live in the module: release them before it goes.
        runLoop_->clear();
#endif
        class_ = {};
        module_ = nullptr;
    }

    void Plugin::recreate()
    {
        const std::scoped_lock processing(processing_);
        requireLoaded();
        destroyInstance();
        {
            const std::scoped_lock lock(transportMutex_);
            transport_ = {};
            ++transportEdits_;
        }
        continuousSamples_ = 0;
        createInstance();
    }

    void Plugin::reset()
    {
        const std::scoped_lock processing(processing_);
        requireLoaded();
        deactivate();
        continuousSamples_ = 0;
        activate();
    }

    void Plugin::configure(const Setup& setup)
    {
        const std::scoped_lock processing(processing_);
        requireLoaded();
        deactivate();
        try
        {
            negotiate(setup);
            setup_ = setup;
        }
        catch (...)
        {
            // Back to the previous, working setup.
            negotiate(setup_);
            activate();
            throw;
        }
        activate();
    }

    // ── Buses and activation ─────────────────────────────────────────────

    void Plugin::readBuses()
    {
        auto read = [this](MediaType media, BusDirection direction, std::vector<Bus>& buses)
        {
            const int32 count = component_->getBusCount(media, direction);
            buses.assign(static_cast<size_t>(std::max(count, 0)), Bus {});
            for (int32 index = 0; index < count; ++index)
            {
                BusInfo info {};
                Bus& bus = buses[static_cast<size_t>(index)];
                if (component_->getBusInfo(media, direction, index, info) == kResultOk)
                {
                    bus.name = Steinberg::Vst::StringConvert::convert(info.name);
                    bus.type = info.busType;
                    bus.channels = info.channelCount;
                    bus.defaultActive = (info.flags & BusInfo::kDefaultActive) != 0;
                }
                if (media == kAudio)
                {
                    SpeakerArrangement arrangement = 0;
                    if (processor_->getBusArrangement(direction, index, arrangement) == kResultOk)
                    {
                        bus.arrangement = arrangement;
                        bus.channels = SpeakerArr::getChannelCount(arrangement);
                    }
                }
            }
        };
        read(kAudio, kInput, audioInputs_);
        read(kAudio, kOutput, audioOutputs_);
        read(kEvent, kInput, eventInputs_);
        read(kEvent, kOutput, eventOutputs_);
    }

    void Plugin::negotiate(const Setup& setup)
    {
        readBuses();
        const std::string name = class_.name();

        auto check = [&](const std::vector<std::optional<BusRequest>>& requests, const std::vector<Bus>& buses,
                         const char* direction)
        {
            if (requests.size() > buses.size())
                throw Failure("unsupported-configuration", std::to_string(requests.size()) + " audio " + direction
                                                               + " buses were requested; \"" + name + "\" has "
                                                               + std::to_string(buses.size()));
        };
        check(setup.inputs, audioInputs_, "input");
        check(setup.outputs, audioOutputs_, "output");

        // Arrangements: the request where there is one, else what the plugin
        // has, offered together as setBusArrangements requires.
        auto wanted = [](const std::vector<std::optional<BusRequest>>& requests, const std::vector<Bus>& buses)
        {
            std::vector<SpeakerArrangement> result;
            for (size_t index = 0; index < buses.size(); ++index)
            {
                const auto& request = index < requests.size() ? requests[index] : std::nullopt;
                result.push_back(request && request->arrangement ? *request->arrangement : buses[index].arrangement);
            }
            return result;
        };
        auto inputs = wanted(setup.inputs, audioInputs_);
        auto outputs = wanted(setup.outputs, audioOutputs_);
        bool changed = false;
        for (size_t i = 0; i < inputs.size(); ++i)
            changed = changed || inputs[i] != audioInputs_[i].arrangement;
        for (size_t i = 0; i < outputs.size(); ++i)
            changed = changed || outputs[i] != audioOutputs_[i].arrangement;
        if (changed)
        {
            processor_->setBusArrangements(inputs.data(), static_cast<int32>(inputs.size()), outputs.data(),
                                           static_cast<int32>(outputs.size()));
            readBuses();
            // A plugin that refuses may adapt to something else instead:
            // what counts is whether the requested arrangements hold now.
            auto verify = [&](const std::vector<std::optional<BusRequest>>& requests, const std::vector<Bus>& buses,
                              const char* direction)
            {
                for (size_t index = 0; index < requests.size(); ++index)
                {
                    const auto& request = requests[index];
                    if (! request || ! request->arrangement || *request->arrangement == buses[index].arrangement)
                        continue;
                    throw Failure("unsupported-configuration",
                                  "\"" + name + "\" does not accept " + arrangementName(*request->arrangement)
                                      + " on audio " + direction + " bus " + std::to_string(index) + " (\""
                                      + buses[index].name + "\"); it proposes "
                                      + arrangementName(buses[index].arrangement));
                }
            };
            verify(setup.inputs, audioInputs_, "input");
            verify(setup.outputs, audioOutputs_, "output");
        }

        auto activateBuses = [&](MediaType media, BusDirection direction,
                                 const std::vector<std::optional<BusRequest>>& requests, std::vector<Bus>& buses)
        {
            for (size_t index = 0; index < buses.size(); ++index)
            {
                const auto& request = index < requests.size() ? requests[index] : std::nullopt;
                // Main buses and those the plugin marks default-active; every
                // event bus, so that MIDI reaches the plugin.
                bool active = media == kEvent || buses[index].type == kMain || buses[index].defaultActive;
                if (request && request->active)
                    active = *request->active;
                component_->activateBus(media, direction, static_cast<int32>(index), active);
                buses[index].active = active;
            }
        };
        static const std::vector<std::optional<BusRequest>> none;
        activateBuses(kAudio, kInput, setup.inputs, audioInputs_);
        activateBuses(kAudio, kOutput, setup.outputs, audioOutputs_);
        activateBuses(kEvent, kInput, none, eventInputs_);
        activateBuses(kEvent, kOutput, none, eventOutputs_);

        ProcessSetup processSetup { setup.processMode, kSample32, setup.blockSize, setup.sampleRate };
        const tresult result = processor_->setupProcessing(processSetup);
        if (result != kResultOk)
            throw Failure("unsupported-configuration",
                          "\"" + name + "\" refused " + std::to_string(setup.sampleRate) + " Hz with blocks of "
                              + std::to_string(setup.blockSize) + " frames in " + processModeName(setup.processMode)
                              + " mode (setupProcessing returned " + tresultName(result) + ")");
    }

    void Plugin::activate()
    {
        if (active_)
            return;
        const tresult result = component_->setActive(true);
        if (result != kResultOk)
            throw Failure("initialization-failed", "\"" + class_.name() + "\" failed to activate (setActive returned "
                                                       + tresultName(result) + ")");
        active_ = true;
        processor_->setProcessing(true);
    }

    void Plugin::deactivate()
    {
        if (! active_)
            return;
        processor_->setProcessing(false);
        component_->setActive(false);
        active_ = false;
    }

    // ── Plugin requests (IComponentHandler, IPlugFrame) ──────────────────

    void Plugin::beginEdit(ParamID id)
    {
        Json params = Json::object();
        params.set("id", id);
        loop_.post([this, params] { callbacks_.emit("beginEdit", params); });
    }

    void Plugin::performEdit(ParamID id, ParamValue value)
    {
        {
            const std::scoped_lock lock(pendingMutex_);
            pending_.push_back({ id, value, 0 });
        }
        Json params = Json::object();
        params.set("id", id);
        params.set("value", value);
        loop_.post([this, params] { callbacks_.emit("performEdit", params); });
    }

    void Plugin::endEdit(ParamID id)
    {
        Json params = Json::object();
        params.set("id", id);
        loop_.post([this, params] { callbacks_.emit("endEdit", params); });
    }

    void Plugin::restartComponent(int32 flags)
    {
        loop_.post(
            [this, flags]
            {
                pendingRestart_ |= flags;
                if (! busy)
                    applyPendingRestarts();
            });
    }

    void Plugin::applyPendingRestarts()
    {
        const std::scoped_lock processing(processing_);
        const int32 flags = std::exchange(pendingRestart_, 0);
        if (flags == 0 || component_ == nullptr)
            return;
        // Latency, I/O and reload restarts need the plugin deactivated and
        // reactivated; they happen between process calls, never during one.
        if ((flags & (kParamTitlesChanged | kReloadComponent)) != 0 && controller_ != nullptr)
        {
            parameterCount_ = controller_->getParameterCount();
            ++parameterGeneration_;
        }
        if ((flags & (kLatencyChanged | kIoChanged | kReloadComponent)) != 0 && active_)
        {
            deactivate();
            if ((flags & kIoChanged) != 0)
                negotiate(setup_);
            activate();
        }
        Json params = Json::object();
        params.set("flags", flags);
        Json names = Json::array();
        const std::array<std::pair<int32, const char*>, 6> known { { { kReloadComponent, "reloadComponent" },
                                                                     { kIoChanged, "ioChanged" },
                                                                     { kParamValuesChanged, "paramValuesChanged" },
                                                                     { kLatencyChanged, "latencyChanged" },
                                                                     { kParamTitlesChanged, "paramTitlesChanged" },
                                                                     { kMidiCCAssignmentChanged,
                                                                       "midiCCAssignmentChanged" } } };
        for (const auto& [flag, name] : known)
            if ((flags & flag) != 0)
                names.push(name);
        params.set("reasons", std::move(names));
        params.set("latencySamples", static_cast<int64>(processor_->getLatencySamples()));
        callbacks_.emit("restart", std::move(params));
    }

    void Plugin::setDirty(bool dirty)
    {
        Json params = Json::object();
        params.set("dirty", dirty);
        callbacks_.emit("dirty", std::move(params));
    }

    void Plugin::requestOpenEditor()
    {
        callbacks_.emit("editorRequested", Json::object());
    }

    bool Plugin::resizeView(IPlugView* view, ViewRect* size)
    {
        if (view != view_.get() || window_ == nullptr || resizing_)
            return false;
        resizing_ = true;
        keepToRoom(*size);
        window_->constrainContentSize(size->getWidth(), size->getHeight());
        view_->onSize(size);
        resizing_ = false;
        Json params = editorInfo();
        callbacks_.emit("editorResized", std::move(params));
        return true;
    }

    // ── Information ──────────────────────────────────────────────────────

    Json Plugin::busesJson() const
    {
        auto list = [](const std::vector<Bus>& buses, bool audio)
        {
            Json result = Json::array();
            for (size_t index = 0; index < buses.size(); ++index)
            {
                const Bus& bus = buses[index];
                Json entry = Json::object();
                entry.set("index", static_cast<int>(index));
                entry.set("name", bus.name);
                entry.set("type", busTypeName(bus.type));
                entry.set("channels", bus.channels);
                if (audio)
                    entry.set("arrangement", arrangementName(bus.arrangement));
                entry.set("active", bus.active);
                entry.set("defaultActive", bus.defaultActive);
                result.push(std::move(entry));
            }
            return result;
        };
        Json buses = Json::object();
        buses.set("audioInputs", list(audioInputs_, true));
        buses.set("audioOutputs", list(audioOutputs_, true));
        buses.set("eventInputs", list(eventInputs_, false));
        buses.set("eventOutputs", list(eventOutputs_, false));
        return buses;
    }

    Json Plugin::info() const
    {
        requireLoaded();
        Json result = Json::object();
        result.set("path", path_);
        result.set("name", class_.name());
        result.set("classId", classIdString(class_.ID()));
        result.set("vendor", class_.vendor());
        result.set("version", class_.version());
        result.set("sdkVersion", class_.sdkVersion());
        Json categories = Json::array();
        for (const auto& category : class_.subCategories())
            categories.push(category);
        result.set("subCategories", std::move(categories));
        const auto factory = module_->getFactory().info();
        Json factoryInfo = Json::object();
        factoryInfo.set("vendor", factory.vendor());
        factoryInfo.set("url", factory.url());
        factoryInfo.set("email", factory.email());
        result.set("factory", std::move(factoryInfo));
        Json classes = Json::array();
        for (const auto& info : module_->getFactory().classInfos())
        {
            if (info.category() != kVstAudioEffectClass)
                continue;
            Json entry = Json::object();
            entry.set("name", info.name());
            entry.set("classId", classIdString(info.ID()));
            classes.push(std::move(entry));
        }
        result.set("classes", std::move(classes));
        result.set("separateController", separateController_);
        result.set("hasController", controller_ != nullptr);
        result.set("sampleRate", setup_.sampleRate);
        result.set("blockSize", setup_.blockSize);
        result.set("processMode", processModeName(setup_.processMode));
        result.set("buses", busesJson());
        result.set("parameterCount", controller_ != nullptr ? controller_->getParameterCount() : 0);
        const Json processing = latencyAndTail();
        result.set("latencySamples", *processing.find("latencySamples"));
        result.set("tailSamples", *processing.find("tailSamples"));
        return result;
    }

    Json Plugin::latencyAndTail() const
    {
        requireLoaded();
        Json result = Json::object();
        result.set("latencySamples", static_cast<int64>(processor_->getLatencySamples()));
        const uint32 tail = processor_->getTailSamples();
        if (tail == kInfiniteTail)
            result.set("tailSamples", "infinite");
        else
            result.set("tailSamples", static_cast<int64>(tail));
        return result;
    }

    Json Plugin::parameterJson(int32 index) const
    {
        ParameterInfo info {};
        controller_->getParameterInfo(index, info);
        const ParamValue value = controller_->getParamNormalized(info.id);
        Json entry = Json::object();
        entry.set("id", info.id);
        entry.set("title", Steinberg::Vst::StringConvert::convert(info.title));
        entry.set("shortTitle", Steinberg::Vst::StringConvert::convert(info.shortTitle));
        entry.set("units", Steinberg::Vst::StringConvert::convert(info.units));
        entry.set("stepCount", info.stepCount);
        entry.set("defaultNormalized", info.defaultNormalizedValue);
        entry.set("unitId", info.unitId);
        Json flags = Json::object();
        flags.set("canAutomate", (info.flags & ParameterInfo::kCanAutomate) != 0);
        flags.set("readOnly", (info.flags & ParameterInfo::kIsReadOnly) != 0);
        flags.set("wrap", (info.flags & ParameterInfo::kIsWrapAround) != 0);
        flags.set("list", (info.flags & ParameterInfo::kIsList) != 0);
        flags.set("hidden", (info.flags & ParameterInfo::kIsHidden) != 0);
        flags.set("programChange", (info.flags & ParameterInfo::kIsProgramChange) != 0);
        flags.set("bypass", (info.flags & ParameterInfo::kIsBypass) != 0);
        entry.set("flags", std::move(flags));
        entry.set("normalized", value);
        entry.set("plain", controller_->normalizedParamToPlain(info.id, value));
        String128 display {};
        if (controller_->getParamStringByValue(info.id, value, display) == kResultOk)
            entry.set("display", Steinberg::Vst::StringConvert::convert(display));
        else
            entry.set("display", nullptr);
        return entry;
    }

    Json Plugin::parameters() const
    {
        requireLoaded();
        Json result = Json::array();
        if (controller_ == nullptr)
            return result;
        const int32 count = controller_->getParameterCount();
        for (int32 index = 0; index < count; ++index)
            result.push(parameterJson(index));
        return result;
    }

    Json Plugin::parameter(ParamID id) const
    {
        requireLoaded();
        if (controller_ != nullptr)
        {
            const int32 count = controller_->getParameterCount();
            for (int32 index = 0; index < count; ++index)
            {
                ParameterInfo info {};
                if (controller_->getParameterInfo(index, info) == kResultOk && info.id == id)
                    return parameterJson(index);
            }
        }
        throw Failure("unknown-parameter", "\"" + class_.name() + "\" has no parameter with id " + std::to_string(id)
                                               + " (getParameters lists them)");
    }

    Json Plugin::setParameter(ParamID id, std::optional<double> normalized, std::optional<double> plain)
    {
        const Json current = parameter(id);
        if (current.find("flags")->find("readOnly")->asBool())
            throw Failure("invalid-request", "parameter " + std::to_string(id) + " (\""
                                                 + current.find("title")->asString() + "\") is read-only");
        double value = 0;
        if (normalized)
        {
            if (! std::isfinite(*normalized) || *normalized < 0 || *normalized > 1)
                throw Failure("invalid-request",
                              "a normalized parameter value is between 0 and 1, not " + std::to_string(*normalized));
            value = *normalized;
        }
        else
        {
            const double given = plain.value_or(std::nan(""));
            if (! std::isfinite(given))
                throw Failure("invalid-request", "a plain parameter value must be finite");
            value = std::clamp(controller_->plainParamToNormalized(id, given), 0.0, 1.0);
        }
        controller_->setParamNormalized(id, value);
        {
            const std::scoped_lock lock(pendingMutex_);
            pending_.push_back({ id, value, 0 });
        }
        return parameter(id);
    }

    // ── State ────────────────────────────────────────────────────────────

    void Plugin::flushParameters()
    {
        // A process call without samples carries pending parameter changes
        // to the processor, as hosts do when they are not playing.
        {
            const std::scoped_lock lock(pendingMutex_);
            if (pending_.empty())
                return;
        }
        ProcessJob job;
        job.inputs.resize(audioInputs_.size());
        for (size_t bus = 0; bus < audioInputs_.size(); ++bus)
            job.inputs[bus].assign(static_cast<size_t>(audioInputs_[bus].channels), nullptr);
        runProcess(job);
    }

    std::vector<uint8_t> Plugin::getState(size_t& componentSize)
    {
        const std::scoped_lock processing(processing_);
        requireLoaded();
        flushParameters();
        auto component = owned(new MemoryStream());
        tresult result = component_->getState(component);
        if (result != kResultOk)
            throw Failure("plugin-error", "the plugin could not save its state (IComponent::getState returned "
                                              + tresultName(result) + ")");
        auto controller = owned(new MemoryStream());
        if (controller_ != nullptr)
        {
            result = controller_->getState(controller);
            if (result != kResultOk && result != kNotImplemented)
                throw Failure("plugin-error", "the plugin's controller could not save its state "
                                              "(IEditController::getState returned "
                                                  + tresultName(result) + ")");
        }
        componentSize = static_cast<size_t>(component->getSize());
        std::vector<uint8_t> bytes(componentSize + static_cast<size_t>(controller->getSize()));
        if (componentSize > 0)
            std::memcpy(bytes.data(), component->getData(), componentSize);
        if (controller->getSize() > 0)
            std::memcpy(bytes.data() + componentSize, controller->getData(),
                        static_cast<size_t>(controller->getSize()));
        return bytes;
    }

    void Plugin::setState(const uint8_t* component, size_t componentSize, const uint8_t* controller,
                          size_t controllerSize)
    {
        const std::scoped_lock processing(processing_);
        requireLoaded();
        // MemoryStream reads the given bytes without taking ownership.
        auto componentStream =
            owned(new MemoryStream(const_cast<uint8_t*>(component), static_cast<TSize>(componentSize)));
        const tresult result = component_->setState(componentStream);
        if (result != kResultOk)
            throw Failure("plugin-error",
                          "the plugin rejected the state (IComponent::setState returned " + tresultName(result) + ")");
        if (controller_ != nullptr)
        {
            componentStream->seek(0, IBStream::kIBSeekSet, nullptr);
            controller_->setComponentState(componentStream);
            if (controllerSize > 0)
            {
                auto controllerStream =
                    owned(new MemoryStream(const_cast<uint8_t*>(controller), static_cast<TSize>(controllerSize)));
                const tresult controllerResult = controller_->setState(controllerStream);
                if (controllerResult != kResultOk && controllerResult != kNotImplemented)
                    throw Failure("plugin-error",
                                  "the plugin's controller rejected its state (IEditController::setState returned "
                                      + tresultName(controllerResult) + ")");
            }
        }
        // The processor now holds these values: earlier edits are obsolete.
        const std::scoped_lock lock(pendingMutex_);
        pending_.clear();
    }

    // ── Processing ───────────────────────────────────────────────────────

    namespace
    {
        int64 integerField(const Json& object, const char* name, int64 fallback, int64 minimum, int64 maximum,
                           const std::string& where)
        {
            const Json* value = object.find(name);
            if (value == nullptr || value->isNull())
                return fallback;
            if (! value->isNumber() || value->asNumber() != std::floor(value->asNumber())
                || value->asNumber() < static_cast<double>(minimum) || value->asNumber() > static_cast<double>(maximum))
                throw Failure("invalid-request", where + "." + name + " must be an integer from "
                                                     + std::to_string(minimum) + " to " + std::to_string(maximum));
            return static_cast<int64>(value->asNumber());
        }

        double numberField(const Json& object, const char* name, double fallback, double minimum, double maximum,
                           const std::string& where)
        {
            const Json* value = object.find(name);
            if (value == nullptr || value->isNull())
                return fallback;
            if (! value->isNumber() || ! std::isfinite(value->asNumber()) || value->asNumber() < minimum
                || value->asNumber() > maximum)
            {
                std::ostringstream range;
                range << minimum << " to " << maximum;
                throw Failure("invalid-request", where + "." + name + " must be a number from " + range.str());
            }
            return value->asNumber();
        }

        constexpr int64 maxFrames = int64 { 1 } << 31U;
    } // namespace

    Transport Plugin::parseTransport(const Json& transport, const std::string& where) const
    {
        if (! transport.isObject())
            throw Failure("invalid-request", where + " must be an object");
        Transport next = this->transport();
        if (const Json* playing = transport.find("playing"); playing != nullptr)
        {
            if (! playing->isBool())
                throw Failure("invalid-request", where + ".playing must be a boolean");
            next.playing = playing->asBool();
        }
        next.tempo = numberField(transport, "tempo", next.tempo, 1, 999, where);
        if (const Json* signature = transport.find("timeSignature"); signature != nullptr)
        {
            if (! signature->isObject())
                throw Failure("invalid-request", where + ".timeSignature must be { numerator, denominator }");
            next.numerator = static_cast<int32>(
                integerField(*signature, "numerator", next.numerator, 1, 64, where + ".timeSignature"));
            next.denominator = static_cast<int32>(
                integerField(*signature, "denominator", next.denominator, 1, 64, where + ".timeSignature"));
        }
        const bool hasSamples = transport.find("samplePosition") != nullptr;
        const bool hasMusic = transport.find("musicalPosition") != nullptr;
        if (hasSamples && hasMusic)
            throw Failure("invalid-request", where + " takes samplePosition or musicalPosition, not both");
        if (hasSamples)
            next.samplePosition =
                integerField(transport, "samplePosition", 0, -(int64 { 1 } << 52U), int64 { 1 } << 52U, where);
        if (hasMusic)
        {
            const double quarters = numberField(transport, "musicalPosition", 0, -1e12, 1e12, where);
            next.samplePosition = static_cast<int64>(std::llround(quarters * 60.0 / next.tempo * setup_.sampleRate));
        }
        return next;
    }

    Json Plugin::transportJson() const
    {
        const Transport now = this->transport();
        Json transport = Json::object();
        transport.set("playing", now.playing);
        transport.set("tempo", now.tempo);
        Json signature = Json::object();
        signature.set("numerator", now.numerator);
        signature.set("denominator", now.denominator);
        transport.set("timeSignature", std::move(signature));
        transport.set("samplePosition", now.samplePosition);
        transport.set("musicalPosition",
                      static_cast<double>(now.samplePosition) / setup_.sampleRate * now.tempo / 60.0);
        return transport;
    }

    Json Plugin::setTransport(const Json& params)
    {
        requireLoaded();
        const Transport next = parseTransport(params, "setTransport");
        editTransport([&](Transport& transport) { transport = next; });
        return transportJson();
    }

    std::unique_ptr<ProcessJob> Plugin::prepareProcess(const Json& params, Payload&& payload)
    {
        requireLoaded();
        auto job = std::make_unique<ProcessJob>();
        job->frames = integerField(params, "frames", -1, 0, maxFrames, "process");
        if (job->frames < 0)
            throw Failure("invalid-request", "process.frames is required");

        // The payload holds the provided input buses' channels in order, each
        // `frames` float32 samples; `inputs` lists the channel count of each
        // bus, 0 for an omitted bus (silence).
        const Json* inputs = params.find("inputs");
        if (inputs != nullptr && ! inputs->isArray())
            throw Failure("invalid-request", "process.inputs must be an array of channel counts");
        const size_t providedBuses = inputs != nullptr ? inputs->asArray().size() : 0;
        if (providedBuses > audioInputs_.size())
            throw Failure("invalid-request", "process.inputs has " + std::to_string(providedBuses)
                                                 + " buses; the plugin has " + std::to_string(audioInputs_.size())
                                                 + " audio input buses");
        size_t expectedBytes = 0;
        job->inputs.resize(audioInputs_.size());
        std::vector<size_t> offsets;
        for (size_t bus = 0; bus < audioInputs_.size(); ++bus)
        {
            const Bus& info = audioInputs_[bus];
            int64 channels = 0;
            if (bus < providedBuses)
            {
                const Json& count = inputs->asArray()[bus];
                if (! count.isNumber() || count.asNumber() != std::floor(count.asNumber()) || count.asNumber() < 0
                    || count.asNumber() > 1024)
                    throw Failure("invalid-request",
                                  "process.inputs[" + std::to_string(bus) + "] must be a channel count");
                channels = static_cast<int64>(count.asNumber());
            }
            job->inputs[bus].assign(static_cast<size_t>(info.channels), nullptr);
            if (channels == 0)
                continue;
            if (! info.active)
                throw Failure("invalid-request", "audio input bus " + std::to_string(bus) + " (\"" + info.name
                                                     + "\") is inactive; omit its audio or activate it");
            if (channels != info.channels)
                throw Failure("invalid-request", "audio input bus " + std::to_string(bus) + " (\"" + info.name
                                                     + "\") has " + std::to_string(info.channels) + " channels ("
                                                     + arrangementName(info.arrangement) + "); "
                                                     + std::to_string(channels) + " were given");
            for (int64 channel = 0; channel < channels; ++channel)
            {
                offsets.push_back(expectedBytes);
                expectedBytes += static_cast<size_t>(job->frames) * sizeof(float);
            }
        }
        if (payload.size() != expectedBytes)
            throw Failure("invalid-request", "the request carries " + std::to_string(payload.size())
                                                 + " bytes of audio; its inputs and frames describe "
                                                 + std::to_string(expectedBytes));
        job->input = std::move(payload);
        size_t next = 0;
        for (size_t bus = 0; bus < providedBuses; ++bus)
        {
            if (inputs->asArray()[bus].asNumber() == 0)
                continue;
            for (auto& channel : job->inputs[bus])
                channel = reinterpret_cast<const float*>(job->input.data() + offsets[next++]);
        }

        // Outputs: every active output bus, as many channels as it has.
        size_t outputBytes = 0;
        for (const Bus& bus : audioOutputs_)
        {
            job->outputChannels.push_back(bus.active ? bus.channels : 0);
            if (bus.active)
                outputBytes += static_cast<size_t>(bus.channels) * static_cast<size_t>(job->frames) * sizeof(float);
        }
        if (outputBytes > std::numeric_limits<uint32_t>::max())
            throw Failure("message-too-large", "the output of " + std::to_string(job->frames)
                                                   + " frames does not fit one response; process fewer frames");
        job->output.resize(outputBytes);

        const std::string pluginName = class_.name();
        if (const Json* changes = params.find("parameterChanges"); changes != nullptr && ! changes->isNull())
        {
            if (! changes->isArray())
                throw Failure("invalid-request", "process.parameterChanges must be an array");
            for (size_t index = 0; index < changes->asArray().size(); ++index)
            {
                const Json& change = changes->asArray()[index];
                const std::string where = "process.parameterChanges[" + std::to_string(index) + "]";
                if (! change.isObject())
                    throw Failure("invalid-request", where + " must be an object");
                const auto id = static_cast<ParamID>(integerField(change, "id", -1, 0, 0xFFFFFFFFLL, where));
                if (change.find("id") == nullptr)
                    throw Failure("invalid-request", where + ".id is required");
                parameter(id); // exists
                job->changes.push_back(
                    { id, numberField(change, "value", -1, 0, 1, where),
                      integerField(change, "time", 0, 0, job->frames - 1 < 0 ? 0 : job->frames - 1, where) });
                if (job->changes.back().value < 0)
                    throw Failure("invalid-request", where + ".value (normalized, 0 to 1) is required");
            }
        }

        std::vector<std::string> warnings;
        if (const Json* events = params.find("events"); events != nullptr && ! events->isNull())
        {
            if (! events->isArray())
                throw Failure("invalid-request", "process.events must be an array");
            for (size_t index = 0; index < events->asArray().size(); ++index)
            {
                const Json& source = events->asArray()[index];
                const std::string where = "process.events[" + std::to_string(index) + "]";
                if (! source.isObject() || source.find("type") == nullptr || ! source.find("type")->isString())
                    throw Failure("invalid-request", where + " must be an object with a type");
                const std::string type = source.find("type")->asString();
                const int64 time = integerField(source, "time", 0, 0, job->frames - 1 < 0 ? 0 : job->frames - 1, where);
                const auto bus = static_cast<int32>(integerField(source, "bus", 0, 0, 1023, where));
                const auto channel = static_cast<int16>(integerField(source, "channel", 0, 0, 15, where));

                if (type == "controlChange" || type == "pitchBend" || type == "channelPressure")
                {
                    // MIDI controllers reach VST3 plugins as parameters, through
                    // the controller's IMidiMapping.
                    CtrlNumber controllerNumber = kPitchBend;
                    double value = 0;
                    if (type == "controlChange")
                    {
                        controllerNumber =
                            static_cast<CtrlNumber>(integerField(source, "controller", -1, 0, 127, where));
                        if (controllerNumber < 0)
                            throw Failure("invalid-request", where + ".controller (0 to 127) is required");
                        value = numberField(source, "value", 0, 0, 1, where);
                    }
                    else if (type == "pitchBend")
                        value = (numberField(source, "value", 0, -1, 1, where) + 1) / 2;
                    else
                    {
                        controllerNumber = kAfterTouch;
                        value = numberField(source, "value", 0, 0, 1, where);
                    }
                    ParamID id = 0;
                    if (midiMapping_ != nullptr
                        && midiMapping_->getMidiControllerAssignment(bus, channel, controllerNumber, id) == kResultTrue)
                        job->changes.push_back({ id, value, time });
                    else
                    {
                        std::string warning = where;
                        warning += ": \"";
                        warning += pluginName;
                        warning += "\" maps no parameter to ";
                        warning += type;
                        if (type == "controlChange")
                            warning += " " + std::to_string(controllerNumber);
                        warning += " on channel " + std::to_string(channel) + "; it was dropped";
                        warnings.push_back(std::move(warning));
                    }
                    continue;
                }

                if (static_cast<size_t>(bus) >= eventInputs_.size())
                {
                    std::string message = where;
                    message += ": \"" + pluginName + "\" has " + std::to_string(eventInputs_.size());
                    message += " event input buses; it takes no events on bus " + std::to_string(bus);
                    throw Failure("invalid-request", message);
                }
                Event event {};
                event.busIndex = bus;
                event.sampleOffset = static_cast<int32>(time);
                event.flags = Event::kIsLive;
                const auto noteId = static_cast<int32>(integerField(source, "noteId", -1, -1, 0x7FFFFFFF, where));
                const auto pitch = static_cast<int16>(integerField(source, "pitch", -1, 0, 127, where));
                if (type == "noteOn" || type == "noteOff" || type == "polyPressure")
                {
                    if (pitch < 0)
                        throw Failure("invalid-request", where + ".pitch (0 to 127) is required");
                }
                if (type == "noteOn")
                {
                    event.type = Event::kNoteOnEvent;
                    event.noteOn = { channel,
                                     pitch,
                                     static_cast<float>(numberField(source, "tuning", 0, -1200, 1200, where)),
                                     static_cast<float>(numberField(source, "velocity", 1, 0, 1, where)),
                                     static_cast<int32>(integerField(source, "length", 0, 0, maxFrames, where)),
                                     noteId };
                }
                else if (type == "noteOff")
                {
                    event.type = Event::kNoteOffEvent;
                    event.noteOff = { channel, pitch,
                                      static_cast<float>(numberField(source, "velocity", 0, 0, 1, where)), noteId,
                                      static_cast<float>(numberField(source, "tuning", 0, -1200, 1200, where)) };
                }
                else if (type == "polyPressure")
                {
                    event.type = Event::kPolyPressureEvent;
                    event.polyPressure = { channel, pitch,
                                           static_cast<float>(numberField(source, "pressure", 0, 0, 1, where)),
                                           noteId };
                }
                else
                {
                    std::string message = where;
                    message += ".type \"" + type;
                    message += "\" is not one of noteOn, noteOff, polyPressure, controlChange, pitchBend, "
                               "channelPressure";
                    throw Failure("invalid-request", message);
                }
                job->events.push_back(event);
            }
        }
        std::stable_sort(job->events.begin(), job->events.end(),
                         [](const Event& a, const Event& b) { return a.sampleOffset < b.sampleOffset; });
        std::stable_sort(job->changes.begin(), job->changes.end(),
                         [](const ParameterChange& a, const ParameterChange& b) { return a.time < b.time; });
        if (job->frames == 0 && (! job->events.empty() || ! job->changes.empty()))
        {
            // Parameter changes may be flushed with zero frames; events need a frame.
            if (! job->events.empty())
                throw Failure("invalid-request", "events need at least one frame to be processed");
        }

        if (const Json* transport = params.find("transport"); transport != nullptr && ! transport->isNull())
            job->transport = parseTransport(*transport, "process.transport");

        job->warnings = std::move(warnings);
        return job;
    }

    void Plugin::runProcess(ProcessJob& job)
    {
        // This call's own copy of the transport, written back at the end
        // unless something changed it meanwhile.
        Transport transport;
        uint64_t edits = 0;
        {
            const std::scoped_lock lock(transportMutex_);
            if (job.transport)
            {
                transport_ = *job.transport;
                ++transportEdits_;
            }
            transport = transport_;
            edits = transportEdits_;
        }

        std::vector<ParameterChange> changes;
        std::vector<Event> events;
        {
            // Edits and notes made since the last call land at its first frame.
            const std::scoped_lock lock(pendingMutex_);
            changes.swap(pending_);
            events.swap(pendingEvents_);
        }
        changes.insert(changes.end(), job.changes.begin(), job.changes.end());
        events.insert(events.end(), job.events.begin(), job.events.end());

        const int64 block = setup_.blockSize;
        const auto inputBuses = static_cast<int32>(audioInputs_.size());
        const auto outputBuses = static_cast<int32>(audioOutputs_.size());

        // Silence for omitted or inactive input buses and somewhere to write
        // for inactive output buses: plugins may touch every bus's channels.
        std::vector<std::vector<std::vector<float>>> scratchIn(audioInputs_.size());
        std::vector<std::vector<std::vector<float>>> scratchOut(audioOutputs_.size());
        std::vector<std::vector<float*>> inPointers(audioInputs_.size());
        std::vector<std::vector<float*>> outPointers(audioOutputs_.size());
        std::vector<AudioBusBuffers> inBuffers(audioInputs_.size());
        std::vector<AudioBusBuffers> outBuffers(audioOutputs_.size());
        for (size_t bus = 0; bus < audioInputs_.size(); ++bus)
        {
            const auto channels = static_cast<size_t>(audioInputs_[bus].channels);
            scratchIn[bus].assign(channels, std::vector<float>(static_cast<size_t>(block)));
            inPointers[bus].resize(channels);
        }
        size_t outputOffset = 0;
        std::vector<std::vector<float*>> outputChannels(audioOutputs_.size());
        for (size_t bus = 0; bus < audioOutputs_.size(); ++bus)
        {
            const auto channels = static_cast<size_t>(audioOutputs_[bus].channels);
            scratchOut[bus].assign(channels, std::vector<float>(static_cast<size_t>(block)));
            outPointers[bus].resize(channels);
            if (job.outputChannels.size() > bus && job.outputChannels[bus] > 0)
                for (size_t channel = 0; channel < channels; ++channel)
                {
                    outputChannels[bus].push_back(reinterpret_cast<float*>(job.output.data() + outputOffset));
                    outputOffset += static_cast<size_t>(job.frames) * sizeof(float);
                }
        }

        ParameterChanges inputChanges(static_cast<int32>(std::max<size_t>(changes.size(), 1)));
        ParameterChanges outputChanges(std::max(parameterCount_, 1));
        EventList inputEvents(static_cast<int32>(std::max<size_t>(events.size(), 1)));
        EventList outputEvents(1024);
        ProcessContext context {};

        size_t nextChange = 0;
        size_t nextEvent = 0;
        int64 start = 0;
        do
        {
            const int64 frames = std::min(block, job.frames - start);
            for (size_t bus = 0; bus < audioInputs_.size(); ++bus)
            {
                for (size_t channel = 0; channel < inPointers[bus].size(); ++channel)
                {
                    const float* source = job.inputs[bus][channel];
                    float* scratch = scratchIn[bus][channel].data();
                    // The plugin gets its own copy: it may process in place.
                    if (source != nullptr)
                        std::memcpy(scratch, source + start, static_cast<size_t>(frames) * sizeof(float));
                    else
                        std::memset(scratch, 0, static_cast<size_t>(frames) * sizeof(float));
                    inPointers[bus][channel] = scratch;
                }
                inBuffers[bus].numChannels = static_cast<int32>(inPointers[bus].size());
                inBuffers[bus].channelBuffers32 = inPointers[bus].data();
                inBuffers[bus].silenceFlags = 0;
            }
            for (size_t bus = 0; bus < audioOutputs_.size(); ++bus)
            {
                for (size_t channel = 0; channel < outPointers[bus].size(); ++channel)
                {
                    // A call without frames has no output buffer: the plugin
                    // still gets valid channels.
                    float* target = outputChannels[bus].empty() || job.frames == 0
                                        ? scratchOut[bus][channel].data()
                                        : outputChannels[bus][channel] + start;
                    std::memset(target, 0, static_cast<size_t>(frames) * sizeof(float));
                    outPointers[bus][channel] = target;
                }
                outBuffers[bus].numChannels = static_cast<int32>(outPointers[bus].size());
                outBuffers[bus].channelBuffers32 = outPointers[bus].data();
                outBuffers[bus].silenceFlags = 0;
            }

            inputChanges.clearQueue();
            while (nextChange < changes.size() && (changes[nextChange].time < start + frames || frames == 0))
            {
                const auto& change = changes[nextChange++];
                int32 queueIndex = 0;
                if (auto* queue = inputChanges.addParameterData(change.id, queueIndex))
                {
                    int32 pointIndex = 0;
                    queue->addPoint(static_cast<int32>(change.time - start), change.value, pointIndex);
                }
            }
            inputEvents.clear();
            while (nextEvent < events.size() && events[nextEvent].sampleOffset < start + frames)
            {
                Event event = events[nextEvent++];
                event.sampleOffset -= static_cast<int32>(start);
                inputEvents.addEvent(event);
            }
            outputChanges.clearQueue();
            outputEvents.clear();

            const double quarters =
                static_cast<double>(transport.samplePosition) / setup_.sampleRate * transport.tempo / 60.0;
            const double barLength = 4.0 * transport.numerator / transport.denominator;
            context.state = ProcessContext::kTempoValid | ProcessContext::kTimeSigValid
                            | ProcessContext::kProjectTimeMusicValid | ProcessContext::kBarPositionValid
                            | ProcessContext::kContTimeValid | (transport.playing ? ProcessContext::kPlaying : 0);
            context.sampleRate = setup_.sampleRate;
            context.projectTimeSamples = transport.samplePosition;
            context.continousTimeSamples = continuousSamples_;
            context.projectTimeMusic = quarters;
            context.barPositionMusic = std::floor(quarters / barLength) * barLength;
            context.tempo = transport.tempo;
            context.timeSigNumerator = transport.numerator;
            context.timeSigDenominator = transport.denominator;

            ProcessData data;
            data.processMode = setup_.processMode;
            data.symbolicSampleSize = kSample32;
            data.numSamples = static_cast<int32>(frames);
            data.numInputs = inputBuses;
            data.numOutputs = outputBuses;
            data.inputs = inBuffers.empty() ? nullptr : inBuffers.data();
            data.outputs = outBuffers.empty() ? nullptr : outBuffers.data();
            data.inputParameterChanges = &inputChanges;
            data.outputParameterChanges = &outputChanges;
            data.inputEvents = &inputEvents;
            data.outputEvents = eventOutputs_.empty() ? nullptr : &outputEvents;
            data.processContext = &context;

            const tresult result = processor_->process(data);
            if (result != kResultOk)
            {
                job.error = "the plugin's process call failed at frame " + std::to_string(start)
                            + " (IAudioProcessor::process returned " + tresultName(result) + ")";
                break;
            }

            for (int32 index = 0; index < outputChanges.getParameterCount(); ++index)
            {
                IParamValueQueue* queue = outputChanges.getParameterData(index);
                for (int32 point = 0; queue != nullptr && point < queue->getPointCount(); ++point)
                {
                    int32 offset = 0;
                    ParamValue value = 0;
                    if (queue->getPoint(point, offset, value) == kResultOk)
                        job.outputChanges.push_back({ queue->getParameterId(), value, start + offset });
                }
            }
            for (int32 index = 0; index < outputEvents.getEventCount(); ++index)
            {
                Event event {};
                if (outputEvents.getEvent(index, event) == kResultOk)
                {
                    event.sampleOffset += static_cast<int32>(start);
                    job.outputEvents.push_back(event);
                }
            }

            if (transport.playing)
                transport.samplePosition += frames;
            continuousSamples_ += frames;
            start += frames;
        } while (start < job.frames);

        const std::scoped_lock lock(transportMutex_);
        if (transportEdits_ == edits)
            transport_ = transport;
    }

    Json Plugin::finishProcess(ProcessJob& job)
    {
        if (! job.error.empty())
            throw Failure("plugin-error", job.error);

        // The controller follows what the processor was given and reported.
        if (controller_ != nullptr)
        {
            std::map<ParamID, double> last;
            for (const auto& change : job.changes)
                last[change.id] = change.value;
            for (const auto& change : job.outputChanges)
                last[change.id] = change.value;
            for (const auto& [id, value] : last)
                controller_->setParamNormalized(id, value);
        }

        Json result = Json::object();
        result.set("frames", job.frames);
        Json outputs = Json::array();
        for (const int32 channels : job.outputChannels)
            outputs.push(channels);
        result.set("outputs", std::move(outputs));

        Json events = Json::array();
        for (const Event& event : job.outputEvents)
        {
            Json entry = Json::object();
            entry.set("time", event.sampleOffset);
            entry.set("bus", event.busIndex);
            switch (event.type)
            {
                case Event::kNoteOnEvent:
                    entry.set("type", "noteOn");
                    entry.set("channel", event.noteOn.channel);
                    entry.set("pitch", event.noteOn.pitch);
                    entry.set("velocity", static_cast<double>(event.noteOn.velocity));
                    entry.set("noteId", event.noteOn.noteId);
                    break;
                case Event::kNoteOffEvent:
                    entry.set("type", "noteOff");
                    entry.set("channel", event.noteOff.channel);
                    entry.set("pitch", event.noteOff.pitch);
                    entry.set("velocity", static_cast<double>(event.noteOff.velocity));
                    entry.set("noteId", event.noteOff.noteId);
                    break;
                case Event::kPolyPressureEvent:
                    entry.set("type", "polyPressure");
                    entry.set("channel", event.polyPressure.channel);
                    entry.set("pitch", event.polyPressure.pitch);
                    entry.set("pressure", static_cast<double>(event.polyPressure.pressure));
                    entry.set("noteId", event.polyPressure.noteId);
                    break;
                case Event::kLegacyMIDICCOutEvent:
                    entry.set("type", "midiCC");
                    entry.set("channel", event.midiCCOut.channel);
                    entry.set("controller", static_cast<int>(event.midiCCOut.controlNumber));
                    entry.set("value", event.midiCCOut.value);
                    entry.set("value2", event.midiCCOut.value2);
                    break;
                default:
                    entry.set("type", "other");
                    entry.set("vstType", event.type);
                    break;
            }
            events.push(std::move(entry));
        }
        result.set("events", std::move(events));

        Json changes = Json::array();
        for (const auto& change : job.outputChanges)
        {
            Json entry = Json::object();
            entry.set("id", change.id);
            entry.set("value", change.value);
            entry.set("time", change.time);
            changes.push(std::move(entry));
        }
        result.set("parameterChanges", std::move(changes));

        result.set("transport", transportJson());
        Json warnings = Json::array();
        for (const auto& warning : job.warnings)
            warnings.push(warning);
        result.set("warnings", std::move(warnings));
        return result;
    }

    // ── Editor ───────────────────────────────────────────────────────────

    Json Plugin::editorInfo() const
    {
        Json result = Json::object();
        result.set("open", view_ != nullptr);
        if (view_ == nullptr)
            return result;
        ViewRect rect {};
        view_->getSize(&rect);
        result.set("width", rect.getWidth());
        result.set("height", rect.getHeight());
        result.set("resizable", view_->canResize() == kResultTrue);
        result.set("scale", scale_);
        result.set("platformType", window_->platformType());
        result.set("presentation", window_->presentation());
        const auto [windowWidth, windowHeight] = window_->windowSize();
        Json window = Json::object();
        window.set("width", windowWidth);
        window.set("height", windowHeight);
        result.set("window", std::move(window));
        if (const auto frames = window_->interfaceFrames())
            result.set("interfaceFrames", static_cast<double>(*frames));
        return result;
    }

    Json Plugin::openEditor(std::optional<double> scale)
    {
        requireLoaded();
        if (! ui_)
            throw Failure("headless", "this host runs headless; launch it with `editor: true` to open editors");
        if (view_ != nullptr)
            return editorInfo();
        if (controller_ == nullptr)
            throw Failure("no-editor", "\"" + class_.name() + "\" has no controller, so no editor");
        auto view = owned(controller_->createView(ViewType::kEditor));
        if (view == nullptr)
            throw Failure("no-editor", "\"" + class_.name() + "\" has no editor (createView returned nothing)");

        ViewRect rect {};
        if (view->getSize(&rect) != kResultOk || rect.getWidth() <= 0 || rect.getHeight() <= 0)
            rect = ViewRect(0, 0, 640, 480);

        const int generation = ++editorGeneration_;
        EditorWindow::Callbacks callbacks;
        callbacks.resized = [this, generation](int width, int height)
        {
            if (generation != editorGeneration_ || view_ == nullptr || resizing_)
                return;
            // Constraint checks may call IPlugFrame::resizeView themselves.
            // Guard the whole negotiation, including native window callbacks.
            resizing_ = true;
            ViewRect size(0, 0, width, height);
            view_->checkSizeConstraint(&size);
            // Resize the native container before the editor paints its new
            // size, including when no constraint correction was necessary.
            window_->constrainContentSize(size.getWidth(), size.getHeight());
            view_->onSize(&size);
            resizing_ = false;
            callbacks_.emit("editorResized", editorInfo());
        };
        callbacks.closed = [this, generation]
        {
            if (generation != editorGeneration_ || view_ == nullptr)
                return;
            closeEditor();
            callbacks_.emit("editorClosed", Json::object());
        };
        callbacks.focusChanged = [this, generation](bool focused)
        {
            if (generation == editorGeneration_ && view_ != nullptr)
                view_->onFocus(focused);
        };
        callbacks.scaleChanged = [this, generation](double next)
        {
            if (generation != editorGeneration_ || view_ == nullptr)
                return;
            scale_ = next;
            if (auto support = U::cast<IPlugViewContentScaleSupport>(view_))
                support->setContentScaleFactor(static_cast<IPlugViewContentScaleSupport::ScaleFactor>(next));
            tellWindowEditorLimits();
        };

        std::string error;
        auto window =
            callbacks_.createWindow(class_.name(), rect.getWidth(), rect.getHeight(), std::move(callbacks), error);
        if (window == nullptr)
            throw Failure("no-display", error);
        if (view->isPlatformTypeSupported(window->platformType()) != kResultTrue)
            throw Failure("unsupported-plugin",
                          "\"" + class_.name() + "\"'s editor does not support " + window->platformType() + " windows");

        frame_ = owned(new PlugFrame(*this,
#if defined(__linux__)
                                     runLoop_->unknownCast()
#else
                                     nullptr
#endif
                                         ));
        view->setFrame(frame_);
        // Scale: the requested one, else the window's (Windows' DPI). On
        // macOS views are in points and the factor is not used.
        scale_ = scale.value_or(window->scale());
#if ! defined(__APPLE__)
        if (auto support = U::cast<IPlugViewContentScaleSupport>(view))
            support->setContentScaleFactor(static_cast<IPlugViewContentScaleSupport::ScaleFactor>(scale_));
#endif
        window->setResizable(view->canResize() == kResultTrue);
        view_ = view;
        window_ = std::move(window);
        const tresult attached = view_->attached(window_->parentHandle(), window_->platformType());
        if (attached != kResultOk)
        {
            view_->setFrame(nullptr);
            view_ = nullptr;
            frame_ = nullptr;
            window_.reset();
            throw Failure("plugin-error", "\"" + class_.name() + "\"'s editor failed to attach (attached returned "
                                              + tresultName(attached) + ")");
        }
        tellWindowEditorLimits();
        // The size may change while attaching (scale, restored size).
        if (view_->getSize(&rect) == kResultOk && rect.getWidth() > 0 && rect.getHeight() > 0)
            window_->setContentSize(rect.getWidth(), rect.getHeight());
        window_->show();
        return editorInfo();
    }

    void Plugin::closeEditor()
    {
        if (view_ == nullptr)
            return;
        ++editorGeneration_;
        view_->removed();
        view_->setFrame(nullptr);
        view_ = nullptr;
        frame_ = nullptr;
        window_.reset();
    }

    void Plugin::previewEditorSize(int width, int height)
    {
        if (view_ == nullptr || view_->canResize() != kResultTrue || resizing_)
            return;
        resizing_ = true;
        ViewRect size(0, 0, std::max(width, 1), std::max(height, 1));
        view_->checkSizeConstraint(&size);
        keepToRoom(size);
        window_->constrainContentSize(size.getWidth(), size.getHeight());
        resizing_ = false;
    }

    void Plugin::previewEditorDrag(int width, int height, int lastWidth, int lastHeight)
    {
        if (view_ == nullptr || view_->canResize() != kResultTrue || resizing_)
            return;
        resizing_ = true;
        constexpr int rounding = 2;
        constexpr int unlimited = 1 << 20;
        width = std::max(width, 1);
        height = std::max(height, 1);
        ViewRect size(0, 0, width, height);
        view_->checkSizeConstraint(&size);
        if (height == lastHeight && width != lastWidth && std::abs(size.getWidth() - width) > rounding)
        {
            ViewRect free(0, 0, width, unlimited);
            view_->checkSizeConstraint(&free);
            if (std::abs(free.getWidth() - width) <= rounding)
                size = free;
        }
        else if (width == lastWidth && height != lastHeight && std::abs(size.getHeight() - height) > rounding)
        {
            ViewRect free(0, 0, unlimited, height);
            view_->checkSizeConstraint(&free);
            if (std::abs(free.getHeight() - height) <= rounding)
                size = free;
        }
        window_->constrainContentSize(size.getWidth(), size.getHeight());
        resizing_ = false;
    }

    void Plugin::tellWindowEditorLimits()
    {
        // VST3 has no call for these: the editor's answers for sizes it cannot
        // be.
        resizing_ = true;
        auto answer = [this](int width, int height)
        {
            ViewRect size(0, 0, width, height);
            view_->checkSizeConstraint(&size);
            return std::pair { std::max(size.getWidth(), 1), std::max(size.getHeight(), 1) };
        };
        const auto smallest = answer(1, 1);
        const auto largest = answer(1 << 20, 1 << 20);
        resizing_ = false;
        window_->setEditorMinimum(smallest.first, smallest.second);
        window_->setEditorMaximum(largest.first, largest.second);
    }

    void Plugin::keepToRoom(ViewRect& size)
    {
        const auto room = window_->editorRoom();
        if (! room)
            return;
        if (size.getWidth() <= room->first && size.getHeight() <= room->second)
            return;
        auto fits = [&room](const ViewRect& rect)
        { return rect.getWidth() <= room->first && rect.getHeight() <= room->second; };
        // Each side on its own, if the editor's shape is free.
        const int width = size.getWidth();
        const int height = size.getHeight();
        ViewRect sides(0, 0, std::min(width, room->first), std::min(height, room->second));
        view_->checkSizeConstraint(&sides);
        if (fits(sides))
        {
            size = sides;
            return;
        }
        // An editor that keeps its aspect ratio asked for more: its shape.
        const double fit =
            std::min(static_cast<double>(room->first) / width, static_cast<double>(room->second) / height);
        ViewRect shaped(0, 0, static_cast<int>(width * fit), static_cast<int>(height * fit));
        view_->checkSizeConstraint(&shaped);
        size = shaped;
    }

    Json Plugin::requestEditorSize(int width, int height)
    {
        if (view_ == nullptr || view_->canResize() != kResultTrue || resizing_)
            return editorInfo();
        resizing_ = true;
        ViewRect size(0, 0, std::max(width, 1), std::max(height, 1));
        view_->checkSizeConstraint(&size);
        keepToRoom(size);
        window_->constrainContentSize(size.getWidth(), size.getHeight());
        view_->onSize(&size);
        resizing_ = false;
        return editorInfo();
    }

    Json Plugin::resizeEditor(int width, int height)
    {
        if (view_ == nullptr)
            throw Failure("invalid-state", "no editor is open");
        if (view_->canResize() != kResultTrue)
            throw Failure("invalid-state", "\"" + class_.name() + "\"'s editor cannot be resized");
        if (width <= 0 || height <= 0)
            throw Failure("invalid-request", "an editor size is positive");
        resizing_ = true;
        ViewRect size(0, 0, width, height);
        view_->checkSizeConstraint(&size);
        window_->setContentSize(size.getWidth(), size.getHeight());
        view_->onSize(&size);
        resizing_ = false;
        return editorInfo();
    }

    // ── Live audio and the host interface ────────────────────────────────

    int32 Plugin::mainInputChannels() const
    {
        for (const auto& bus : audioInputs_)
            if (bus.type == kMain)
                return bus.active ? bus.channels : 0;
        return 0;
    }

    int32 Plugin::mainOutputChannels() const
    {
        for (const auto& bus : audioOutputs_)
            if (bus.type == kMain)
                return bus.active ? bus.channels : 0;
        return 0;
    }

    std::vector<int32> Plugin::inputBusChannels() const
    {
        std::vector<int32> result;
        result.reserve(audioInputs_.size());
        for (const auto& bus : audioInputs_)
            result.push_back(bus.channels);
        return result;
    }

    std::vector<int32> Plugin::outputBusChannels() const
    {
        std::vector<int32> result;
        result.reserve(audioOutputs_.size());
        for (const auto& bus : audioOutputs_)
            result.push_back(bus.channels);
        return result;
    }

    uint32 Plugin::latencySamples() const
    {
        return processor_ != nullptr ? processor_->getLatencySamples() : 0;
    }

    std::vector<HostParameter> Plugin::hostParameters() const
    {
        std::vector<HostParameter> result;
        if (controller_ == nullptr)
            return result;
        const int32 count = controller_->getParameterCount();
        for (int32 index = 0; index < count; ++index)
        {
            ParameterInfo info {};
            if (controller_->getParameterInfo(index, info) != kResultOk || (info.flags & ParameterInfo::kIsHidden) != 0)
                continue;
            HostParameter parameter;
            parameter.id = info.id;
            parameter.title = Steinberg::Vst::StringConvert::convert(info.title);
            parameter.units = Steinberg::Vst::StringConvert::convert(info.units);
            parameter.stepCount = info.stepCount;
            parameter.defaultValue = info.defaultNormalizedValue;
            parameter.readOnly = (info.flags & ParameterInfo::kIsReadOnly) != 0;
            parameter.list = (info.flags & ParameterInfo::kIsList) != 0;
            parameter.bypass = (info.flags & ParameterInfo::kIsBypass) != 0;
            result.push_back(std::move(parameter));
        }
        return result;
    }

    double Plugin::normalizedValue(ParamID id) const
    {
        return controller_ != nullptr ? controller_->getParamNormalized(id) : 0;
    }

    std::string Plugin::valueText(ParamID id, double normalized) const
    {
        if (controller_ == nullptr)
            return {};
        String128 display {};
        if (controller_->getParamStringByValue(id, normalized, display) != kResultOk)
        {
            std::ostringstream text;
            text.precision(3);
            text << controller_->normalizedParamToPlain(id, normalized);
            return text.str();
        }
        return Steinberg::Vst::StringConvert::convert(display);
    }

    void Plugin::editParameter(ParamID id, double normalized)
    {
        if (controller_ == nullptr || ! std::isfinite(normalized))
            return;
        normalized = std::clamp(normalized, 0.0, 1.0);
        controller_->setParamNormalized(id, normalized);
        const std::scoped_lock lock(pendingMutex_);
        pending_.push_back({ id, normalized, 0 });
    }

    void Plugin::queueEvent(const Event& event)
    {
        const std::scoped_lock lock(pendingMutex_);
        pendingEvents_.push_back(event);
    }

    Transport Plugin::transport() const
    {
        const std::scoped_lock lock(transportMutex_);
        return transport_;
    }

    void Plugin::editTransport(const std::function<void(Transport&)>& edit)
    {
        const std::scoped_lock lock(transportMutex_);
        edit(transport_);
        ++transportEdits_;
    }

    void Plugin::applyOutputChanges(const std::vector<ParameterChange>& changes)
    {
        if (controller_ == nullptr)
            return;
        std::map<ParamID, double> last;
        for (const auto& change : changes)
            last[change.id] = change.value;
        for (const auto& [id, value] : last)
            controller_->setParamNormalized(id, value);
    }
} // namespace soundor::vst3host
