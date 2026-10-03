// Temporary: features not implemented yet.
#include "web/Functions.h"

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    std::vector<NativeFunction> httpFunctions() { return {}; }
    std::vector<NativeFunction> fileFunctions() { return {}; }
    std::vector<NativeFunction> hostFunctions() { return {}; }
    std::span<const PublicModule> publicModules() { return {}; }
    void dispatchHostChanges(JSContext*, State&) {}
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
