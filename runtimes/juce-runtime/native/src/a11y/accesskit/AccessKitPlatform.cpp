// PlatformAccessibility through AccessKit: UI Automation on Windows, AT-SPI
// on Linux. Soundor's semantic tree goes in (Mapping.h), AccessKit's requests
// come out, queued for the UI thread.
//
// Lifetime rules, because a plugin lives in someone else's process:
// - The platform calls back with a token, not a pointer. Callbacks find their
//   channel in a registry of weak references, so one arriving after the
//   view's accessibility is gone does nothing.
// - Requests made on a platform thread are plain data in a queue; only tick(),
//   on the UI thread, turns them into actions on the view.
// - Once AccessKit has run code the platform may still call into later (UI
//   Automation providers held by a screen reader on Windows; the AT-SPI
//   thread on Linux), the plugin's binary is pinned: unloading it would leave
//   the platform calling code that is gone.

#include "a11y/accesskit/AccessKitPlatform.h"

#include "a11y/accesskit/Mapping.h"

#include <soundor/runtime/RuntimeHost.h>

#include <cstdint>
#include <memory>
#include <mutex>
#include <unordered_map>
#include <utility>
#include <vector>

#if defined(_WIN32)
    #include <commctrl.h>
#else
    #include <dlfcn.h>
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    namespace
    {
        struct Registry
        {
            std::mutex mutex;
            std::unordered_map<std::uintptr_t, std::weak_ptr<Channel>> channels;
            std::uintptr_t last = 0;
        };

        // Never destroyed: a platform thread may call back while the process
        // exits.
        Registry& registry()
        {
            static auto* instance = new Registry; // NOLINT(cppcoreguidelines-owning-memory)
            return *instance;
        }

        std::uintptr_t enroll(const std::shared_ptr<Channel>& channel)
        {
            Registry& all = registry();
            const std::scoped_lock lock(all.mutex);
            all.channels.emplace(++all.last, channel);
            return all.last;
        }

        void withdraw(std::uintptr_t token)
        {
            Registry& all = registry();
            const std::scoped_lock lock(all.mutex);
            all.channels.erase(token);
        }

        std::shared_ptr<Channel> channelOf(void* userdata)
        {
            Registry& all = registry();
            const std::scoped_lock lock(all.mutex);
            const auto found = all.channels.find(reinterpret_cast<std::uintptr_t>(userdata));
            return found == all.channels.end() ? nullptr : found->second.lock();
        }

        // Keeps this binary loaded for the rest of the process.
        void pinModule()
        {
            static std::once_flag pinned;
            std::call_once(pinned,
                           []
                           {
                               static const char anchor = 0;
#if defined(_WIN32)
                               HMODULE module = nullptr;
                               GetModuleHandleExW(GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS
                                                      | GET_MODULE_HANDLE_EX_FLAG_PIN,
                                                  reinterpret_cast<LPCWSTR>(&anchor), &module);
#else
                               Dl_info info {};
                               if (dladdr(&anchor, &info) != 0 && info.dli_fname != nullptr)
                                   dlopen(info.dli_fname, RTLD_NOW | RTLD_NOLOAD | RTLD_NODELETE);
#endif
                           });
        }
    } // namespace

    void* tokenPointer(std::uintptr_t token)
    {
        return reinterpret_cast<void*>(token); // NOLINT(performance-no-int-to-ptr)
    }

    // ── Callbacks (any thread) ──────────────────────────────────────────────

    accesskit_tree_update* activate(void* userdata)
    {
        if (const auto channel = channelOf(userdata))
        {
            pinModule();
            channel->wantsFull = true;
            channel->active = true;
        }
        // Lazy: the tree is built on the UI thread, at the next tick.
        return nullptr;
    }

    void deactivate(void* userdata)
    {
        if (const auto channel = channelOf(userdata))
            channel->active = false;
    }

    void deliver(void* userdata, PlatformRequest request)
    {
        if (const auto channel = channelOf(userdata))
        {
            const std::scoped_lock lock(channel->mutex);
            channel->requests.push_back(std::move(request));
        }
    }

    void request(accesskit_action_request* raw, void* userdata)
    {
        PlatformRequest copied = copyRequest(*raw);
        accesskit_action_request_free(raw);
        deliver(userdata, std::move(copied));
    }

    accesskit_tree_update* buildUpdate(void* userdata)
    {
        auto* pending = static_cast<Pending*>(userdata);
        pending->built = true;
        return toAccessKit(pending->changes, pending->tree, pending->presentation, pending->withRoot);
    }

    // ── The platform-independent part ───────────────────────────────────────

    AccessKitPlatform::AccessKitPlatform(std::string name)
        : channel(std::make_shared<Channel>()), channelToken(enroll(channel))
    {
        presentation.name = std::move(name);
    }

    AccessKitPlatform::~AccessKitPlatform()
    {
        withdraw(channelToken);
    }

    void AccessKitPlatform::tick(RuntimeHost& host)
    {
        // Requests first: they act on the tree the platform was shown.
        std::vector<PlatformRequest> requests;
        {
            const std::scoped_lock lock(channel->mutex);
            requests.swap(channel->requests);
        }
        // Another host (a reload) knows none of the old ids.
        const bool sameHost = &host == lastHost;
        for (const PlatformRequest& pending : requests)
            if (sameHost)
                if (const auto action = toSoundor(pending, mirror))
                    host.performAccessibilityAction(*action);

        if (! channel->active)
            return;
        const bool full = channel->wantsFull.exchange(false) || ! sameHost;
        lastHost = &host;
        const TreeUpdate changes = host.accessibility().update(full);
        if (changes.empty() && ! presentationChanged)
            return;
        mirror.apply(changes);
        Pending pending { changes, mirror, presentation, presentationChanged || full };
        presentationChanged = false;
        send(&pending);
        // Not taken (the platform went inactive meanwhile): start over with
        // the whole tree next time.
        if (! pending.built)
            channel->wantsFull = true;
    }

    void AccessKitPlatform::setGeometry(const ViewGeometry& next)
    {
        if (next == geometry)
            return;
        geometry = next;
        presentation.scale = geometry.scale;
        presentation.dx = geometry.x;
        presentation.dy = geometry.y;
        presentationChanged = true;
        moved();
    }

    bool AccessKitPlatform::active() const
    {
        return channel->active;
    }

    namespace
    {
#if defined(_WIN32)
        // ── Windows: UI Automation ──────────────────────────────────────────

        class WindowsPlatform final : public AccessKitPlatform
        {
        public:
            WindowsPlatform(HWND window, std::string name) : AccessKitPlatform(std::move(name)), hwnd(window)
            {
                adapter = accesskit_windows_adapter_new(hwnd, GetFocus() == hwnd, request, tokenPointer(token()));
                // UI Automation asks the window (WM_GETOBJECT). A subclass of
                // this one window, removed with it: no window class changes.
                SetWindowSubclass(hwnd, windowProc, subclassId(), reinterpret_cast<DWORD_PTR>(this));
            }

            ~WindowsPlatform() override
            {
                if (hwnd != nullptr)
                    RemoveWindowSubclass(hwnd, windowProc, subclassId());
                accesskit_windows_adapter_free(adapter);
            }

            WindowsPlatform(const WindowsPlatform&) = delete;
            WindowsPlatform& operator=(const WindowsPlatform&) = delete;

            void setFocused(bool focused) final
            {
                raise(accesskit_windows_adapter_update_window_focus_state(adapter, focused));
            }

        protected:
            void send(Pending* pending) final
            {
                raise(accesskit_windows_adapter_update_if_active(adapter, buildUpdate, pending));
            }

        private:
            static UINT_PTR subclassId()
            {
                static const char id = 0;
                return reinterpret_cast<UINT_PTR>(&id);
            }

            static void raise(accesskit_windows_queued_events* events)
            {
                if (events != nullptr)
                    accesskit_windows_queued_events_raise(events);
            }

            static LRESULT CALLBACK windowProc(HWND window, UINT message, WPARAM wParam, LPARAM lParam, UINT_PTR,
                                               DWORD_PTR data)
            {
                auto* self = reinterpret_cast<WindowsPlatform*>(data); // NOLINT(performance-no-int-to-ptr)
                if (message == WM_GETOBJECT)
                {
                    const accesskit_opt_lresult result = accesskit_windows_adapter_handle_wm_getobject(
                        self->adapter, wParam, lParam, activate, tokenPointer(self->token()));
                    if (result.has_value)
                        return result.value;
                }
                else if (message == WM_NCDESTROY)
                {
                    RemoveWindowSubclass(window, windowProc, subclassId());
                    self->hwnd = nullptr;
                }
                return DefSubclassProc(window, message, wParam, lParam);
            }

            HWND hwnd;
            accesskit_windows_adapter* adapter = nullptr;
        };
#elif defined(__linux__)
        // ── Linux: AT-SPI ───────────────────────────────────────────────────

        class UnixPlatform final : public AccessKitPlatform
        {
        public:
            explicit UnixPlatform(std::string name) : AccessKitPlatform(std::move(name))
            {
                // The adapter starts AccessKit's AT-SPI thread, which lives on.
                pinModule();
                adapter = accesskit_unix_adapter_new(activate, tokenPointer(token()), request, tokenPointer(token()),
                                                     deactivate, tokenPointer(token()));
            }

            ~UnixPlatform() override { accesskit_unix_adapter_free(adapter); }

            UnixPlatform(const UnixPlatform&) = delete;
            UnixPlatform& operator=(const UnixPlatform&) = delete;

            void setFocused(bool focused) final { accesskit_unix_adapter_update_window_focus_state(adapter, focused); }

        protected:
            void send(Pending* pending) final
            {
                accesskit_unix_adapter_update_if_active(adapter, buildUpdate, pending);
            }

            void moved() final
            {
                const Rect& screen = viewGeometry().screen;
                const accesskit_rect bounds { screen.x, screen.y, static_cast<double>(screen.x) + screen.width,
                                              static_cast<double>(screen.y) + screen.height };
                accesskit_unix_adapter_set_root_window_bounds(adapter, bounds, bounds);
            }

        private:
            accesskit_unix_adapter* adapter = nullptr;
        };
#endif
    } // namespace

    std::unique_ptr<PlatformAccessibility> createAccessKitPlatform(const PlatformOptions& options)
    {
#if defined(_WIN32)
        if (options.view.handle == nullptr)
            return nullptr;
        return std::make_unique<WindowsPlatform>(static_cast<HWND>(options.view.handle), options.name);
#elif defined(__linux__)
        return std::make_unique<UnixPlatform>(options.name);
#else
        // Android: the runtime has no Android view to attach to yet.
        static_cast<void>(options);
        return nullptr;
#endif
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
