#include "platform/apple/RuntimeClass.h"

#include <array>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <stdexcept>
#include <string>

#define SOUNDOR_STRINGIFY_(x) #x
#define SOUNDOR_STRINGIFY(x) SOUNDOR_STRINGIFY_(x)

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform::apple
{
    Class makeRuntimeClass(std::string_view prefix, Class base, std::span<const Method> methods, Protocol* protocol)
    {
        std::string name;
        do
        {
            std::array<std::uint64_t, 2> random {};
            arc4random_buf(random.data(), sizeof random);
            std::array<char, 33> suffix {};
            std::snprintf(suffix.data(), suffix.size(), "%016llx%016llx", static_cast<unsigned long long>(random[0]),
                          static_cast<unsigned long long>(random[1]));
            name = std::string(prefix) + "_" SOUNDOR_STRINGIFY(SOUNDOR_ABI_NAMESPACE) "_" + suffix.data();
        } while (objc_getClass(name.c_str()) != nil);
        Class created = objc_allocateClassPair(base, name.c_str(), 0);
        if (created == Nil)
            throw std::runtime_error("Could not allocate Soundor Objective-C class");
        for (const Method& method : methods)
            if (method.encoding == nullptr
                || ! class_addMethod(created, method.selector, method.implementation, method.encoding))
                throw std::runtime_error("Could not add Soundor Objective-C method");
        if (protocol != nil && ! class_addProtocol(created, protocol))
            throw std::runtime_error("Could not add Soundor Objective-C protocol");
        objc_registerClassPair(created);
        return created;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform::apple
