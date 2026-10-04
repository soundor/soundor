// Loads two Soundor "plugins", each with its own copy of the runtime under its
// own ABI namespace, into one process, the way a host loads two plugins, and
// checks that they run side by side without interfering: several instances
// of each, interleaved, destroyed in any order, and the libraries unloaded
// and loaded again.
//
//   soundor_coexistence_host <plugin A> <plugin B>

#include <cstdint>
#include <cstdio>
#include <string>

#if defined(_WIN32)
    #include <windows.h>
#else
    #include <dlfcn.h>
#endif

namespace
{
    struct Plugin
    {
        explicit Plugin(const char* path)
        {
#if defined(_WIN32)
            library = LoadLibraryA(path);
#else
            library = dlopen(path, RTLD_NOW | RTLD_LOCAL);
#endif
            if (library == nullptr)
                return;
            create = reinterpret_cast<void* (*)()>(symbol("soundor_coexist_create"));
            click = reinterpret_cast<int (*)(void*)>(symbol("soundor_coexist_click"));
            pixel = reinterpret_cast<std::uint32_t (*)(void*)>(symbol("soundor_coexist_pixel"));
            destroy = reinterpret_cast<void (*)(void*)>(symbol("soundor_coexist_destroy"));
        }

        ~Plugin()
        {
            if (library == nullptr)
                return;
#if defined(_WIN32)
            FreeLibrary(static_cast<HMODULE>(library));
#else
            dlclose(library);
#endif
        }

        Plugin(const Plugin&) = delete;
        Plugin& operator=(const Plugin&) = delete;

        [[nodiscard]] bool loaded() const { return create && click && pixel && destroy; }

        void* symbol(const char* name) const
        {
#if defined(_WIN32)
            return reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(library), name));
#else
            return dlsym(library, name);
#endif
        }

        void* library = nullptr;
        void* (*create)() = nullptr;
        int (*click)(void*) = nullptr;
        std::uint32_t (*pixel)(void*) = nullptr;
        void (*destroy)(void*) = nullptr;
    };

    int failures = 0;

    void expect(bool condition, const std::string& what)
    {
        if (! condition)
        {
            std::fprintf(stderr, "FAILED: %s\n", what.c_str());
            ++failures;
        }
    }

    constexpr std::uint32_t red = 0xFFFF0000;
    constexpr std::uint32_t blue = 0xFF0000FF;

    void run(const char* pathA, const char* pathB, int round)
    {
        const std::string at = " (round " + std::to_string(round) + ")";
        Plugin a(pathA);
        Plugin b(pathB);
        expect(a.loaded() && b.loaded(), "both plugins load" + at);
        if (! a.loaded() || ! b.loaded())
            return;

        void* a1 = a.create();
        void* b1 = b.create();
        void* a2 = a.create();
        expect(a1 && b1 && a2, "instances start" + at);
        if (! a1 || ! b1 || ! a2)
            return;

        expect(a.pixel(a1) == red && b.pixel(b1) == blue && a.pixel(a2) == red, "each plugin draws its own UI" + at);
        a.click(a1);
        b.click(b1);
        a.click(a2);
        expect(a.click(a1) == 2, "A1 counted its own clicks" + at);
        expect(b.click(b1) == 2, "B1 counted its own clicks" + at);
        expect(a.click(a2) == 2, "A2 counted its own clicks" + at);

        a.destroy(a1);
        void* b2 = b.create();
        expect(b2 != nullptr && b.click(b2) == 1, "a new B instance starts fresh" + at);
        expect(a.click(a2) == 3 && a.pixel(a2) == red, "A2 outlives A1" + at);
        expect(b.pixel(b1) == blue && b.pixel(b2) == blue, "B instances still draw" + at);
        b.destroy(b1);
        a.destroy(a2);
        b.destroy(b2);
    }
} // namespace

int main(int argc, char** argv)
{
    if (argc != 3)
    {
        std::fprintf(stderr, "usage: %s <plugin A> <plugin B>\n", argv[0]);
        return 2;
    }
    // A host rescanning plugins loads, unloads and loads them again.
    for (int round = 1; round <= 2; ++round)
        run(argv[1], argv[2], round);
    if (failures == 0)
        std::printf("Two Soundor plugins coexist in one process.\n");
    return failures == 0 ? 0 : 1;
}
