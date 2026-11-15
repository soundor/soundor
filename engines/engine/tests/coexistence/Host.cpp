// Loads two Soundor "plugins", each with its own copy of the runtime under its
// shared engine ABI namespace, into one process, the way a host loads two plugins, and
// checks that they run side by side without interfering: several instances
// of each, interleaved, destroyed in any order, and the libraries unloaded
// and loaded again.
//
//   soundor_coexistence_host <plugin A> <plugin B>

#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <string>

#if defined(_WIN32)
    #define NOMINMAX
    #define WIN32_LEAN_AND_MEAN
    // UIA's SDK headers require Windows and COM declarations before inclusion.
    // clang-format off
    #include <windows.h>
    #include <ole2.h>
    #include <UIAutomation.h>
    // clang-format on
    #include <wrl/client.h>
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
    #if SOUNDOR_COEXIST_KEEP_LOADED
            // Under LeakSanitizer: the libraries' process-lifetime singletons
            // (Skia keeps some) would look leaked once unmapped.
            library = dlopen(path, RTLD_NOW | RTLD_LOCAL | RTLD_NODELETE);
    #else
            library = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    #endif
#endif
            if (library == nullptr)
                return;
            create = reinterpret_cast<void* (*)()>(symbol("soundor_coexist_create"));
            click = reinterpret_cast<int (*)(void*)>(symbol("soundor_coexist_click"));
            pixel = reinterpret_cast<std::uint32_t (*)(void*)>(symbol("soundor_coexist_pixel"));
            gpuPixel = reinterpret_cast<std::uint32_t (*)(void*)>(symbol("soundor_coexist_gpu_pixel"));
            destroy = reinterpret_cast<void (*)(void*)>(symbol("soundor_coexist_destroy"));
#if defined(_WIN32)
            accessibility =
                reinterpret_cast<IRawElementProviderSimple* (*)(void*)>(symbol("soundor_coexist_accessibility"));
#endif
        }

        ~Plugin() { unload(); }

        void unload()
        {
            if (library == nullptr)
                return;
#if defined(_WIN32)
            FreeLibrary(static_cast<HMODULE>(library));
#else
            dlclose(library);
#endif
            library = nullptr;
        }

        Plugin(const Plugin&) = delete;
        Plugin& operator=(const Plugin&) = delete;

        [[nodiscard]] bool loaded() const { return create && click && pixel && gpuPixel && destroy; }

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
        std::uint32_t (*gpuPixel)(void*) = nullptr;
        void (*destroy)(void*) = nullptr;
#if defined(_WIN32)
        IRawElementProviderSimple* (*accessibility)(void*) = nullptr;
