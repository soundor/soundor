#include "a11y/apple/AppleShared.h"

#include <objc/runtime.h>

#include <cstdio>
#include <cstdlib>

#if ! __has_feature(objc_arc)
    #error "AppleShared.mm is built with ARC (-fobjc-arc)"
#endif

#define SOUNDOR_STRINGIFY_(x) #x
#define SOUNDOR_STRINGIFY(x) SOUNDOR_STRINGIFY_(x)

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail::apple
{
    namespace
    {
        // Associated-object keys: an element's bridge token, node id and the
        // actions it offers.
        const char tokenKey = 0;
        const char nodeKey = 0;
        const char offersKey = 0;

        std::uint64_t number(id object, const void* key)
        {
            id value = objc_getAssociatedObject(object, key);
            return [value isKindOfClass:[NSNumber class]] ? [static_cast<NSNumber*>(value) unsignedLongLongValue] : 0;
        }
    } // namespace

    std::uint32_t bit(Action action) noexcept
    {
        return std::uint32_t { 1 } << static_cast<unsigned>(action);
    }

    std::uint32_t offers(const Node& node) noexcept
    {
        std::uint32_t bits = 0;
        for (const ActionDescriptor& action : node.actions)
            bits |= bit(action.action);
        return bits;
    }

    void tag(id element, std::uintptr_t token, const Node& node)
    {
        objc_setAssociatedObject(element, &tokenKey, @(static_cast<unsigned long long>(token)),
                                 OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        objc_setAssociatedObject(element, &nodeKey, @(static_cast<unsigned long long>(node.id)),
                                 OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        objc_setAssociatedObject(element, &offersKey, @(offers(node)), OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }

    bool offered(id element, Action action)
    {
        return (number(element, &offersKey) & bit(action)) != 0;
    }

    bool ask(std::uintptr_t token, ActionRequest request)
    {
        const auto channel = Channels::instance().find(token);
        if (channel == nullptr)
            return false;
        const std::scoped_lock lock(channel->mutex);
        channel->requests.push_back(std::move(request));
        return true;
    }

    bool ask(id element, Action action, std::string name, std::variant<std::monostate, double, std::string> value)
    {
        if (action != Action::Custom && ! offered(element, action))
            return false;
        return ask(static_cast<std::uintptr_t>(number(element, &tokenKey)),
                   { number(element, &nodeKey), action, std::move(name), std::move(value) });
    }

    std::vector<ActionRequest> take(Channel& channel)
    {
        std::vector<ActionRequest> requests;
        const std::scoped_lock lock(channel.mutex);
        requests.swap(channel.requests);
        return requests;
    }

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
            name = std::string("SoundorAXElement_") + SOUNDOR_STRINGIFY(SOUNDOR_ABI_NAMESPACE) + "_" + suffix;
        } while (objc_getClass(name.c_str()) != nil);
        Class created = objc_allocateClassPair(base, name.c_str(), 0);
        for (const auto& [selector, implementation] : methods)
            class_addMethod(created, selector, implementation,
                            method_getTypeEncoding(class_getInstanceMethod(base, selector)));
        objc_registerClassPair(created);
        return created;
    }

    NSString* string(const std::string& text)
    {
        return [NSString stringWithUTF8String:text.c_str()];
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail::apple
