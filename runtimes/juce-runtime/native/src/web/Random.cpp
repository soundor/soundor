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
        JSValue fillRandomValues(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 1 || JS_GetTypedArrayType(argv[0]) != JS_TYPED_ARRAY_UINT8)
                return JS_ThrowTypeError(ctx, "fillRandom() expects a Uint8Array");
            std::size_t offset = 0;
            std::size_t length = 0;
            JSValue buffer = JS_GetTypedArrayBuffer(ctx, argv[0], &offset, &length, nullptr);
            if (JS_IsException(buffer))
                return JS_EXCEPTION;
            std::size_t bufferSize = 0;
            std::uint8_t* bytes = JS_GetArrayBuffer(ctx, &bufferSize, buffer);
            JS_FreeValue(ctx, buffer);
            if (bytes == nullptr && JS_HasException(ctx))
                return JS_EXCEPTION;
            if (length > 0 && ! fillRandom(bytes + offset, length))
                return JS_ThrowInternalError(ctx, "the system random number generator failed");
            return JS_UNDEFINED;
        }
    } // namespace

    std::vector<NativeFunction> randomFunctions()
    {
        return { { "fillRandom", fillRandomValues, 1 } };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