#endif
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

    // The next free fiber local storage slot. Each plugin with the static C
    // runtime takes some: a process has about 4000 since Windows 10 1903, and 128
    // before. Printed to keep an eye on what a plugin costs.
    void reportFlsSlots([[maybe_unused]] const char* when)
    {
#if defined(_WIN32)
        const DWORD slot = FlsAlloc(nullptr);
        if (slot != FLS_OUT_OF_INDEXES)
            FlsFree(slot);
        std::printf("Next free FLS slot %s: %lu\n", when, static_cast<unsigned long>(slot));
#endif
    }

    constexpr std::uint32_t red = 0xFFFF0000;
    constexpr std::uint32_t blue = 0xFF0000FF;

    // Whether there must be a GPU (CI provides one, a software one will do).
    bool gpuRequired()
    {
#if defined(_MSC_VER)
        char* value = nullptr;
        std::size_t size = 0;
        const bool required =
            _dupenv_s(&value, &size, "SOUNDOR_REQUIRE_GPU") == 0 && value != nullptr && std::string(value) == "1";
        std::free(value);
        return required;
#else
        // Read before any thread is started.
        const char* value = std::getenv("SOUNDOR_REQUIRE_GPU"); // NOLINT(concurrency-mt-unsafe)
        return value != nullptr && std::string(value) == "1";
#endif
    }

    void run(const char* pathA, const char* pathB, int round)
    {
        const std::string at = " (round " + std::to_string(round) + ")";
        reportFlsSlots("before loading the plugins");
        Plugin a(pathA);
        Plugin b(pathB);
        reportFlsSlots("with both plugins loaded");
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
        // Each instance has its own GPU device, in its own plugin's ANGLE.
        const bool gpu = a.gpuPixel(a1) != 0;
        if (gpu)
            expect(b.gpuPixel(b1) == blue && a.gpuPixel(a2) == red && a.gpuPixel(a1) == red,
                   "each plugin draws its own color on the GPU" + at);
        else if (round == 1)
            std::printf("No GPU here: the GPU part was skipped.\n");
        expect(gpu || ! gpuRequired(), "a GPU is there, as SOUNDOR_REQUIRE_GPU=1 says" + at);
        a.click(a1);
        b.click(b1);
        a.click(a2);
        expect(a.click(a1) == 2, "A1 counted its own clicks" + at);
        expect(b.click(b1) == 2, "B1 counted its own clicks" + at);
        expect(a.click(a2) == 2, "A2 counted its own clicks" + at);

#if defined(_WIN32)
        using Microsoft::WRL::ComPtr;
        expect(a.accessibility != nullptr && b.accessibility != nullptr, "both plugins expose UIA providers" + at);
        ComPtr<IRawElementProviderSimple> providerA;
        ComPtr<IRawElementProviderSimple> providerA2;
        ComPtr<IRawElementProviderSimple> providerB;
        if (a.accessibility != nullptr && b.accessibility != nullptr)
        {
            providerA.Attach(a.accessibility(a1));
            providerA2.Attach(a.accessibility(a2));
            providerB.Attach(b.accessibility(b1));
            expect(providerA && providerA2 && providerB && providerA.Get() != providerA2.Get()
                       && providerA.Get() != providerB.Get(),
                   "independent COM identities within and across plugins" + at);
            ComPtr<IRawElementProviderSimple> again;
            again.Attach(a.accessibility(a1));
            expect(again.Get() == providerA.Get(), "stable editor provider identity" + at);
        }
#endif
#if defined(_WIN32)
        const auto childOf = [](IRawElementProviderSimple* provider)
        {
            ComPtr<IRawElementProviderFragment> rootFragment;
            ComPtr<IRawElementProviderFragment> child;
            ComPtr<IRawElementProviderSimple> result;
            if (provider != nullptr && SUCCEEDED(provider->QueryInterface(IID_PPV_ARGS(&rootFragment)))
                && SUCCEEDED(rootFragment->Navigate(NavigateDirection_FirstChild, &child)) && child != nullptr)
                child.As(&result);
            return result;
        };
        auto childA = childOf(providerA.Get());
        auto childA2 = childOf(providerA2.Get());
        auto childB = childOf(providerB.Get());
        expect(childA && childA2 && childB, "all plugin editors have semantic children" + at);
        const auto named = [](IRawElementProviderSimple* provider, const wchar_t* name)
        {
            VARIANT value {};
            VariantInit(&value);
            const bool matches =
                provider != nullptr && SUCCEEDED(provider->GetPropertyValue(UIA_NamePropertyId, &value))
                && value.vt == VT_BSTR && std::wstring(value.bstrVal, SysStringLen(value.bstrVal)) == name;
            VariantClear(&value);
            return matches;
        };
        expect(named(childA.Get(), L"red") && named(childA2.Get(), L"red") && named(childB.Get(), L"blue"),
               "each module exposes its own semantic tree" + at);
        const auto idsDiffer = [](IRawElementProviderSimple* left, IRawElementProviderSimple* right)
        {
            if (left == nullptr || right == nullptr)
                return false;
            ComPtr<IRawElementProviderFragment> lf;
            ComPtr<IRawElementProviderFragment> rf;
            if (FAILED(left->QueryInterface(IID_PPV_ARGS(&lf))) || FAILED(right->QueryInterface(IID_PPV_ARGS(&rf))))
                return false;
            SAFEARRAY* lid = nullptr;
            SAFEARRAY* rid = nullptr;
            lf->GetRuntimeId(&lid);
            rf->GetRuntimeId(&rid);
            bool different = false;
            if (lid != nullptr && rid != nullptr)
                for (LONG i = 1; i <= 4; ++i)
                {
                    int l = 0;
                    int r = 0;
                    SafeArrayGetElement(lid, &i, &l);
                    SafeArrayGetElement(rid, &i, &r);
                    different = different || l != r;
                }
            if (lid != nullptr)
                SafeArrayDestroy(lid);
            if (rid != nullptr)
                SafeArrayDestroy(rid);
            return different;
        };
        expect(idsDiffer(childA.Get(), childA2.Get()) && idsDiffer(childA.Get(), childB.Get()),
               "runtime IDs are disjoint within and across plugin modules" + at);
#endif
        a.destroy(a1);
#if defined(_WIN32)
        if (providerA && providerA2 && providerB)
        {
            VARIANT value {};
            expect(providerA->GetPropertyValue(UIA_NamePropertyId, &value)
                       == static_cast<HRESULT>(UIA_E_ELEMENTNOTAVAILABLE),
                   "retained provider is disconnected after destroying its editor" + at);
            VariantClear(&value);
            expect(named(childA2.Get(), L"red") && named(childB.Get(), L"blue"),
                   "other editors keep their semantic trees after A1 closes" + at);
            expect(providerA2->GetPropertyValue(UIA_NamePropertyId, &value) == S_OK,
                   "second instance survives first editor destruction" + at);
            VariantClear(&value);
            expect(providerB->GetPropertyValue(UIA_NamePropertyId, &value) == S_OK,
                   "other plugin's provider survives editor destruction" + at);
            VariantClear(&value);
        }
#endif
        void* b2 = b.create();
        expect(b2 != nullptr && b.click(b2) == 1, "a new B instance starts fresh" + at);
        expect(a.click(a2) == 3 && a.pixel(a2) == red, "A2 outlives A1" + at);
        expect(b.pixel(b1) == blue && b.pixel(b2) == blue, "B instances still draw" + at);
        if (gpu)
            expect(a.gpuPixel(a2) == red && b.gpuPixel(b1) == blue && b.gpuPixel(b2) == blue,
                   "GPU devices outlive another instance's" + at);
        b.destroy(b1);
        a.destroy(a2);
#if defined(_WIN32)
        a.unload();
        if (providerA && providerB)
        {
            VARIANT value {};
            expect(providerA->GetPropertyValue(UIA_NamePropertyId, &value)
                       == static_cast<HRESULT>(UIA_E_ELEMENTNOTAVAILABLE),
                   "stale COM reference is safe after host releases plugin library" + at);
            VariantClear(&value);
            expect(providerB->GetPropertyValue(UIA_NamePropertyId, &value)
                       == static_cast<HRESULT>(UIA_E_ELEMENTNOTAVAILABLE),
                   "destroyed B editor is unavailable" + at);
            VariantClear(&value);
            ComPtr<IRawElementProviderSimple> surviving;
            surviving.Attach(b.accessibility(b2));
            expect(surviving->GetPropertyValue(UIA_NamePropertyId, &value) == S_OK,
                   "B provider survives host releasing A's library" + at);
            VariantClear(&value);
        }
#endif
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
