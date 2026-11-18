// The unit tests describe their plugin by parseDescriptor(); the module's
// plugin() asks this, which describes none.
#include <soundor/vst3/PluginAbi.h>

extern "C" std::int32_t soundor_vst3_plugin(SoundorVst3Plugin*) { return 1; }
