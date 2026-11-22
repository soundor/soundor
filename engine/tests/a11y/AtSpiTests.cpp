#include "../web/WebTestSupport.h"
#include "a11y/linux/AtSpi.h"
#include "a11y/linux/Mapping.h"

#include <doctest/doctest.h>
#include <gio/gio.h>
#include <glib/gstdio.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <functional>
#include <iterator>
#include <mutex>
#include <string>
#include <thread>
#include <utility>
#include <vector>

using namespace soundor;
using namespace soundor::a11y;

namespace
{
    bool eventually(const std::function<bool()>& condition)
    {
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(4);
        while (std::chrono::steady_clock::now() < deadline)
        {
            if (condition())
                return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(5));
        }
        return false;
    }

    // In-process protocol fixture with its own daemon, registry and context.
    // Does not overwrite the process's session bus environment.
    class Bus
    {
    public:
        Bus()
        {
            char* temporary = g_dir_make_tmp("soundor-bus-XXXXXX", nullptr);
            REQUIRE(temporary != nullptr);
            directory = temporary;
            g_free(temporary);
            address = "unix:path=" + directory + "/bus";
            launch();
            context = g_main_context_new();
            thread = std::thread([this] { serve(); });
            REQUIRE(eventually([&] { return ready.load(); }));
            client = connect();
            REQUIRE(client != nullptr);
        }
        ~Bus()
        {
            g_dbus_connection_close_sync(client, nullptr, nullptr);
            g_object_unref(client);
            stop = true;
            g_main_context_wakeup(context);
            thread.join();
            g_main_context_unref(context);
            g_subprocess_force_exit(process);
            g_subprocess_wait(process, nullptr, nullptr);
            g_object_unref(process);
            g_unlink((directory + "/bus").c_str());
            g_rmdir(directory.c_str());
        }
        Bus(const Bus&) = delete;
        Bus& operator=(const Bus&) = delete;

        [[nodiscard]] GDBusConnection* connect() const
        {
            auto* result = g_dbus_connection_new_for_address_sync(
                address.c_str(),
                // GIO defines this C enum as combinable flags. Clang 18 rejects valid combinations.
                // NOLINTNEXTLINE(clang-analyzer-optin.core.EnumCastOutOfRange)
                static_cast<GDBusConnectionFlags>(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT
                                                  | G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION),
                nullptr, nullptr, nullptr);
            if (result != nullptr)
                g_dbus_connection_set_exit_on_close(result, FALSE);
            return result;
        }
        std::vector<std::string> applications()
        {
            const std::scoped_lock lock(mutex);
            return apps;
        }
        GVariant* call(const std::string& destination, const char* path, const char* interface, const char* method,
                       GVariant* parameters = nullptr, const GVariantType* type = nullptr, GError** error = nullptr)
        {
            return g_dbus_connection_call_sync(client, destination.c_str(), path, interface, method, parameters, type,
                                               G_DBUS_CALL_FLAGS_NONE, 2000, nullptr, error);
        }
        void restart()
        {
            stop = true;
            g_main_context_wakeup(context);
            thread.join();
            g_dbus_connection_close_sync(client, nullptr, nullptr);
            g_object_unref(client);
            g_subprocess_force_exit(process);
            g_subprocess_wait(process, nullptr, nullptr);
            g_object_unref(process);
            // A bus address without a GUID may reconnect to a restarted daemon.
            launch();
            stop = false;
            ready = false;
            ownsService = true;
            thread = std::thread([this] { serve(); });
            REQUIRE(eventually([&] { return ready.load(); }));
            client = connect();
            REQUIRE(client != nullptr);
        }
        struct Event
        {
            std::string sender;
            std::string path;
            std::string member;
            std::string signature;
            std::string payload;
        };
        std::vector<Event> takeEvents()
        {
            const std::scoped_lock lock(mutex);
            return std::exchange(events, {});
        }
        std::vector<std::string> discoveryClients()
        {
            const std::scoped_lock lock(mutex);
            return discoveries;
        }
        void service(bool enabled) { serviceEnabled = enabled; }
        std::string address;

    private:
        void launch()
        {
            const std::string option = "--address=" + address;
            process = g_subprocess_new(G_SUBPROCESS_FLAGS_STDOUT_PIPE, nullptr, "dbus-daemon", "--session", "--nofork",
                                       option.c_str(), "--print-address=1", nullptr);
            REQUIRE(process != nullptr);
            auto* input = g_data_input_stream_new(g_subprocess_get_stdout_pipe(process));
            char* line = g_data_input_stream_read_line(input, nullptr, nullptr, nullptr);
            REQUIRE(line != nullptr);
            g_free(line);
            g_object_unref(input);
        }
        static void embed(GDBusConnection*, const gchar*, const gchar*, const gchar*, const gchar*, GVariant* args,
                          GDBusMethodInvocation* invocation, gpointer data)
        {
            auto& self = *static_cast<Bus*>(data);
            const char* bus = nullptr;
            const char* path = nullptr;
            g_variant_get(args, "((&s&o))", &bus, &path);
            CHECK(std::string(path) == "/org/a11y/atspi/accessible/root");
            {
                const std::scoped_lock lock(self.mutex);
                self.apps.emplace_back(bus);
            }
            g_dbus_method_invocation_return_value(
                invocation, g_variant_new("((so))", "org.a11y.atspi.Registry", "/org/a11y/atspi/accessible/root"));
        }
        static void getAddress(GDBusConnection*, const gchar* sender, const gchar*, const gchar*, const gchar*,
                               GVariant*, GDBusMethodInvocation* invocation, gpointer data)
        {
            auto& self = *static_cast<Bus*>(data);
            {
                const std::scoped_lock lock(self.mutex);
                self.discoveries.emplace_back(sender);
            }
            g_dbus_method_invocation_return_value(invocation, g_variant_new("(s)", self.address.c_str()));
        }
        static void notification(GDBusConnection*, const gchar* sender, const gchar* path, const gchar*,
                                 const gchar* member, GVariant* args, gpointer data)
        {
            auto& self = *static_cast<Bus*>(data);
            char* printed = g_variant_print(args, TRUE);
            const std::scoped_lock lock(self.mutex);
            self.events.push_back({ sender, path, member, g_variant_get_type_string(args), printed });
            g_free(printed);
        }
        static gboolean updateService(gpointer data)
        {
            auto& self = *static_cast<Bus*>(data);
            if (self.ownsService != self.serviceEnabled)
            {
                const bool enabled = self.serviceEnabled;
                auto* response =
                    g_dbus_connection_call_sync(self.server, "org.freedesktop.DBus", "/org/freedesktop/DBus",
                                                "org.freedesktop.DBus", enabled ? "RequestName" : "ReleaseName",
                                                enabled ? g_variant_new("(su)", "org.a11y.atspi.Registry", 0U)
                                                        : g_variant_new("(s)", "org.a11y.atspi.Registry"),
                                                G_VARIANT_TYPE("(u)"), G_DBUS_CALL_FLAGS_NONE, 1000, nullptr, nullptr);
                if (response != nullptr)
                    g_variant_unref(response);
                self.ownsService = enabled;
            }
            return G_SOURCE_CONTINUE;
        }
        void serve()
        {
            g_main_context_push_thread_default(context);
            server = connect();
            if (server == nullptr)
                return;
            auto* reply = g_dbus_connection_call_sync(
                server, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
                g_variant_new("(su)", "org.a11y.atspi.Registry", 0U), G_VARIANT_TYPE("(u)"), G_DBUS_CALL_FLAGS_NONE,
                1000, nullptr, nullptr);
            if (reply != nullptr)
                g_variant_unref(reply);
            auto* info =
                g_dbus_node_info_new_for_xml("<node><interface name='org.a11y.atspi.Socket'><method name='Embed'>"
                                             "<arg type='(so)' direction='in'/><arg type='(so)' direction='out'/>"
                                             "</method></interface></node>",
                                             nullptr);
            static const GDBusInterfaceVTable vtable { embed, nullptr, nullptr, {} };
            const auto registration = g_dbus_connection_register_object(
                server, "/org/a11y/atspi/accessible/root", info->interfaces[0], &vtable, this, nullptr, nullptr);
            auto* discoveryReply = g_dbus_connection_call_sync(
                server, "org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus", "RequestName",
                g_variant_new("(su)", "org.a11y.Bus", 0U), G_VARIANT_TYPE("(u)"), G_DBUS_CALL_FLAGS_NONE, 1000, nullptr,
                nullptr);
            if (discoveryReply != nullptr)
                g_variant_unref(discoveryReply);
            auto* discoveryInfo =
                g_dbus_node_info_new_for_xml("<node><interface name='org.a11y.Bus'><method name='GetAddress'>"
                                             "<arg type='s' direction='out'/></method></interface></node>",
                                             nullptr);
            static const GDBusInterfaceVTable discoveryVtable { getAddress, nullptr, nullptr, {} };
            const auto discoveryRegistration = g_dbus_connection_register_object(
                server, "/org/a11y/bus", discoveryInfo->interfaces[0], &discoveryVtable, this, nullptr, nullptr);
            const auto watch =
                g_dbus_connection_signal_subscribe(server, nullptr, nullptr, nullptr, nullptr, nullptr,
                                                   G_DBUS_SIGNAL_FLAGS_NONE, notification, this, nullptr);
            auto* timer = g_timeout_source_new(10);
            g_source_set_callback(timer, updateService, this, nullptr);
            g_source_attach(timer, context);
            ready = true;
            while (! stop)
                g_main_context_iteration(context, TRUE);
            g_source_destroy(timer);
            g_source_unref(timer);
            g_dbus_connection_signal_unsubscribe(server, watch);
            g_dbus_connection_unregister_object(server, registration);
            g_dbus_connection_unregister_object(server, discoveryRegistration);
            g_dbus_node_info_unref(discoveryInfo);
            g_dbus_node_info_unref(info);
            g_dbus_connection_close_sync(server, nullptr, nullptr);
            g_object_unref(server);
            g_main_context_pop_thread_default(context);
        }
        std::string directory;
        GSubprocess* process = nullptr;
        GDBusConnection* client = nullptr;
        GDBusConnection* server = nullptr;
        std::atomic<bool> serviceEnabled { true };
        bool ownsService = true;
        GMainContext* context = nullptr;
        std::thread thread;
        std::atomic<bool> ready { false };
        std::atomic<bool> stop { false };
        std::mutex mutex;
        std::vector<std::string> apps;
        std::vector<std::string> discoveries;
        std::vector<Event> events;
    };

    std::string printed(Bus& bus, const std::string& app, const char* path, const char* interface, const char* method,
                        GVariant* args = nullptr, const GVariantType* type = nullptr)
    {
        GError* error = nullptr;
        auto* reply = bus.call(app, path, interface, method, args, type, &error);
        REQUIRE_MESSAGE(reply != nullptr, (error == nullptr ? "missing reply" : error->message));
        char* text = g_variant_print(reply, FALSE);
        const std::string result = text;
        g_free(text);
        g_variant_unref(reply);
        g_clear_error(&error);
        return result;
    }

    TreeUpdate example()
    {
        Node root;
        root.id = 10;
        root.role = Role::View;
        root.children = { 11 };
        root.bounds = { 0, 0, 300, 200 };
        Node gain;
        gain.id = 11;
        gain.role = Role::Adjustable;
        gain.label = "Gain";
        gain.hint = "Output level";
        gain.value = { -60, 12, -3.5, "-3.5 dB" };
        gain.focusable = true;
        gain.bounds = { 10, 20, 40, 50 };
        gain.actions = { { Action::Increment, "increment", "Increase gain" }, { Action::SetValue, "setValue", "" } };
        return { { root, gain }, {}, 10, 11, true };
    }
} // namespace

