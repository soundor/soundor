// A host process for two Soundor plugin binaries with the macOS accessibility
// bridge (Module.mm, built twice under different ABI namespaces), checking
// what a plugin host needs: both load, their element classes do not collide,
// their trees are independent, destroying one leaves the other working, and
// an element VoiceOver still holds after its plugin is destroyed and
// "unloaded" is safe to message.

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
    @autoreleasepool
    {
        Module a = load(argv[1]);
        Module b = load(argv[2]);
        if (a.create == nullptr || b.create == nullptr)
            return 1;

        void* first = a.create();
        void* second = b.create();
        expect(first != nullptr && second != nullptr, "both plugins create their bridges");
        if (first == nullptr || second == nullptr)
            return 1;

        const std::string classA = a.className(first);
        const std::string classB = b.className(second);
        std::printf("classes: %s, %s\n", classA.c_str(), classB.c_str());
        expect(classA != classB, "the element classes differ");
        expect(classA.rfind("SoundorAXElement_", 0) == 0 && classB.rfind("SoundorAXElement_", 0) == 0,
               "both are Soundor's runtime classes");
        expect(classA.find("_v0_") != std::string::npos && classB.find("_p_apple_") != std::string::npos,
               "each carries its plugin's ABI namespace");

        // Two instances of one plugin share its class, with their own trees.
        void* third = a.create();
        expect(third != nullptr && classA == a.className(third), "a second instance shares its plugin's class");

        expect(a.press(first) == 1, "plugin A is pressed through its bridge");
        expect(b.press(second) == 1, "plugin B is pressed through its own");
        expect(a.press(third) == 1, "A's second instance has its own tree");
        expect(a.press(first) == 2, "A's first instance is unaffected");

        // VoiceOver keeps an element; the plugin is destroyed and unloaded.
        id kept = (__bridge_transfer id)a.retain(first);
        a.destroy(first);
        a.destroy(third);
        dlclose(a.library);
        // The binary is pinned: the element's methods are still there...
        void* still = dlopen(argv[1], RTLD_NOW | RTLD_NOLOAD);
        expect(still != nullptr, "a plugin whose bridge ran stays loaded");
        if (still != nullptr)
            dlclose(still);
        // ...and refuse to act for a bridge that has gone.
        const BOOL pressed =
            reinterpret_cast<BOOL (*)(id, SEL)>(objc_msgSend)(kept, @selector(accessibilityPerformPress));
        expect(pressed == NO, "an element of a destroyed bridge refuses to act");
        kept = nil;

        expect(b.press(second) == 2, "plugin B still works after A is gone");

        // Loading A again (a host reopening the plugin) works as before.
        Module again = load(argv[1]);
        void* fourth = again.create != nullptr ? again.create() : nullptr;
        expect(fourth != nullptr && again.press(fourth) == 1, "plugin A loads and works again");
        if (fourth != nullptr)
            again.destroy(fourth);

        b.destroy(second);
        dlclose(b.library);
    }
    if (failures == 0)
        std::printf("Apple coexistence: ok\n");
    return failures == 0 ? 0 : 1;
}
