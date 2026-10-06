#pragma once

#include <soundor/Config.h>
#include <soundor/a11y/Semantics.h>

#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE
{
    class RuntimeHost;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
{
    // The native view a plugin view's surface is shown in. This is all a
    // plugin framework (JUCE today, iPlug2 or another tomorrow) hands over for
    // Soundor to present the view to the platform's assistive technology; the
    // semantics are Soundor's.
    struct NativeView
    {
        // Windows: the HWND the surface is drawn in. Linux: unused (AT-SPI
        // needs no window, only geometry). macOS: the NSView, iOS: the UIView
        // (once Soundor's Apple bridge exists).
        void* handle = nullptr;
    };

    // Where the surface is shown, in the native view's units.
    struct ViewGeometry
    {
        // The surface's top-left corner in the native view, and native units
        // per logical pixel. Windows and Linux: physical pixels of the view.
        float x = 0;
        float y = 0;
        float scale = 1;
        // Linux: the view's bounds on the screen, in physical pixels (known
        // under X11; empty under Wayland).
        Rect screen;

        friend bool operator==(const ViewGeometry&, const ViewGeometry&) = default;
    };

    struct PlatformOptions
    {
        NativeView view;
        // What the view is called: the plugin's name.
        std::string name;
    };

    // The platform's accessibility for one native view, fed by the semantic
    // tree of the RuntimeHost shown in it (which may be replaced: a reload).
    //
    // Everything is called on the UI thread. Requests the platform makes on
    // other threads are queued and delivered from tick(); nothing reaches
    // plugin code, or its audio, from the platform's threads.
    class PlatformAccessibility
    {
    public:
        virtual ~PlatformAccessibility() = default;

        // After every RuntimeHost::tick(): delivers the actions assistive
        // technology asked for since, then, while it is listening, sends the
        // tree's changes. A host other than the last one gets the whole tree.
        virtual void tick(RuntimeHost& host) = 0;
        virtual void setGeometry(const ViewGeometry& geometry) = 0;
        // Whether the native view's window has keyboard focus.
        virtual void setFocused(bool focused) = 0;
        // Whether assistive technology asked for the tree.
        [[nodiscard]] virtual bool active() const = 0;
    };

    // The platform's accessibility for `options.view`; null where Soundor has
    // none here: macOS and iOS (until their bridge), Android (no runtime yet),
    // or a build without AccessKit (Linux arm64, SOUNDOR_ACCESSKIT=OFF).
    [[nodiscard]] std::unique_ptr<PlatformAccessibility> createPlatformAccessibility(const PlatformOptions& options);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y
