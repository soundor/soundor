// The module's entry point: the factory of the plugin's two classes, the
// component (Processor) and its controller, described from the plugin's
// descriptor. The component is not distributable: it and its controller
// share memory when they share a process (Link.h), so hosts are not invited
// to run them apart. The other entry points are the SDK's (linuxmain.cpp,
// macmain.cpp or dllmain.cpp, and moduleinit.cpp); with this, they are the
// only symbols a plugin exports.

#include "Controller.h"
#include "Descriptor.h"
#include "Processor.h"

#include <soundor/platform/ModuleResources.h>

#include <pluginterfaces/gui/iplugview.h>
#include <pluginterfaces/vst/ivstaudioprocessor.h>
#include <pluginterfaces/vst/ivsteditcontroller.h>
#include <pluginterfaces/vst/vsttypes.h>
#include <public.sdk/source/main/moduleinit.h>
#include <public.sdk/source/main/pluginfactory.h>

using namespace Steinberg;

#if ! SMTG_OS_LINUX
// The editor and the controller implement Linux's run loop interfaces on
// every platform (they are only queried for on Linux), whose ids the SDK
// defines on Linux alone (coreiids.cpp).
namespace Steinberg
{
    DEF_CLASS_IID(Linux::IEventHandler)
    DEF_CLASS_IID(Linux::ITimerHandler)
    DEF_CLASS_IID(Linux::IRunLoop)
} // namespace Steinberg
#endif

extern "C" SMTG_EXPORT_SYMBOL IPluginFactory* PLUGIN_API GetPluginFactory()
{
    // What the engine keeps between editors (the GPU device, its threads)
    // ends before the module is unloaded: DeinitModule, which ModuleExit,
    // ExitDll and bundleExit call. Not a static destructor, which on Windows
    // would wait for those threads under the loader lock. Registered here,
    // before anything can open an editor, rather than as the module loads.
    static const ModuleTerminator releaseEngine([] { soundor::platform::releaseModuleResources(); });
    if (gPluginFactory != nullptr)
    {
        gPluginFactory->addRef();
        return gPluginFactory;
    }
    const auto* plugin = soundor::vst3::plugin();
    if (plugin == nullptr)
        return nullptr;
    const PFactoryInfo info(plugin->vendor.c_str(), plugin->url.c_str(), plugin->email.c_str(),
                            Vst::kDefaultFactoryFlags);
    gPluginFactory = new CPluginFactory(info);
    const PClassInfo2 processor(reinterpret_cast<const char*>(plugin->processorCid.data()), PClassInfo::kManyInstances,
                                kVstAudioEffectClass, plugin->name.c_str(), 0, plugin->subcategories.c_str(),
                                plugin->vendor.c_str(), plugin->version.c_str(), kVstVersionString);
    gPluginFactory->registerClass(&processor, soundor::vst3::Processor::create);
    const PClassInfo2 controller(reinterpret_cast<const char*>(plugin->controllerCid.data()),
                                 PClassInfo::kManyInstances, kVstComponentControllerClass,
                                 (plugin->name + " Controller").c_str(), 0, "", plugin->vendor.c_str(),
                                 plugin->version.c_str(), kVstVersionString);
    gPluginFactory->registerClass(&controller, soundor::vst3::Controller::create);
    return gPluginFactory;
}
