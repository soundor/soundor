#include "NativeModule.h"

#include "Internal.h"

#include <cassert>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace detail
    {
        void NativeModuleRegistry::add(std::string name, NativeModule module)
        {
            modules.insert_or_assign(std::move(name), std::move(module));
        }

        const NativeModule* NativeModuleRegistry::find(std::string_view name) const
        {
            const auto it = modules.find(name);
            return it != modules.end() ? &it->second : nullptr;
        }
    } // namespace detail

    void registerNativeModule(Context& context, std::string name, detail::NativeModule module)
    {
        assert(detail::isNativeModuleSpecifier(name));
        auto& state = stateOf(context);
        state.runtime->assertOwnerThread();
        state.nativeModules.add(std::move(name), std::move(module));
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
