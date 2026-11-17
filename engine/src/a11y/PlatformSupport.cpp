#include "a11y/PlatformSupport.h"

#if defined(_WIN32)
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #ifndef WIN32_LEAN_AND_MEAN
        #define WIN32_LEAN_AND_MEAN
    #endif
    #include <windows.h>

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
                           HMODULE module = nullptr;
                           GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_PIN,
                                              reinterpret_cast<LPCWSTR>(&anchor), &module);
                       });
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail

#endif
