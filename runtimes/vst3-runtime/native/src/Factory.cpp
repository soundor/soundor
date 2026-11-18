// The module's entry point: the factory of the plugin's two classes, the
// component (Processor) and its controller, described from the plugin's
// descriptor. ModuleEntry and ModuleExit are the SDK's (linuxmain.cpp,
// moduleinit.cpp); with this, they are the only symbols a plugin exports.

#include "Controller.h"
#include "Descriptor.h"
#include "Processor.h"

#include <pluginterfaces/vst/ivstaudioprocessor.h>
#include <pluginterfaces/vst/ivsteditcontroller.h>
#include <pluginterfaces/vst/vsttypes.h>
#include <public.sdk/source/main/pluginfactory.h>

using namespace Steinberg;

extern "C" SMTG_EXPORT_SYMBOL IPluginFactory* PLUGIN_API GetPluginFactory()
{
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
                                kVstAudioEffectClass, plugin->name.c_str(), Vst::kDistributable,
                                plugin->subcategories.c_str(), plugin->vendor.c_str(), plugin->version.c_str(),
                                kVstVersionString);
    gPluginFactory->registerClass(&processor, soundor::vst3::Processor::create);
    const PClassInfo2 controller(reinterpret_cast<const char*>(plugin->controllerCid.data()),
                                 PClassInfo::kManyInstances, kVstComponentControllerClass,
                                 (plugin->name + " Controller").c_str(), 0, "", plugin->vendor.c_str(),
                                 plugin->version.c_str(), kVstVersionString);
    gPluginFactory->registerClass(&controller, soundor::vst3::Controller::create);
    return gPluginFactory;
}
