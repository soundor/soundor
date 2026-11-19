// Plugins in one process, as a DAW has them: `soundor_vst3_instances
// <bundle>...` loads every bundle given (copies of one plugin at other paths
// are other binaries: other versions of it, as far as the process can
// tell), makes two instances of each, connects each component to its
// controller as a host does, then processes them all with different gains
// and checks each heard only its own, and tears them down in another order
// than they were made.
//
// The bundles are the VST3 runtime's test plugin (tests/plugin): output =
// input × gain, `gain` a parameter whose VST3 id is 3165055 (its id's hash).
// tests/plugin.test.ts runs this after building it.

#include <dlfcn.h>
#include <pluginterfaces/base/ipluginbase.h>
#include <pluginterfaces/vst/ivstaudioprocessor.h>
#include <pluginterfaces/vst/ivstchannelcontextinfo.h>
#include <pluginterfaces/vst/ivstcomponent.h>
#include <pluginterfaces/vst/ivsteditcontroller.h>
#include <pluginterfaces/vst/ivstmessage.h>
#include <public.sdk/source/common/memorystream.h>
#include <public.sdk/source/vst/hosting/hostclasses.h>
#include <public.sdk/source/vst/hosting/parameterchanges.h>

#include <cmath>
#include <cstdio>
#include <filesystem>
#include <memory>
#include <string>
#include <vector>

using namespace Steinberg;

namespace
{
    constexpr Vst::ParamID gain = 3165055;
    constexpr int frames = 256;
    int failures = 0;

    void check(bool condition, const std::string& what)
    {
        if (! condition)
        {
            std::fprintf(stderr, "FAILED: %s\n", what.c_str());
            ++failures;
        }
    }

    struct Module
    {
        void* handle = nullptr;
        IPluginFactory* factory = nullptr;
    };

    Module load(const std::filesystem::path& bundle)
    {
        const auto name = bundle.stem().string();
        const auto binary = bundle / "Contents" / "x86_64-linux" / (name + ".so");
        Module out;
        out.handle = dlopen(binary.c_str(), RTLD_NOW | RTLD_LOCAL);
        check(out.handle != nullptr, "dlopen " + binary.string() + ": " + (dlerror() ?: ""));
        if (out.handle == nullptr)
            return out;
        using Entry = bool (*)(void*);
        using GetFactory = IPluginFactory* (*)();
        auto* entry = reinterpret_cast<Entry>(dlsym(out.handle, "ModuleEntry"));
        auto* getFactory = reinterpret_cast<GetFactory>(dlsym(out.handle, "GetPluginFactory"));
        check(entry != nullptr && getFactory != nullptr, "the entry points of " + binary.string());
        // Nothing else of a plugin is visible to the process.
        check(dlsym(out.handle, "soundor_vst3_plugin") == nullptr, "soundor_vst3_plugin is hidden");
        check(dlsym(out.handle, "soundor_processor_create") == nullptr, "soundor_processor_create is hidden");
        if (entry != nullptr && entry(out.handle) && getFactory != nullptr)
            out.factory = getFactory();
        return out;
    }

    struct Instance
    {
        IPtr<Vst::IComponent> component;
        IPtr<Vst::IAudioProcessor> processor;
        IPtr<Vst::IEditController> controller;
        IPtr<Vst::IConnectionPoint> componentPoint, controllerPoint;
        std::string name;
    };

    Instance create(IPluginFactory& factory, FUnknown* host, const std::string& name)
    {
        Instance out;
        out.name = name;
        PClassInfo info {};
        for (int32 i = 0; i < factory.countClasses(); ++i)
            if (factory.getClassInfo(i, &info) == kResultOk && std::string(info.category) == kVstAudioEffectClass)
                break;
        Vst::IComponent* component = nullptr;
        check(factory.createInstance(info.cid, Vst::IComponent::iid, reinterpret_cast<void**>(&component)) == kResultOk,
              name + ": create the component");
        if (component == nullptr)
            return out;
        out.component = owned(component);
        check(component->initialize(host) == kResultOk, name + ": initialize the component");
        out.processor = FUnknownPtr<Vst::IAudioProcessor>(out.component);
        if (const FUnknownPtr<Vst::IProcessContextRequirements> requirements(out.processor); requirements)
        {
            using Context = Vst::IProcessContextRequirements;
            constexpr auto flags = Context::kNeedTransportState | Context::kNeedTempo | Context::kNeedTimeSignature
                                   | Context::kNeedProjectTimeMusic | Context::kNeedBarPositionMusic
                                   | Context::kNeedCycleMusic | Context::kNeedFrameRate;
            check((requirements->getProcessContextRequirements() & flags) == flags,
                  name + ": requests transport fields");
        }
        else
            check(false, name + ": exposes process context requirements");
        TUID controllerId {};
        check(component->getControllerClassId(controllerId) == kResultOk, name + ": its controller's class");
        Vst::IEditController* controller = nullptr;
        check(factory.createInstance(controllerId, Vst::IEditController::iid, reinterpret_cast<void**>(&controller))
                  == kResultOk,
              name + ": create the controller");
        if (controller == nullptr)
            return out;
        out.controller = owned(controller);
        check(controller->initialize(host) == kResultOk, name + ": initialize the controller");
        if (const FUnknownPtr<Vst::ChannelContext::IInfoListener> listener(out.controller); listener)
        {
            const auto attributes = Vst::HostAttributeList::make();
            attributes->setString(Vst::ChannelContext::kChannelNameKey, u"Lead track");
            check(listener->setChannelContextInfos(attributes) == kResultOk, name + ": accepts track metadata");
        }
        else
            check(false, name + ": exposes a channel context listener");
        out.componentPoint = FUnknownPtr<Vst::IConnectionPoint>(out.component);
        out.controllerPoint = FUnknownPtr<Vst::IConnectionPoint>(out.controller);
        if (out.componentPoint && out.controllerPoint)
        {
            out.componentPoint->connect(out.controllerPoint);
            out.controllerPoint->connect(out.componentPoint);
        }
        // The controller learns the component's state, as a host does.
        MemoryStream state;
        check(component->getState(&state) == kResultOk, name + ": the component's state");
        state.seek(0, IBStream::kIBSeekSet, nullptr);
        check(controller->setComponentState(&state) == kResultOk, name + ": the controller reads it");
        Vst::ProcessSetup setup { Vst::kRealtime, Vst::kSample32, frames, 48000 };
        check(out.processor->setupProcessing(setup) == kResultOk, name + ": set up processing");
        check(component->setActive(true) == kResultOk, name + ": activate");
        out.processor->setProcessing(true);
        return out;
    }

