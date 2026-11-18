// Two independent images link the same engine archive. These checks detect
// observed coexistence and dlclose/reload failures; they cannot establish
// safe physical unloading of registered Objective-C method implementations.

#import <AppKit/AppKit.h>
#include <dlfcn.h>
#include <objc/message.h>

#include <cstdio>
#include <string>

namespace
{
    struct Module
    {
        void* library = nullptr;
        void* (*create)() = nullptr;
        const char* (*className)(void*) = nullptr;
        int (*press)(void*) = nullptr;
        void* (*retain)(void*) = nullptr;
        void (*destroy)(void*) = nullptr;
    };

    int failures = 0;

    void expect(bool condition, const char* what)
    {
        if (! condition)
        {
            std::fprintf(stderr, "FAILED: %s\n", what);
            ++failures;
        }
    }

    template <typename T>
    T symbol(void* library, const char* name)
    {
        return reinterpret_cast<T>(dlsym(library, name));
    }

    Module load(const char* path)
    {
        Module module;
        module.library = dlopen(path, RTLD_NOW | RTLD_LOCAL);
        if (module.library == nullptr)
        {
            std::fprintf(stderr, "cannot load %s: %s\n", path, dlerror());
            return module;
        }
        module.create = symbol<void* (*)()>(module.library, "soundor_apple_create");
        module.className = symbol<const char* (*)(void*)>(module.library, "soundor_apple_class");
        module.press = symbol<int (*)(void*)>(module.library, "soundor_apple_press");
        module.retain = symbol<void* (*)(void*)>(module.library, "soundor_apple_retain_element");
        module.destroy = symbol<void (*)(void*)>(module.library, "soundor_apple_destroy");
        return module;
    }
} // namespace

int main(int argc, char** argv)
{
    if (argc != 3)
    {
        std::fprintf(stderr, "usage: %s <module a> <module b>\n", argv[0]);
        return 2;
    }
    Module a = load(argv[1]);
    Module b = load(argv[2]);
    @autoreleasepool
    {
        if (a.create == nullptr || b.create == nullptr)
            return 1;

        void* second = b.create();
        @autoreleasepool
        {
            void* first = a.create();
            expect(first != nullptr && second != nullptr, "both plugins create their bridges");
            if (first == nullptr || second == nullptr)
                return 1;

            const std::string classA = a.className(first);
            const std::string classB = b.className(second);
            std::printf("classes: %s, %s\n", classA.c_str(), classB.c_str());
            expect(classA != classB, "the element classes differ");
            expect(classA.rfind("SoundorAXElement_", 0) == 0 && classB.rfind("SoundorAXElement_", 0) == 0,
                   "both are Soundor's runtime classes");
            expect(classA.find("_" SOUNDOR_EXPECTED_ABI "_") != std::string::npos
                       && classB.find("_" SOUNDOR_EXPECTED_ABI "_") != std::string::npos,
                   "each carries the same engine ABI");

            // Two instances of one plugin share its class, with their own trees.
            void* third = a.create();
            expect(third != nullptr && classA == a.className(third), "a second instance shares its plugin's class");

            expect(a.press(first) == 1, "plugin A is pressed through its bridge");
            expect(b.press(second) == 1, "plugin B is pressed through its own");
            expect(a.press(third) == 1, "A's second instance has its own tree");
            expect(a.press(first) == 2, "A's first instance is unaffected");

            // Test retained elements while their implementation image is loaded.
            // Messaging one after physical unloading is an acknowledged safety risk.
            id kept = (__bridge_transfer id)a.retain(first);
            a.destroy(first);
            a.destroy(third);
            void* reopened = a.create();
            expect(reopened != nullptr && classA == a.className(reopened), "reopening uses the binary's class");
            if (reopened != nullptr)
            {
                expect(a.press(reopened) == 1, "reopened editor routes to fresh runtime state");
                a.destroy(reopened);
            }
            const BOOL pressed =
                reinterpret_cast<BOOL (*)(id, SEL)>(objc_msgSend)(kept, @selector(accessibilityPerformPress));
            expect(pressed == NO, "an element of a destroyed bridge refuses to act");
            expect([kept accessibilityParent] == nil, "retained element has no stale parent");
            kept = nil;
            // Drain autoreleased elements before giving the loader our reference.
        }
        expect(dlclose(a.library) == 0, "the host closes A's module handle");
        void* resident = dlopen(argv[1], RTLD_NOW | RTLD_NOLOAD);
        std::printf("After dlclose, A is %s; this is not proof of safe unloading.\n",
                    resident != nullptr ? "still resident" : "not found by RTLD_NOLOAD");
        if (resident != nullptr)
            dlclose(resident);

        expect(b.press(second) == 2, "plugin B still works after A is gone");

        // Loading A again (a host reopening the plugin) works as before.
        Module again = load(argv[1]);
        @autoreleasepool
        {
            void* fourth = again.create != nullptr ? again.create() : nullptr;
            expect(fourth != nullptr && again.press(fourth) == 1, "plugin A loads and works again");
            if (fourth != nullptr)
                again.destroy(fourth);
        }
        expect(dlclose(again.library) == 0, "the host closes the reloaded module handle");

        b.destroy(second);
    }
    expect(dlclose(b.library) == 0, "the host closes B after draining autoreleased objects");
    if (failures == 0)
        std::printf("Apple coexistence: ok\n");
    return failures == 0 ? 0 : 1;
}
