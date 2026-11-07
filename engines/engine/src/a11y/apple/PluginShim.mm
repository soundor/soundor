// Compiled in the final plugin, separately for every binary/format.
#include "a11y/apple/AppleShared.h"

#include <objc/runtime.h>

#include <cstdio>
#include <cstdlib>
#define SOUNDOR_STRINGIFY_(x) #x
#define SOUNDOR_STRINGIFY(x) SOUNDOR_STRINGIFY_(x)
namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail::apple
{
    Class makeElementClass(Class base, const std::vector<std::pair<SEL, IMP>>& methods)
    {
        // From here on the runtime holds methods in this binary.
        pinModule();
        std::string name;
        do
        {
            std::uint64_t random[2] {};
            arc4random_buf(random, sizeof random);
            char suffix[40];
            std::snprintf(suffix, sizeof suffix, "%016llx%016llx", static_cast<unsigned long long>(random[0]),
                          static_cast<unsigned long long>(random[1]));
            name = std::string("SoundorAXElement_") + SOUNDOR_STRINGIFY(SOUNDOR_ABI_NAMESPACE) + "_"
                   + SOUNDOR_PLUGIN_BINARY_ID + "_" + suffix;
        } while (objc_getClass(name.c_str()) != nil);
        Class created = objc_allocateClassPair(base, name.c_str(), 0);
        for (const auto& [selector, implementation] : methods)
            class_addMethod(created, selector, implementation,
                            method_getTypeEncoding(class_getInstanceMethod(base, selector)));
        objc_registerClassPair(created);
        return created;
    }

} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail::apple
