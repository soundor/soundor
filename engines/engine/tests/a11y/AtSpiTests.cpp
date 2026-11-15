#include "a11y/linux/AtSpi.h"
#include "a11y/linux/Mapping.h"

#include <doctest/doctest.h>
#include <gio/gio.h>

#include <atomic>
#include <chrono>
#include <functional>
#include <mutex>
#include <string>
#include <thread>
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
            process = g_subprocess_new(G_SUBPROCESS_FLAGS_STDOUT_PIPE, nullptr, "dbus-daemon", "--session", "--nofork",
                                       "--print-address=1", nullptr);
            REQUIRE(process != nullptr);
            auto* input = g_data_input_stream_new(g_subprocess_get_stdout_pipe(process));
            char* line = g_data_input_stream_read_line(input, nullptr, nullptr, nullptr);
            REQUIRE(line != nullptr);
            address = line;
            g_free(line);
            g_object_unref(input);
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
        std::string address;

    private:
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
        void serve()
        {
            g_main_context_push_thread_default(context);
            auto* server = connect();
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
            ready = true;
            while (! stop)
                g_main_context_iteration(context, TRUE);
            g_dbus_connection_unregister_object(server, registration);
            g_dbus_node_info_unref(info);
            g_dbus_connection_close_sync(server, nullptr, nullptr);
            g_object_unref(server);
            g_main_context_pop_thread_default(context);
        }
        GSubprocess* process = nullptr;
        GDBusConnection* client = nullptr;
        GMainContext* context = nullptr;
        std::thread thread;
        std::atomic<bool> ready { false };
        std::atomic<bool> stop { false };
        std::mutex mutex;
        std::vector<std::string> apps;
    };

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
        }
    }
    TEST_CASE("missing service and closing pending connections are safe")
    {
        for (int i = 0; i < 10; ++i)
        {
            atspi::Session session("Unavailable", "unix:path=/tmp/soundor-nonexistent-atspi-bus");
            session.update(example(), {}, false);
            CHECK_FALSE(session.active());
        }
    }
}