    float process(Instance& instance, double normalizedGain)
    {
        std::vector<float> left(frames, 0.5f), right(frames, 0.5f), outLeft(frames), outRight(frames);
        float* inputs[] = { left.data(), right.data() };
        float* outputs[] = { outLeft.data(), outRight.data() };
        Vst::AudioBusBuffers in {};
        in.numChannels = 2;
        in.channelBuffers32 = inputs;
        Vst::AudioBusBuffers out {};
        out.numChannels = 2;
        out.channelBuffers32 = outputs;
        Vst::ParameterChanges changes;
        int32 index = 0;
        if (auto* queue = changes.addParameterData(gain, index))
            queue->addPoint(0, normalizedGain, index);
        Vst::ProcessData data {};
        data.processMode = Vst::kRealtime;
        data.symbolicSampleSize = Vst::kSample32;
        data.numSamples = frames;
        data.numInputs = 1;
        data.numOutputs = 1;
        data.inputs = &in;
        data.outputs = &out;
        data.inputParameterChanges = &changes;
        check(instance.processor->process(data) == kResultOk, instance.name + ": process");
        return outRight[frames - 1];
    }

    void destroy(Instance& instance)
    {
        if (! instance.component)
            return;
        instance.processor->setProcessing(false);
        instance.component->setActive(false);
        if (instance.componentPoint && instance.controllerPoint)
        {
            instance.componentPoint->disconnect(instance.controllerPoint);
            instance.controllerPoint->disconnect(instance.componentPoint);
        }
        if (instance.controller)
            instance.controller->terminate();
        instance.component->terminate();
        instance = {};
    }
} // namespace

int main(int argc, char** argv)
{
    if (argc < 2)
    {
        std::fprintf(stderr, "usage: soundor_vst3_instances <bundle.vst3>...\n");
        return 2;
    }
    auto host = owned(new Vst::HostApplication());
    std::vector<Module> modules;
    std::vector<Instance> instances;
    for (int i = 1; i < argc; ++i)
    {
        modules.push_back(load(argv[i]));
        if (modules.back().factory == nullptr)
            continue;
        for (int copy = 0; copy < 2; ++copy)
            instances.push_back(
                create(*modules.back().factory, host, std::string(argv[i]) + " #" + std::to_string(copy)));
    }
    // Every instance its own gain (normalized; the plugin's range is 0 to 2).
    for (int round = 0; round < 3; ++round)
        for (std::size_t i = 0; i < instances.size(); ++i)
        {
            const double normalized = 0.1 + 0.1 * static_cast<double>(i);
            const float heard = process(instances[i], normalized);
            check(std::fabs(heard - static_cast<float>(0.5 * 2 * normalized)) < 1e-4f,
                  instances[i].name + ": its own gain (" + std::to_string(heard) + ")");
        }
    // Torn down out of order: every other one first.
    for (std::size_t i = 0; i < instances.size(); i += 2)
        destroy(instances[i]);
    for (auto& instance : instances)
        destroy(instance);
    for (auto& module : modules)
    {
        if (module.factory != nullptr)
            module.factory->release();
        if (module.handle != nullptr)
        {
            if (auto* exit = reinterpret_cast<bool (*)()>(dlsym(module.handle, "ModuleExit")))
                exit();
            dlclose(module.handle);
        }
    }
    std::printf("%zu instances of %zu modules: %s\n", instances.size(), modules.size(),
                failures == 0 ? "ok" : "FAILED");
    return failures == 0 ? 0 : 1;
}
