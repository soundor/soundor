#include "platform/WorkerThread.h"

#include <soundor/platform/Clipboard.h>

#include <dlfcn.h>
#include <glib.h>
#include <poll.h>
#include <sys/eventfd.h>
#include <unistd.h>
#include <xcb/xcb.h>

#include <algorithm>
#include <array>
#include <cerrno>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <future>
#include <memory>
#include <optional>
#include <string>
#include <string_view>
#include <thread>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    namespace
    {
        using namespace std::chrono_literals;
        using Clock = std::chrono::steady_clock;

        // As with the engine's X11 input, load the system library only when
        // there is a desktop. XCB isolates this connection from the host's
        // Xlib event queues and error handlers.
#define SOUNDOR_XCB_FUNCTIONS(F)                                                                                       \
    F(connect)                                                                                                         \
    F(disconnect)                                                                                                      \
    F(connection_has_error)                                                                                            \
    F(get_setup)                                                                                                       \
    F(setup_roots_iterator)                                                                                            \
    F(screen_next)                                                                                                     \
    F(generate_id)                                                                                                     \
    F(create_window)                                                                                                   \
    F(destroy_window)                                                                                                  \
    F(intern_atom)                                                                                                     \
    F(intern_atom_reply)                                                                                               \
    F(poll_for_event)                                                                                                  \
    F(get_file_descriptor)                                                                                             \
    F(flush)                                                                                                           \
    F(set_selection_owner)                                                                                             \
    F(convert_selection)                                                                                               \
    F(change_property)                                                                                                 \
    F(change_window_attributes)                                                                                        \
    F(get_property)                                                                                                    \
    F(get_property_reply)                                                                                              \
    F(get_property_value)                                                                                              \
    F(get_property_value_length)                                                                                       \
    F(send_event)                                                                                                      \
    F(get_selection_owner)                                                                                             \
    F(get_selection_owner_reply)

        struct Xcb
        {
            Xcb()
            {
                if (library == nullptr)
                    return;
                available = true;
#define SOUNDOR_XCB_LOAD(name)                                                                                         \
    name = reinterpret_cast<decltype(name)>(dlsym(library, "xcb_" #name));                                             \
    available = available && (name) != nullptr;
                SOUNDOR_XCB_FUNCTIONS(SOUNDOR_XCB_LOAD)
#undef SOUNDOR_XCB_LOAD
            }

            ~Xcb()
            {
                if (library != nullptr)
                    dlclose(library);
            }

            Xcb(const Xcb&) = delete;
            Xcb& operator=(const Xcb&) = delete;

            // NOLINTNEXTLINE(bugprone-macro-parentheses): a member declaration cannot parenthesize its name
#define SOUNDOR_XCB_DECLARE(name) decltype(&xcb_##name) name = nullptr;
            SOUNDOR_XCB_FUNCTIONS(SOUNDOR_XCB_DECLARE)
#undef SOUNDOR_XCB_DECLARE
            bool available = false;

        private:
            void* library = dlopen("libxcb.so.1", RTLD_NOW | RTLD_LOCAL);
        };
#undef SOUNDOR_XCB_FUNCTIONS

        struct Free
        {
            void operator()(void* data) const { std::free(data); }
        };

        template <typename T>
        using Reply = std::unique_ptr<T, Free>;

        // Leave room for the header within X11's minimum request limit.
        constexpr std::size_t chunkSize = std::size_t { 60 } * 1024;
        constexpr std::size_t maxTextSize = std::size_t { 64 } * 1024 * 1024;
        constexpr std::uint8_t eventTypeMask = 0x7f;

        // STRING is ISO-8859-1. UTF8_STRING is used whenever the peer offers it.
        std::optional<std::string> convert(std::string_view text, const char* to, const char* from)
        {
            gsize length = 0;
            const std::unique_ptr<char, decltype(&g_free)> result(
                g_convert(text.data(), static_cast<gssize>(text.size()), to, from, nullptr, &length, nullptr), g_free);
            if (result == nullptr)
                return std::nullopt;
            return std::string(result.get(), length);
        }

        class X11Clipboard final : public ui::Clipboard
        {
        public:
            X11Clipboard()
            {
                if (! x.available)
                    return;
                int screenIndex = 0;
                connection = x.connect(nullptr, &screenIndex);
                if (x.connection_has_error(connection) != 0)
                    return;
                auto screens = x.setup_roots_iterator(x.get_setup(connection));
                for (int i = 0; i < screenIndex && screens.rem > 0; ++i)
                    x.screen_next(&screens);
                if (screens.rem == 0)
                    return;
                root = screens.data->root;

                clipboard = atom("CLIPBOARD");
                utf8 = atom("UTF8_STRING");
                targets = atom("TARGETS");
                textTarget = atom("TEXT");
                incremental = atom("INCR");
                property = atom("SOUNDOR_CLIPBOARD");
                if (clipboard == XCB_NONE || utf8 == XCB_NONE || targets == XCB_NONE || textTarget == XCB_NONE
                    || incremental == XCB_NONE || property == XCB_NONE)
                    return;

                wake = eventfd(0, EFD_CLOEXEC | EFD_NONBLOCK);
                if (wake < 0)
                    return;
                owner = window();
                x.flush(connection);
                worker = std::jthread([this](const std::stop_token& stop) { run(stop); });
            }

            ~X11Clipboard() override
            {
                if (worker.joinable())
                {
                    worker.request_stop();
                    signal();
                    worker.join();
                }
                if (wake >= 0)
                    close(wake);
                if (connection != nullptr)
                    x.disconnect(connection);
            }

            [[nodiscard]] bool available() const { return worker.joinable(); }

            std::string readText() override
            {
                auto result = std::make_shared<std::promise<std::string>>();
                auto future = result->get_future();
                readTextAsync([result = std::move(result)](std::optional<std::string> text)
                              { result->set_value(std::move(text).value()); });
                return future.get();
            }

            bool readTextAsync(Completion&& complete) override
            {
                post([this, complete = std::move(complete)](const std::stop_token& stop)
                     { complete(readSelection(stop)); });
                return true;
            }

            void writeText(std::string text) override { queueWrite(std::move(text), {}); }

            bool writeTextAsync(std::string_view text, Completion&& complete) override
            {
                queueWrite(std::string(text), std::move(complete));
                return true;
            }

        private:
            using Job = std::function<void(const std::stop_token&)>;

            struct Transfer
            {
                xcb_window_t requestor;
                xcb_atom_t destination;
                xcb_atom_t type;
                std::shared_ptr<const std::string> data;
                std::size_t offset = 0;
                Clock::time_point expires;
            };

            [[nodiscard]] xcb_atom_t atom(std::string_view name) const
            {
                const auto cookie = x.intern_atom(connection, 0, static_cast<std::uint16_t>(name.size()), name.data());
                const Reply<xcb_intern_atom_reply_t> reply(x.intern_atom_reply(connection, cookie, nullptr));
                return reply != nullptr ? reply->atom : static_cast<xcb_atom_t>(XCB_NONE);
            }

            [[nodiscard]] xcb_window_t window() const
            {
                const xcb_window_t id = x.generate_id(connection);
                constexpr std::uint32_t events = XCB_EVENT_MASK_PROPERTY_CHANGE;
                x.create_window(connection, XCB_COPY_FROM_PARENT, id, root, 0, 0, 1, 1, 0, XCB_WINDOW_CLASS_INPUT_ONLY,
                                XCB_COPY_FROM_PARENT, XCB_CW_EVENT_MASK, &events);
                return id;
            }

            void signal() const
            {
                const std::uint64_t one = 1;
                while (write(wake, &one, sizeof(one)) < 0 && errno == EINTR)
                {
                }
            }

            void post(Job job)
            {
                jobs.post(std::move(job));
                signal();
            }

            void queueWrite(std::string text, Completion complete)
            {
                post(
                    [this, text = std::move(text), complete = std::move(complete)](const std::stop_token& stop) mutable
                    {
                        if (! stop.stop_requested() && text.size() <= maxTextSize
                            && x.connection_has_error(connection) == 0)
                        {
                            value = std::make_shared<const std::string>(std::move(text));
                            auto latin = convert(*value, "ISO-8859-1", "UTF-8");
                            latinValue = latin ? std::make_shared<const std::string>(std::move(*latin)) : nullptr;
                            x.set_selection_owner(connection, owner, clipboard, XCB_CURRENT_TIME);
                            // Await the server's processing of the ownership
                            // request before resolving writeText().
                            (void)selectionOwner();
                        }
                        if (complete)
                            complete(std::nullopt);
                    });
            }

            [[nodiscard]] xcb_window_t selectionOwner() const
            {
                const auto cookie = x.get_selection_owner(connection, clipboard);
                const Reply<xcb_get_selection_owner_reply_t> reply(
                    x.get_selection_owner_reply(connection, cookie, nullptr));
                return reply != nullptr ? reply->owner : static_cast<xcb_window_t>(XCB_NONE);
            }

            void run(const std::stop_token& stop)
            {
                while (! stop.stop_requested())
                {
                    for (auto& job : jobs.take())
                        job(stop);
                    while (const Reply<xcb_generic_event_t> event { x.poll_for_event(connection) })
                        dispatch(*event);
                    for (std::size_t i = transfers.size(); i > 0; --i)
                        if (transfers[i - 1].expires <= Clock::now())
                            forgetTransfer(i - 1);
                    x.flush(connection);

                    const bool connected = x.connection_has_error(connection) == 0;
                    std::array<pollfd, 2> fds { { { wake, POLLIN, 0 },
                                                  { connected ? x.get_file_descriptor(connection) : -1, POLLIN, 0 } } };
                    if (poll(fds.data(), fds.size(), transfers.empty() ? -1 : 250) > 0
                        && (fds[0].revents & POLLIN) != 0)
                    {
                        std::uint64_t counter = 0;
                        const auto ignored = read(wake, &counter, sizeof(counter));
                        (void)ignored;
                    }
                }
            }

            std::optional<std::string> readTarget(xcb_window_t requestor, xcb_atom_t target, Clock::time_point deadline,
                                                  const std::stop_token& stop)
            {
                x.convert_selection(connection, requestor, clipboard, target, property, XCB_CURRENT_TIME);
                x.flush(connection);

                bool receiving = false;
                std::string result;
                while (! stop.stop_requested() && Clock::now() < deadline && x.connection_has_error(connection) == 0)
                {
                    const Reply<xcb_generic_event_t> event(x.poll_for_event(connection));
                    if (event == nullptr)
                    {
                        pollfd fd { x.get_file_descriptor(connection), POLLIN, 0 };
                        const auto left = std::chrono::ceil<std::chrono::milliseconds>(deadline - Clock::now());
                        if (left.count() > 0)
                        {
                            const auto ignored = poll(&fd, 1, static_cast<int>(std::min(left, 50ms).count()));
                            (void)ignored;
                        }
                        continue;
                    }

                    const auto type = event->response_type & eventTypeMask;
                    if (type == XCB_SELECTION_NOTIFY)
                    {
                        const auto& notify = reinterpret_cast<const xcb_selection_notify_event_t&>(*event);
                        if (notify.requestor != requestor || notify.target != target)
                            continue;
                        if (notify.property != property)
                            return std::nullopt;
                    }
                    else if (type == XCB_PROPERTY_NOTIFY)
                    {
                        const auto& notification = reinterpret_cast<const xcb_property_notify_event_t&>(*event);
                        if (! receiving || notification.window != requestor || notification.atom != property
                            || notification.state != XCB_PROPERTY_NEW_VALUE)
                        {
                            dispatch(*event);
                            continue;
                        }
                    }
                    else
                    {
                        dispatch(*event);
                        continue;
                    }

                    const auto cookie = x.get_property(connection, 1, requestor, property, XCB_GET_PROPERTY_TYPE_ANY, 0,
                                                       maxTextSize / 4);
                    const Reply<xcb_get_property_reply_t> data(x.get_property_reply(connection, cookie, nullptr));
                    if (data == nullptr || data->bytes_after != 0)
                        return std::nullopt;
                    if (! receiving && data->type == incremental && data->format == 32)
                    {
                        receiving = true;
                        continue;
                    }
                    if (data->type != target || data->format != 8)
                        return std::nullopt;

                    const auto length = static_cast<std::size_t>(x.get_property_value_length(data.get()));
                    if (length > maxTextSize - result.size())
                        return std::nullopt;
                    result.append(static_cast<const char*>(x.get_property_value(data.get())), length);
                    if (! receiving || length == 0)
                        return target == XCB_ATOM_STRING ? convert(result, "UTF-8", "ISO-8859-1")
                                                         : std::optional(std::move(result));
                }
                return std::nullopt;
            }

            std::string readSelection(const std::stop_token& stop)
            {
                if (stop.stop_requested() || x.connection_has_error(connection) != 0)
                    return {};
                const auto currentOwner = selectionOwner();
                if (currentOwner == XCB_NONE)
                    return {};
                if (currentOwner == owner)
                    return value != nullptr ? *value : std::string {};

                // A new request window prevents a late reply to a timed-out
                // paste being accepted by a subsequent one.
                const auto requestor = window();
                const auto deadline = Clock::now() + 500ms;
                auto result = readTarget(requestor, utf8, deadline, stop);
                if (! result && Clock::now() < deadline)
                    result = readTarget(requestor, XCB_ATOM_STRING, deadline, stop);
                x.destroy_window(connection, requestor);
                x.flush(connection);
                return std::move(result).value_or(std::string {});
            }

            void sendSelection(const xcb_selection_request_event_t& request)
            {
                const auto destination = request.property == XCB_NONE ? request.target : request.property;
                xcb_selection_notify_event_t reply {};
                reply.response_type = XCB_SELECTION_NOTIFY;
                reply.time = request.time;
                reply.requestor = request.requestor;
                reply.selection = request.selection;
                reply.target = request.target;
                reply.property = XCB_NONE;

                if (request.selection == clipboard && value != nullptr)
                {
                    if (request.target == targets)
                    {
                        const std::array<xcb_atom_t, 4> supported { targets, utf8, textTarget, XCB_ATOM_STRING };
                        const auto count = latinValue != nullptr ? 4U : 3U;
                        x.change_property(connection, XCB_PROP_MODE_REPLACE, request.requestor, destination,
                                          XCB_ATOM_ATOM, 32, count, supported.data());
                        reply.property = destination;
                    }
                    else if (request.target == utf8 || request.target == textTarget
                             || request.target == XCB_ATOM_STRING)
                    {
                        const bool isLatin = request.target == XCB_ATOM_STRING;
                        auto data = isLatin ? latinValue : value;
                        const auto type = isLatin ? static_cast<xcb_atom_t>(XCB_ATOM_STRING) : utf8;
                        if (data != nullptr && sendText(request.requestor, destination, type, std::move(data)))
                            reply.property = destination;
                    }
                }

                std::array<char, 32> bytes {};
                static_assert(sizeof(reply) <= bytes.size());
                std::memcpy(bytes.data(), &reply, sizeof(reply));
                x.send_event(connection, 0, request.requestor, XCB_EVENT_MASK_NO_EVENT, bytes.data());
                x.flush(connection);
            }

            bool sendText(xcb_window_t target, xcb_atom_t destination, xcb_atom_t type,
                          std::shared_ptr<const std::string> data)
            {
                const auto length = static_cast<std::uint32_t>(data->size());
                if (length <= chunkSize)
                {
                    x.change_property(connection, XCB_PROP_MODE_REPLACE, target, destination, type, 8, length,
                                      data->data());
                    return true;
                }
                if (transfers.size() >= 16
                    || std::ranges::any_of(
                        transfers, [&](const auto& transfer)
                        { return transfer.requestor == target && transfer.destination == destination; }))
                    return false;

                constexpr std::uint32_t mask = XCB_EVENT_MASK_PROPERTY_CHANGE;
                x.change_window_attributes(connection, target, XCB_CW_EVENT_MASK, &mask);
                x.change_property(connection, XCB_PROP_MODE_REPLACE, target, destination, incremental, 32, 1, &length);
                transfers.push_back({ target, destination, type, std::move(data), 0, Clock::now() + 2s });
                return true;
            }

            void forgetTransfer(std::size_t index)
            {
                const auto requestor = transfers[index].requestor;
                transfers.erase(transfers.begin() + static_cast<std::ptrdiff_t>(index));
                if (! std::ranges::any_of(transfers, [requestor](const auto& transfer)
                                          { return transfer.requestor == requestor; }))
                {
                    constexpr std::uint32_t mask = XCB_EVENT_MASK_NO_EVENT;
                    x.change_window_attributes(connection, requestor, XCB_CW_EVENT_MASK, &mask);
                }
            }

            void dispatch(const xcb_generic_event_t& event)
            {
                const auto type = event.response_type & eventTypeMask;
                if (type == XCB_SELECTION_REQUEST)
                {
                    sendSelection(reinterpret_cast<const xcb_selection_request_event_t&>(event));
                }
                else if (type == XCB_PROPERTY_NOTIFY)
                {
                    const auto& notification = reinterpret_cast<const xcb_property_notify_event_t&>(event);
                    if (notification.state != XCB_PROPERTY_DELETE)
                        return;
                    for (std::size_t i = 0; i < transfers.size(); ++i)
                    {
                        auto& transfer = transfers[i];
                        if (transfer.requestor != notification.window || transfer.destination != notification.atom)
                            continue;
                        const auto length = std::min(chunkSize, transfer.data->size() - transfer.offset);
                        x.change_property(connection, XCB_PROP_MODE_REPLACE, transfer.requestor, transfer.destination,
                                          transfer.type, 8, static_cast<std::uint32_t>(length),
                                          transfer.data->data() + transfer.offset);
                        if (length == 0)
                            forgetTransfer(i);
                        else
                        {
                            transfer.offset += length;
                            transfer.expires = Clock::now() + 2s;
                        }
                        x.flush(connection);
                        break;
                    }
                }
            }

            Xcb x;
            xcb_connection_t* connection = nullptr;
            int wake = -1;
            xcb_window_t root = XCB_NONE;
            xcb_window_t owner = XCB_NONE;
            xcb_atom_t clipboard = XCB_NONE;
            xcb_atom_t utf8 = XCB_NONE;
            xcb_atom_t targets = XCB_NONE;
            xcb_atom_t textTarget = XCB_NONE;
            xcb_atom_t incremental = XCB_NONE;
            xcb_atom_t property = XCB_NONE;
            std::shared_ptr<const std::string> value;
            std::shared_ptr<const std::string> latinValue;
            std::vector<Transfer> transfers;
            HandoffQueue<Job> jobs;
            std::jthread worker;
        };
    } // namespace

    std::shared_ptr<ui::Clipboard> systemClipboard()
    {
        // Keep serving text after an editor closes, for as long as the
        // loaded engine owns the X11 selection.
        static const auto clipboard = std::make_shared<X11Clipboard>();
        return clipboard->available() ? clipboard : nullptr;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
