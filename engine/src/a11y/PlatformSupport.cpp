#include "a11y/PlatformSupport.h"

#if defined(_WIN32)
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #ifndef WIN32_LEAN_AND_MEAN
        #define WIN32_LEAN_AND_MEAN
    #endif
    #include <windows.h>
#else
    #include <dlfcn.h>
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    void pinModule()
    {
        static std::once_flag pinned;
        std::call_once(pinned,
                       []
                       {
                           // Any address in this binary names it.
                           static const char anchor = 0;
#if defined(_WIN32)
                           HMODULE module = nullptr;
                           GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                                              reinterpret_cast<LPCWSTR>(&anchor), &module);
#else
                           Dl_info info {};
                           if (dladdr(&anchor, &info) != 0 && info.dli_fname != nullptr)
                               dlopen(info.dli_fname, RTLD_NOW | RTLD_NOLOAD | RTLD_NODELETE);
#endif
                       });
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