TEST_SUITE("Linux AT-SPI")
{
    TEST_CASE("role, state and geometry wire mappings")
    {
        CHECK(atspi::role(Role::Adjustable).value == 51);
        CHECK(atspi::role(Role::Text).value == 116);
        CHECK(atspi::role(Role::Dialog).value == 16);
        CHECK(atspi::role(Role::ListBox).value == 98);
        CHECK(atspi::role(Role::Option).value == 32);
        auto update = example();
        Node& node = update.nodes[1];
        node.state.checked = Checked::Mixed;
        node.state.disabled = true;
        node.state.selected = true;
        node.modal = true;
        const auto state = atspi::states(node, true, false);
        CHECK((state[0] & (1U << 8)) == 0);
        CHECK((state[0] & (1U << 12)) != 0);
        CHECK((state[0] & (1U << 16)) != 0);
        CHECK((state[0] & (1U << 23)) != 0);
        CHECK((state[1] & 1U) != 0);
        Tree tree;
        tree.apply(update);
        const ViewGeometry geometry { 5, 7, 2, { 100, 200, 600, 400 } };
        CHECK(atspi::bounds(node, tree, geometry, 0) == Rect { 120, 240, 80, 100 });
        CHECK(atspi::bounds(node, tree, geometry, 1) == Rect { 25, 47, 80, 100 });
        CHECK(atspi::bounds(node, tree, geometry, 2) == Rect { 20, 40, 80, 100 });
    }
    TEST_CASE("private registration, object references and cache serialization")
    {
        Bus bus;
        atspi::Session session("Test plugin", bus.address);
        session.update(example(), {}, true);
        REQUIRE(eventually([&] { return session.active(); }));
        const auto apps = bus.applications();
        REQUIRE(apps.size() == 1);
        auto* reply = bus.call(apps[0], "/org/a11y/atspi/accessible/root", "org.a11y.atspi.Accessible", "GetChildren",
                               nullptr, G_VARIANT_TYPE("(a(so))"));
        REQUIRE(reply != nullptr);
        auto* children = g_variant_get_child_value(reply, 0);
        CHECK(g_variant_n_children(children) == 1);
        g_variant_unref(children);
        g_variant_unref(reply);
        reply = bus.call(apps[0], "/org/a11y/atspi/cache", "org.a11y.atspi.Cache", "GetItems", nullptr,
                         G_VARIANT_TYPE("(a((so)(so)(so)iiassusau))"));
        REQUIRE(reply != nullptr);
        auto* items = g_variant_get_child_value(reply, 0);
        CHECK(g_variant_n_children(items) == 3);
        g_variant_unref(items);
        g_variant_unref(reply);
        GError* error = nullptr;
        reply = bus.call(apps[0], "/org/a11y/atspi/accessible/n11", "org.a11y.atspi.Accessible", "GetChildAtIndex",
                         g_variant_new("(i)", -1), nullptr, &error);
        CHECK(reply == nullptr);
        REQUIRE(error != nullptr);
        CHECK(g_error_matches(error, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS));
        g_error_free(error);
    }
    TEST_CASE("multiple editors have independent connections and shutdown")
    {
        Bus bus;
        atspi::Session second("Second", bus.address);
        {
            atspi::Session first("First", bus.address);
            first.update(example(), {}, false);
            second.update(example(), {}, false);
            REQUIRE(eventually([&] { return first.active() && second.active(); }));
            const auto apps = bus.applications();
            REQUIRE(apps.size() == 2);
            CHECK(apps[0] != apps[1]);
        }
        CHECK(second.active());
        for (int i = 0; i < 10; ++i)
        {
            atspi::Session temporary("Closing", bus.address);
            temporary.update(example(), {}, false);
            REQUIRE(eventually([&] { return temporary.active(); }));
        }
    }
    TEST_CASE("missing service and closing pending connections are safe")
    {
        for (int i = 0; i < 10; ++i)
        {
            atspi::Session session("Unavailable", "unix:path=/tmp/soundor-nonexistent-atspi-bus");
            session.update(example(), {}, false);
            std::this_thread::sleep_for(std::chrono::milliseconds(30));
            CHECK_FALSE(session.active());
        }
    }
    TEST_CASE("actions are queued, value writes validated and stale identities rejected")
    {
        Bus bus;
        atspi::Session session("Actions", bus.address);
        auto update = example();
        update.nodes[1].actions.push_back({ Action::Custom, "reset", "Reset gain" });
        update.nodes[1].actions.push_back({ Action::Focus, "focus", "" });
        session.update(update, { 5, 7, 2, { 100, 200, 600, 400 } }, true);
        REQUIRE(eventually([&] { return session.active(); }));
        const auto app = bus.applications().front();
        constexpr auto path = "/org/a11y/atspi/accessible/n11";
        CHECK(
            printed(bus, app, path, "org.a11y.atspi.Action", "DoAction", g_variant_new("(i)", 0), G_VARIANT_TYPE("(b)"))
            == "(true,)");
        auto requests = session.takeRequests();
        REQUIRE(requests.size() == 1);
        CHECK(requests[0].target == 11);
        CHECK(requests[0].action == Action::Increment);
        CHECK(printed(bus, app, path, "org.a11y.atspi.Action", "DoAction", g_variant_new("(i)", 1)) == "(true,)");
        requests = session.takeRequests();
        REQUIRE(requests.size() == 1);
        CHECK(requests[0].action == Action::Custom);
        CHECK(requests[0].name == "reset");
        CHECK(printed(bus, app, path, "org.a11y.atspi.Component", "GrabFocus") == "(true,)");
        requests = session.takeRequests();
        REQUIRE(requests.size() == 1);
        CHECK(requests[0].action == Action::Focus);
        CHECK(printed(bus, app, path, "org.a11y.atspi.Component", "GetExtents", g_variant_new("(u)", 0U),
                      G_VARIANT_TYPE("((iiii))"))
              == "((120, 240, 80, 100),)");
        CHECK(printed(bus, app, path, "org.freedesktop.DBus.Properties", "Set",
                      g_variant_new("(ssv)", "org.a11y.atspi.Value", "CurrentValue", g_variant_new_double(-6)),
                      G_VARIANT_TYPE("()"))
              == "()");
        requests = session.takeRequests();
        REQUIRE(requests.size() == 1);
        CHECK(requests[0].action == Action::SetValue);
        CHECK(std::get<double>(requests[0].value) == -6);
        GError* error = nullptr;
        auto* reply = bus.call(
            app, path, "org.freedesktop.DBus.Properties", "Set",
            g_variant_new("(ssv)", "org.a11y.atspi.Value", "CurrentValue", g_variant_new_double(100)), nullptr, &error);
        CHECK(reply == nullptr);
        REQUIRE(error != nullptr);
        g_error_free(error);
        CHECK(session.takeRequests().empty());
        // A new full snapshot rejects requests made against the old generation.
        session.update(example(), {}, true);
        CHECK(session.takeRequests().empty());
        Node root = update.nodes[0];
        root.children.clear();
        session.update({ { root }, { 11 }, 10, 10, false }, {}, true);
        REQUIRE(eventually(
            [&]
            {
                GError* stale = nullptr;
                auto* response =
                    bus.call(app, path, "org.a11y.atspi.Action", "DoAction", g_variant_new("(i)", 0), nullptr, &stale);
                const bool missing = response == nullptr;
                if (response != nullptr)
                    g_variant_unref(response);
                g_clear_error(&stale);
                static_cast<void>(session.takeRequests());
                return missing;
            }));
    }

    TEST_CASE("focus-only updates, states, values, children and geometry send protocol events")
    {
        Bus bus;
        atspi::Session session("Events", bus.address);
        auto update = example();
        session.update(update, {}, true);
        REQUIRE(eventually([&] { return session.active(); }));
        bus.takeEvents();
        // No changed nodes. This is the shape SurfaceSemantics emits on focus.
        session.update({ {}, {}, 10, 10, false }, {}, true);
        std::vector<Bus::Event> notifications;
        REQUIRE(eventually(
            [&]
            {
                auto next = bus.takeEvents();
                notifications.insert(notifications.end(), next.begin(), next.end());
                return std::ranges::any_of(notifications,
                                           [](const auto& event)
                                           {
                                               return event.member == "StateChanged" && event.path.ends_with("n11")
                                                      && event.payload.find("'focused', 0") != std::string::npos;
                                           });
            }));
        for (const auto& event : notifications)
            if (event.member == "StateChanged")
                CHECK(event.signature == "(siiva{sv})");
        update.full = false;
        update.nodes[1].value.now = -9;
        update.nodes[1].state.disabled = true;
        update.nodes[1].state.busy = true;
        update.nodes[1].state.expanded = true;
        update.nodes[1].state.selected = true;
        update.nodes[1].state.checked = Checked::Mixed;
        update.focus = 10;
        session.update(update, { 0, 0, 2, { 100, 200, 600, 400 } }, true);
        notifications.clear();
        REQUIRE(eventually(
            [&]
            {
                auto next = bus.takeEvents();
                notifications.insert(notifications.end(), next.begin(), next.end());
                return std::ranges::any_of(notifications, [](const auto& event)
                                           { return event.member == "BoundsChanged" && event.path.ends_with("n11"); });
            }));
        CHECK(std::ranges::any_of(notifications,
                                  [](const auto& event) {
                                      return event.member == "PropertyChange"
                                             && event.payload.find("accessible-value") != std::string::npos;
                                  }));
        CHECK(std::ranges::any_of(
            notifications, [](const auto& event)
            { return event.member == "StateChanged" && event.payload.find("'busy', 1") != std::string::npos; }));
        CHECK(printed(bus, bus.applications().front(), "/org/a11y/atspi/accessible/n11", "org.a11y.atspi.Action",
                      "DoAction", g_variant_new("(i)", 0))
              == "(false,)");
        CHECK(session.takeRequests().empty());
        Node root = update.nodes[0];
        root.children.clear();
        session.update({ { root }, { 11 }, 10, 10, false }, {}, true);
        notifications.clear();
        REQUIRE(eventually(
            [&]
            {
                auto next = bus.takeEvents();
                notifications.insert(notifications.end(), next.begin(), next.end());
                return std::ranges::any_of(
                    notifications, [](const auto& event)
                    { return event.member == "ChildrenChanged" && event.payload.find("remove") != std::string::npos; });
            }));
        CHECK(std::ranges::any_of(notifications, [](const auto& event)
                                  { return event.member == "RemoveAccessible" && event.signature == "((so))"; }));
    }

    TEST_CASE("key shortcuts are an attribute, and announcements object:announcement events")
    {
        Bus bus;
        atspi::Session session("Shortcuts", bus.address);
        auto update = example();
        update.nodes[1].keyShortcuts = "Control+Shift+S";
        session.update(update, {}, true);
        REQUIRE(eventually([&] { return session.active(); }));
        const auto app = bus.applications().front();
        const std::string attributes = printed(bus, app, "/org/a11y/atspi/accessible/n11", "org.a11y.atspi.Accessible",
                                               "GetAttributes", nullptr, G_VARIANT_TYPE("(a{ss})"));
        CHECK(attributes.find("'keyshortcuts': 'Control+Shift+S'") != std::string::npos);
        bus.takeEvents();
        session.announce({ { "Preset copied", Priority::Polite }, { "Clipping", Priority::Assertive } });
        std::vector<Bus::Event> notifications;
        REQUIRE(eventually(
            [&]
            {
                auto next = bus.takeEvents();
                notifications.insert(notifications.end(), next.begin(), next.end());
                return std::ranges::count(notifications, "Announcement", &Bus::Event::member) == 2;
            }));
        std::vector<Bus::Event> spoken;
        std::ranges::copy_if(notifications, std::back_inserter(spoken),
                             [](const auto& event) { return event.member == "Announcement"; });
        // From the focused element; ATSPI_LIVE_POLITE, then ATSPI_LIVE_ASSERTIVE.
        CHECK(spoken[0].path.ends_with("n11"));
        CHECK(spoken[0].signature == "(siiva{sv})");
        CHECK(spoken[0].payload.find("('', 1, 0, <'Preset copied'>") != std::string::npos);
        CHECK(spoken[1].payload.find("('', 2, 0, <'Clipping'>") != std::string::npos);
    }

    TEST_CASE("text values use Unicode offsets without inventing caret or selection data")
    {
        Bus bus;
        atspi::Session session("Text", bus.address);
        auto update = example();
        update.nodes[1].role = Role::TextInput;
        update.nodes[1].value = { {}, {}, {}, "h\xc3\xa9\xf0\x9f\x8e\xb5" };
        session.update(update, {}, true);
        REQUIRE(eventually([&] { return session.active(); }));
        const auto app = bus.applications().front();
        constexpr auto path = "/org/a11y/atspi/accessible/n11";
        CHECK(printed(bus, app, path, "org.a11y.atspi.Text", "GetText", g_variant_new("(ii)", 0, -1),
                      G_VARIANT_TYPE("(s)"))
              == "('h\xc3\xa9\xf0\x9f\x8e\xb5',)");
        CHECK(printed(bus, app, path, "org.a11y.atspi.Text", "GetCharacterAtOffset", g_variant_new("(i)", 2))
              == "(127925,)");
        CHECK(printed(bus, app, path, "org.a11y.atspi.EditableText", "SetTextContents", g_variant_new("(s)", "Preset"))
              == "(true,)");
        auto requests = session.takeRequests();
        REQUIRE(requests.size() == 1);
        CHECK(std::get<std::string>(requests[0].value) == "Preset");
        GError* error = nullptr;
        auto* reply =
            bus.call(app, path, "org.a11y.atspi.Text", "GetText", g_variant_new("(ii)", 0, 4), nullptr, &error);
        CHECK(reply == nullptr);
        REQUIRE(error != nullptr);
        g_error_free(error);
    }

    TEST_CASE("registry restart re-registers without disturbing another editor")
    {
        Bus bus;
        atspi::Session first("First", bus.address);
        atspi::Session second("Second", bus.address);
        first.update(example(), {}, true);
        second.update(example(), {}, false);
        REQUIRE(eventually([&] { return first.active() && second.active(); }));
        bus.service(false);
        REQUIRE(eventually([&] { return ! first.active() && ! second.active(); }));
        bus.service(true);
        REQUIRE(eventually([&] { return first.active() && second.active(); }));
        const auto apps = bus.applications();
        CHECK(apps.size() >= 4);
    }

    TEST_CASE("modal and portal relationships come from SurfaceSemantics unchanged")
    {
        test::WebFixture fixture;
        fixture.run(R"(
            import { root, overlayRoot, createView, createText } from 'soundor:ui';
            root.appendChild(createText('Background'));
            const modal = createView();
            modal.accessibility = { modal: true, role: 'dialog', label: 'Settings' };
            overlayRoot.appendChild(modal);
            const menu = createView();
            menu.accessibility = { role: 'menu', label: 'Presets' };
            menu.accessibilityParent = modal;
            overlayRoot.appendChild(menu);
        )");
        auto update = fixture.host.accessibility().update(true);
        REQUIRE(std::ranges::none_of(update.nodes, [](const Node& node) { return node.label == "Background"; }));
        const auto modal =
            std::ranges::find_if(update.nodes, [](const Node& node) { return node.label == "Settings"; });
        const auto menu = std::ranges::find_if(update.nodes, [](const Node& node) { return node.label == "Presets"; });
        REQUIRE(modal != update.nodes.end());
        REQUIRE(menu != update.nodes.end());
        CHECK(std::ranges::find(modal->children, menu->id) != modal->children.end());
        Bus bus;
        atspi::Session session("Modal", bus.address);
        session.update(update, {}, true);
        REQUIRE(eventually([&] { return session.active(); }));
        const auto app = bus.applications().front();
        const std::string path = "/org/a11y/atspi/accessible/n" + std::to_string(menu->id);
        const auto parent = printed(bus, app, path.c_str(), "org.freedesktop.DBus.Properties", "Get",
                                    g_variant_new("(ss)", "org.a11y.atspi.Accessible", "Parent"));
        CHECK(parent.find("/org/a11y/atspi/accessible/n" + std::to_string(modal->id)) != std::string::npos);
    }
    TEST_CASE("closing during D-Bus authentication cancels without waiting for the peer")
    {
        GError* error = nullptr;
        char* directory = g_dir_make_tmp("soundor-atspi-XXXXXX", &error);
        REQUIRE(directory != nullptr);
        const std::string socketPath = std::string(directory) + "/bus";
        auto* listener = g_socket_listener_new();
        auto* socketAddress = g_unix_socket_address_new(socketPath.c_str());
        REQUIRE(g_socket_listener_add_address(listener, socketAddress, G_SOCKET_TYPE_STREAM, G_SOCKET_PROTOCOL_DEFAULT,
                                              nullptr, nullptr, &error));
        g_object_unref(socketAddress);
        const auto started = std::chrono::steady_clock::now();
        {
            atspi::Session session("Pending authentication", "unix:path=" + socketPath);
            // The listener accepts no authentication data. Shutdown must cancel
            // the outstanding GDBusConnection construction, then drain it.
            std::this_thread::sleep_for(std::chrono::milliseconds(50));
        }
        CHECK(std::chrono::steady_clock::now() - started < std::chrono::seconds(1));
        g_socket_listener_close(listener);
        g_object_unref(listener);
        g_unlink(socketPath.c_str());
        g_rmdir(directory);
        g_free(directory);
        g_clear_error(&error);
    }
    TEST_CASE("bus disconnection reconnects with a full mirror on independent private connections")
    {
        Bus bus;
        atspi::Session first("First", bus.address);
        atspi::Session second("Second", bus.address);
        first.update(example(), {}, true);
        second.update(example(), {}, false);
        REQUIRE(eventually([&] { return first.active() && second.active(); }));
        bus.restart();
        REQUIRE(eventually([&] { return bus.applications().size() >= 4 && first.active() && second.active(); }));
        const auto apps = bus.applications();
        CHECK(apps[apps.size() - 1] != apps[apps.size() - 2]);
        const auto items = printed(bus, apps.back(), "/org/a11y/atspi/cache", "org.a11y.atspi.Cache", "GetItems",
                                   nullptr, G_VARIANT_TYPE("(a((so)(so)(so)iiassusau))"));
        CHECK(items.find("Gain") != std::string::npos);
    }
    TEST_CASE("accessibility-bus discovery uses a separate private session connection")
    {
        Bus bus;
        atspi::Session session("Discovery", {}, bus.address);
        session.update(example(), {}, true);
        REQUIRE(eventually([&] { return session.active(); }));
        const auto clients = bus.discoveryClients();
        const auto apps = bus.applications();
        REQUIRE(clients.size() == 1);
        REQUIRE(apps.size() == 1);
        CHECK(clients[0] != apps[0]);
        CHECK(printed(bus, apps[0], "/org/a11y/atspi/accessible/root", "org.freedesktop.DBus.Properties", "Set",
                      g_variant_new("(ssv)", "org.a11y.atspi.Application", "Id", g_variant_new_int32(42)))
              == "()");
        CHECK(printed(bus, apps[0], "/org/a11y/atspi/accessible/root", "org.freedesktop.DBus.Properties", "Get",
                      g_variant_new("(ss)", "org.a11y.atspi.Application", "Id"))
                  .find("42")
              != std::string::npos);
    }

    TEST_CASE("a full reset replaces the root, retires old objects and refreshes the cache")
    {
        Bus bus;
        atspi::Session session("Reset", bus.address);
        session.update(example(), {}, true);
        REQUIRE(eventually([&] { return session.active(); }));
        const auto app = bus.applications()[0];
        auto replacement = example();
        replacement.root = 20;
        replacement.focus = 21;
        replacement.nodes[0].id = 20;
        replacement.nodes[0].children = { 21 };
        replacement.nodes[1].id = 21;
        replacement.nodes[1].label = "Replacement";
        session.update(replacement, {}, true);
        REQUIRE(eventually(
            [&]
            {
                GError* error = nullptr;
                auto* reply = bus.call(app, "/org/a11y/atspi/accessible/n11", "org.a11y.atspi.Accessible", "GetRole",
                                       nullptr, nullptr, &error);
                const bool removed = reply == nullptr;
                if (reply != nullptr)
                    g_variant_unref(reply);
                g_clear_error(&error);
                return removed;
            }));
        const auto cache = printed(bus, app, "/org/a11y/atspi/cache", "org.a11y.atspi.Cache", "GetItems", nullptr,
                                   G_VARIANT_TYPE("(a((so)(so)(so)iiassusau))"));
        CHECK(cache.find("Replacement") != std::string::npos);
        CHECK(cache.find("Gain") == std::string::npos);
        const auto children =
            printed(bus, app, "/org/a11y/atspi/accessible/root", "org.a11y.atspi.Accessible", "GetChildren");
        CHECK(children.find("/org/a11y/atspi/accessible/n20") != std::string::npos);
        CHECK(session.takeRequests().empty());
    }
    TEST_CASE("reparenting without a node-data change refreshes the child parent and cache")
    {
        Bus bus;
        atspi::Session session("Reparent", bus.address);
        auto initial = example();
        Node group;
        group.id = 12;
        group.label = "Group";
        initial.nodes[0].children.push_back(group.id);
        initial.nodes.push_back(group);
        session.update(initial, {}, true);
        REQUIRE(eventually([&] { return session.active(); }));
        bus.takeEvents();
        Node root = initial.nodes[0];
        root.children = { group.id };
        group.children = { 11 };
        // The gain node's own data and frame are unchanged: only the parents
        // appear in this incremental update.
        session.update({ { root, group }, {}, 10, 11, false }, {}, true);
        std::vector<Bus::Event> notifications;
        REQUIRE(eventually(
            [&]
            {
                auto next = bus.takeEvents();
                notifications.insert(notifications.end(), next.begin(), next.end());
                return std::ranges::any_of(notifications,
                                           [](const auto& event)
                                           {
                                               return event.member == "AddAccessible"
                                                      && event.payload.find("n11") != std::string::npos
                                                      && event.payload.find("n12") != std::string::npos;
                                           });
            }));
        const auto parent = printed(bus, bus.applications().front(), "/org/a11y/atspi/accessible/n11",
                                    "org.freedesktop.DBus.Properties", "Get",
                                    g_variant_new("(ss)", "org.a11y.atspi.Accessible", "Parent"));
        CHECK(parent.find("/org/a11y/atspi/accessible/n12") != std::string::npos);
        CHECK(std::ranges::any_of(notifications,
                                  [](const auto& event)
                                  {
                                      return event.member == "PropertyChange" && event.path.ends_with("n11")
                                             && event.payload.find("accessible-parent") != std::string::npos;
                                  }));
    }
}
