// Cryptographically secure random bytes from the operating system, for
// crypto.getRandomValues() and crypto.randomUUID().

#include "web/Functions.h"

#include <cstdint>

#if defined(_WIN32)
    #define WIN32_LEAN_AND_MEAN
    #include <windows.h>
    // windows.h first
    #include <bcrypt.h>
#elif defined(__APPLE__)
    #include <stdlib.h>
#else
    #include <sys/random.h>

    #include <cerrno>
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    namespace
    {
        bool fillRandom(std::uint8_t* data, std::size_t size)
        {
#if defined(_WIN32)
            return BCryptGenRandom(nullptr, data, static_cast<ULONG>(size), BCRYPT_USE_SYSTEM_PREFERRED_RNG) == 0;
#elif defined(__APPLE__)
            arc4random_buf(data, size);
            return true;
#else
            while (size > 0)
            {
                const ssize_t got = getrandom(data, size, 0);
                if (got < 0)
                {
                    if (errno == EINTR)
                        continue;
                    return false;
                }
                data += got;
                size -= static_cast<std::size_t>(got);
            }
            return true;
#endif
        }

        // fillRandom(Uint8Array): fills the view in place.
        jsi::Value fillRandomValues(js::bind::ContextState& context, const jsi::Value&, const jsi::Value* args,
                                    std::size_t count)
        {
            facebook::hermes::soundor::BufferView view;
            if (count < 1 || ! js::bind::bufferView(context, args[0], view)
                || view.kind != facebook::hermes::soundor::TypedArrayKind::Uint8)
                js::bind::throwTypeError(context, "fillRandom() expects a Uint8Array");
            if (view.detached)
                js::bind::throwTypeError(context, "ArrayBuffer is detached");
            if (view.byteLength > 0 && ! fillRandom(view.data, view.byteLength))
                js::bind::throwInternalError(context, "the system random number generator failed");
            return jsi::Value::undefined();
        }
    } // namespace

    std::vector<NativeFunction> randomFunctions()
    {
        return { { "fillRandom", fillRandomValues, 1 } };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
