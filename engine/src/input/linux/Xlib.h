#pragma once

#include <soundor/Config.h>

#include <X11/XKBlib.h>
#include <X11/Xlib.h>
#include <X11/Xproto.h>
#include <X11/Xutil.h>
#include <X11/extensions/XInput2.h>
#include <dlfcn.h>

#include <cstddef>
#include <cstdint>
#include <initializer_list>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
{
    // The Xlib, XInput 2 and (optionally) xkbcommon functions native input
    // uses, loaded when first needed: an engine never links X11 or requires
    // it at load time, so a plugin still loads (with the framework's input)
    // where there is none. Read-only once loaded.
#define SOUNDOR_X11_FUNCTIONS(F)                                                                                       \
    F(XOpenDisplay)                                                                                                    \
    F(XCloseDisplay)                                                                                                   \
    F(XConnectionNumber)                                                                                               \
    F(XPending)                                                                                                        \
    F(XNextEvent)                                                                                                      \
    F(XFilterEvent)                                                                                                    \
    F(XGetEventData)                                                                                                   \
    F(XFreeEventData)                                                                                                  \
    F(XQueryExtension)                                                                                                 \
    F(XFlush)                                                                                                          \
    F(XSync)                                                                                                           \
    F(XSelectInput)                                                                                                    \
    F(XCreateWindow)                                                                                                   \
    F(XDestroyWindow)                                                                                                  \
    F(XMapRaised)                                                                                                      \
    F(XUnmapWindow)                                                                                                    \
    F(XMoveResizeWindow)                                                                                               \
    F(XGetGeometry)                                                                                                    \
    F(XGetInputFocus)                                                                                                  \
    F(XQueryTree)                                                                                                      \
    F(XFree)                                                                                                           \
    F(XRefreshKeyboardMapping)                                                                                         \
    F(XkbQueryExtension)                                                                                               \
    F(XkbLookupKeySym)                                                                                                 \
    F(XLookupString)                                                                                                   \
    F(Xutf8LookupString)                                                                                               \
    F(XSupportsLocale)                                                                                                 \
    F(XSetLocaleModifiers)                                                                                             \
    F(XOpenIM)                                                                                                         \
    F(XCloseIM)                                                                                                        \
    F(XGetIMValues)                                                                                                    \
    F(XSetIMValues)                                                                                                    \
    F(XCreateIC)                                                                                                       \
    F(XDestroyIC)                                                                                                      \
    F(XGetICValues)                                                                                                    \
    F(XSetICFocus)                                                                                                     \
    F(XUnsetICFocus)                                                                                                   \
    F(XRegisterIMInstantiateCallback)                                                                                  \
    F(XUnregisterIMInstantiateCallback)                                                                                \
    F(XAddExtension)                                                                                                   \
    F(XEHeadOfExtensionList)                                                                                           \
    F(XAddToExtensionList)                                                                                             \
    F(XFindOnExtensionList)

#define SOUNDOR_XI_FUNCTIONS(F)                                                                                        \
    F(XIQueryVersion)                                                                                                  \
    F(XISelectEvents)                                                                                                  \
    F(XIQueryDevice)                                                                                                   \
    F(XIFreeDeviceInfo)                                                                                                \
    F(XIWarpPointer)

    class Xlib
    {
    public:
        // Xlib's per-display error hook (Xlibint.h's XESetError), declared
        // here rather than through Xlib's internal header.
        using ErrorHook = int (*)(Display*, xError*, XExtCodes*, int*);
        using SetErrorHook = ErrorHook (*)(Display*, int, ErrorHook);
        // libX11 1.7's per-display replacement for exiting on a lost
        // connection; absent before it.
        using IOErrorExit = void (*)(Display*, void*);
        using SetIOErrorExit = void (*)(Display*, IOErrorExit, void*);
        // xkbcommon's xkb_keysym_to_utf8; absent without libxkbcommon.
        using KeysymToUtf8 = int (*)(std::uint32_t, char*, std::size_t);

        Xlib()
        {
            x11 = dlopen("libX11.so.6", RTLD_NOW | RTLD_LOCAL);
            xi = dlopen("libXi.so.6", RTLD_NOW | RTLD_LOCAL);
            if (x11 == nullptr || xi == nullptr)
                return;
            bool complete = true;
#define SOUNDOR_X11_LOAD(name)                                                                                         \
    name = reinterpret_cast<decltype(name)>(dlsym(x11, #name));                                                        \
    complete = complete && (name) != nullptr;
#define SOUNDOR_XI_LOAD(name)                                                                                          \
    name = reinterpret_cast<decltype(name)>(dlsym(xi, #name));                                                         \
    complete = complete && (name) != nullptr;
            SOUNDOR_X11_FUNCTIONS(SOUNDOR_X11_LOAD)
            SOUNDOR_XI_FUNCTIONS(SOUNDOR_XI_LOAD)
#undef SOUNDOR_X11_LOAD
#undef SOUNDOR_XI_LOAD
            XESetError = reinterpret_cast<SetErrorHook>(dlsym(x11, "XESetError"));
            complete = complete && XESetError != nullptr;
            XSetIOErrorExitHandler = reinterpret_cast<SetIOErrorExit>(dlsym(x11, "XSetIOErrorExitHandler"));
            xkbcommon = dlopen("libxkbcommon.so.0", RTLD_NOW | RTLD_LOCAL);
            if (xkbcommon != nullptr)
                xkb_keysym_to_utf8 = reinterpret_cast<KeysymToUtf8>(dlsym(xkbcommon, "xkb_keysym_to_utf8"));
            available = complete;
        }
        ~Xlib()
        {
            for (void* library : { xkbcommon, xi, x11 })
                if (library != nullptr)
                    dlclose(library);
        }
        Xlib(const Xlib&) = delete;
        Xlib& operator=(const Xlib&) = delete;

        bool available = false;
// NOLINTNEXTLINE(bugprone-macro-parentheses): a member declaration cannot parenthesize its name
#define SOUNDOR_X11_DECLARE(name) decltype(&::name) name = nullptr;
        SOUNDOR_X11_FUNCTIONS(SOUNDOR_X11_DECLARE)
        SOUNDOR_XI_FUNCTIONS(SOUNDOR_X11_DECLARE)
#undef SOUNDOR_X11_DECLARE
        SetErrorHook XESetError = nullptr;
        SetIOErrorExit XSetIOErrorExitHandler = nullptr;
        KeysymToUtf8 xkb_keysym_to_utf8 = nullptr;

    private:
        void* x11 = nullptr;
        void* xi = nullptr;
        void* xkbcommon = nullptr;
    };

#undef SOUNDOR_X11_FUNCTIONS
#undef SOUNDOR_XI_FUNCTIONS
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::input::x11
