#pragma once

#include <soundor/Config.h>

#import <Foundation/Foundation.h>
#include <objc/runtime.h>

#include <span>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform::apple
{
    struct Method
    {
        SEL selector;
        IMP implementation;
        const char* encoding;
    };

    // Process-wide registration with 128 random bits, compiled into the hidden
    // engine archive. Call from a function-local static for one class per binary.
    // Never disposed or module-pinned; physical image unloading remains unsafe.
    [[nodiscard]] Class makeRuntimeClass(std::string_view prefix, Class base, std::span<const Method> methods,
                                         Protocol* protocol = nil);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform::apple
