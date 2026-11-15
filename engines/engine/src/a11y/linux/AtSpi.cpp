#include "a11y/linux/AtSpi.h"

#include "a11y/linux/Interfaces.h"
#include "a11y/linux/Mapping.h"

#include <gio/gio.h>

#include <algorithm>
#include <atomic>
#include <charconv>
#include <cmath>
#include <limits>
#include <mutex>
#include <thread>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
{
    namespace
    {
        constexpr auto rootPath = "/org/a11y/atspi/accessible/root";
        constexpr auto cachePath = "/org/a11y/atspi/cache";
        constexpr auto nullPath = "/org/a11y/atspi/null";
        constexpr auto registry = "org.a11y.atspi.Registry";
        constexpr auto accessible = "org.a11y.atspi.Accessible";
        constexpr auto application = "org.a11y.atspi.Application";
        constexpr auto component = "org.a11y.atspi.Component";
        constexpr auto actionInterface = "org.a11y.atspi.Action";
        constexpr auto valueInterface = "org.a11y.atspi.Value";
        constexpr auto cacheInterface = "org.a11y.atspi.Cache";

        std::string pathOf(NodeId id)
        {
            return id == noNode ? rootPath : "/org/a11y/atspi/accessible/n" + std::to_string(id);
        }

        NodeId idOf(std::string_view path)
        {
            constexpr std::string_view prefix = "/org/a11y/atspi/accessible/n";
            NodeId result = noNode;
            if (! path.starts_with(prefix))
                return noNode;
            path.remove_prefix(prefix.size());
            const auto parsed = std::from_chars(path.data(), path.data() + path.size(), result);
            return parsed.ec == std::errc {} && parsed.ptr == path.data() + path.size() ? result : noNode;
        }

        std::vector<const char*> interfaces(const Node& node, bool app)
        {
            std::vector<const char*> result { accessible };
            if (app)
                result.push_back(application);
            else
            {
                result.push_back(component);
                if (! node.actions.empty())
                    result.push_back(actionInterface);
                if (node.value.now)
                    result.push_back(valueInterface);
            }
            return result;
        }

        GVariant* stringArray(const std::vector<const char*>& strings)
        {
            return g_variant_new_strv(strings.data(), static_cast<gssize>(strings.size()));
        }

        GVariant* stateArray(const Node& node, bool focus, bool active)
        {
            const auto bits = states(node, focus, active);
            return g_variant_new_fixed_array(G_VARIANT_TYPE_UINT32, bits.data(), bits.size(), sizeof(std::uint32_t));
        }
    } // namespace

    class Session::Impl
    {
    public:
        Impl(std::string label, std::string busAddress)
            : name(std::move(label)),
              address(std::move(busAddress)),
              context(g_main_context_new()),
              cancel(g_cancellable_new()),
              worker([this] { run(); })
        {
        }

        ~Impl()
        {
            closing = true;
            g_cancellable_cancel(cancel);
            g_main_context_wakeup(context);
            worker.join();
            g_object_unref(cancel);
            g_main_context_unref(context);
        }

        Impl(const Impl&) = delete;
        Impl& operator=(const Impl&) = delete;

        struct Update
        {
            TreeUpdate tree;
            ViewGeometry geometry;
            bool focused;
        };

        void update(TreeUpdate update, ViewGeometry nextGeometry, bool focused)
        {
            const std::scoped_lock lock(mutex);
            updates.push_back({ std::move(update), nextGeometry, focused });
            g_main_context_wakeup(context);
        }

        std::vector<ActionRequest> takeRequests()
        {
            const std::scoped_lock lock(mutex);
            return std::exchange(requests, {});
        }

        [[nodiscard]] bool active() const { return registered; }

    private:
        void run()
        {
            g_main_context_push_thread_default(context);
            metadata = g_dbus_node_info_new_for_xml(introspection, nullptr);
            // Our source, attached to our context: the DAW needs no GLib loop.
            GSource* timer = g_timeout_source_new(20);
            g_source_set_callback(timer, pulse, this, nullptr);
            g_source_attach(timer, context);
            while (! closing)
                g_main_context_iteration(context, TRUE);
            disconnect();
            // Cancellable async operations always complete on this context.
            // Drain them before any callback code or userdata can disappear.
            while (pending != 0)
                g_main_context_iteration(context, TRUE);
            g_source_destroy(timer);
            g_source_unref(timer);
            g_dbus_node_info_unref(metadata);
            g_main_context_pop_thread_default(context);
        }

        static gboolean pulse(gpointer data)
        {
            auto& self = *static_cast<Impl*>(data);
            if (! self.closing)
                self.poll();
            return G_SOURCE_CONTINUE;
        }

        void poll()
        {
            std::vector<Update> next;
            {
                const std::scoped_lock lock(mutex);
                next.swap(updates);
            }
            for (const Update& update : next)
                apply(update);
            if (connection != nullptr && g_dbus_connection_is_closed(connection))
                disconnect();
            const auto now = g_get_monotonic_time();
            if (now < retryAt || pending != 0)
                return;
            retryAt = now + G_TIME_SPAN_SECOND;
            if (connection == nullptr)
                connect();
            else if (! registered)
                embed();
        }

        void connect()
        {
            std::string target = address;
            if (target.empty())
            {
                if (const char* provided = g_getenv("AT_SPI_BUS_ADDRESS"))
                    target = provided;
            }
            if (! target.empty())
                open(target, false);
            else
            {
                GError* error = nullptr;
                char* sessionAddress = g_dbus_address_get_for_bus_sync(G_BUS_TYPE_SESSION, cancel, &error);
                if (sessionAddress != nullptr)
                {
                    open(sessionAddress, true);
                    g_free(sessionAddress);
                }
                g_clear_error(&error);
            }
        }

        void open(const std::string& target, bool session)
        {
            discovering = session;
            ++pending;
            g_dbus_connection_new_for_address(
                target.c_str(),
                // GIO defines this C enum as combinable flags. Clang 18 rejects valid combinations.
                // NOLINTNEXTLINE(clang-analyzer-optin.core.EnumCastOutOfRange)
                static_cast<GDBusConnectionFlags>(G_DBUS_CONNECTION_FLAGS_AUTHENTICATION_CLIENT
                                                  | G_DBUS_CONNECTION_FLAGS_MESSAGE_BUS_CONNECTION),
                nullptr, cancel, opened, this);
        }

        static void opened(GObject*, GAsyncResult* result, gpointer data)
        {
            auto& self = *static_cast<Impl*>(data);
            --self.pending;
            GError* error = nullptr;
            GDBusConnection* bus = g_dbus_connection_new_for_address_finish(result, &error);
            g_clear_error(&error);
            if (bus == nullptr)
                return;
            g_dbus_connection_set_exit_on_close(bus, FALSE);
            if (self.closing)
            {
                g_dbus_connection_close(bus, nullptr, nullptr, nullptr);
                g_object_unref(bus);
                return;
            }
            if (self.discovering)
            {
                ++self.pending;
                g_dbus_connection_call(bus, "org.a11y.Bus", "/org/a11y/bus", "org.a11y.Bus", "GetAddress", nullptr,
                                       G_VARIANT_TYPE("(s)"), G_DBUS_CALL_FLAGS_NONE, 1000, self.cancel, discovered,
                                       &self);
                // The call holds its source connection until its completion.
                g_object_unref(bus);
                return;
            }
            self.connection = bus;
            self.busName = g_dbus_connection_get_unique_name(bus);
            self.registerObjects();
            self.embed();
        }

        static void discovered(GObject* source, GAsyncResult* result, gpointer data)
        {
            auto& self = *static_cast<Impl*>(data);
            --self.pending;
            GError* error = nullptr;
            GVariant* reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error);
            if (reply != nullptr)
            {
                const char* target = nullptr;
                g_variant_get(reply, "(&s)", &target);
                if (! self.closing && target[0] != '\0')
                    self.open(target, false);
                g_variant_unref(reply);
            }
            g_clear_error(&error);
            g_dbus_connection_close(G_DBUS_CONNECTION(source), nullptr, nullptr, nullptr);
        }

        void embed()
        {
            ++pending;
            g_dbus_connection_call(connection, registry, rootPath, "org.a11y.atspi.Socket", "Embed",
                                   g_variant_new("((so))", busName.c_str(), rootPath), G_VARIANT_TYPE("((so))"),
                                   G_DBUS_CALL_FLAGS_NONE, 1000, cancel, embedded, this);
        }

        static void embedded(GObject* source, GAsyncResult* result, gpointer data)
        {
            auto& self = *static_cast<Impl*>(data);
            --self.pending;
            GError* error = nullptr;
            GVariant* reply = g_dbus_connection_call_finish(G_DBUS_CONNECTION(source), result, &error);
            if (reply != nullptr)
            {
                if (! self.closing && source == G_OBJECT(self.connection))
                {
                    const char* bus = nullptr;
                    const char* path = nullptr;
                    g_variant_get(reply, "((&s&o))", &bus, &path);
                    self.parentBus = bus;
                    self.parentPath = path;
                    self.registered = true;
                }
                g_variant_unref(reply);
            }
            g_clear_error(&error);
        }

        void disconnect()
        {
            registered = false;
            if (connection == nullptr)
                return;
            for (const auto& [id, registrations] : objects)
            {
                static_cast<void>(id);
                for (const guint registration : registrations)
                    g_dbus_connection_unregister_object(connection, registration);
            }
            objects.clear();
            g_dbus_connection_close(connection, nullptr, nullptr, nullptr);
            g_object_unref(connection);
            connection = nullptr;
            parentBus.clear();
            parentPath = nullPath;
        }

        const Node* find(const char* path) const
        {
            if (std::string_view(path) == rootPath)
                return &app;
            const NodeId id = idOf(path);
            return id == noNode ? nullptr : tree.find(id);
        }

        GVariant* reference(NodeId id) const { return g_variant_new("(so)", busName.c_str(), pathOf(id).c_str()); }

        GVariant* nullReference() const { return g_variant_new("(so)", "", nullPath); }

        GVariant* parentReference(const Node& node) const
        {
            if (node.id == noNode)
                return g_variant_new("(so)", parentBus.c_str(), parentPath.c_str());
            return reference(tree.parent(node.id));
        }

        int indexOf(const Node& node) const
        {
            if (node.id == noNode)
                return -1;
            const Node* parent = tree.find(tree.parent(node.id));
            if (parent == nullptr)
                return 0;
            const auto it = std::ranges::find(parent->children, node.id);
            return it == parent->children.end() ? -1 : static_cast<int>(it - parent->children.begin());
        }

        std::vector<NodeId> childrenOf(const Node& node) const
        {
            if (node.id == noNode)
                return tree.find(tree.root()) == nullptr ? std::vector<NodeId> {} : std::vector<NodeId> { tree.root() };
            return node.children;
        }

        std::string nameOf(const Node& node) const
        {
            return node.id == noNode || (node.id == tree.root() && node.label.empty()) ? name : node.label;
        }

        GVariant* cacheItem(const Node& node) const
        {
            return g_variant_new(
                "(@(so)@(so)@(so)ii@assus@au)", reference(node.id), reference(noNode), parentReference(node),
                indexOf(node), static_cast<int>(childrenOf(node).size()),
                stringArray(interfaces(node, node.id == noNode)), nameOf(node).c_str(),
                node.id == noNode ? 75U : role(node.role).value, node.hint.c_str(),
                stateArray(node, windowFocused && node.id == tree.focus(), windowFocused && node.id == tree.root()));
        }

        void registerObject(NodeId id, const Node& node)
        {
            static const GDBusInterfaceVTable vtable { method, property, setProperty, {} };
            auto& registrations = objects[id];
            for (const auto* interface : interfaces(node, id == noNode))
            {
                GError* error = nullptr;
                const guint token = g_dbus_connection_register_object(
                    connection, pathOf(id).c_str(), g_dbus_node_info_lookup_interface(metadata, interface), &vtable,
                    this, nullptr, &error);
                g_clear_error(&error);
                if (token != 0)
                    registrations.push_back(token);
            }
        }

        void registerObjects()
        {
            registerObject(noNode, app);
            for (const NodeId id : ids)
                if (const Node* node = tree.find(id))
                    registerObject(id, *node);
            static const GDBusInterfaceVTable vtable { method, property, setProperty, {} };
            const guint token = g_dbus_connection_register_object(
                connection, cachePath, g_dbus_node_info_lookup_interface(metadata, cacheInterface), &vtable, this,
                nullptr, nullptr);
            if (token != 0)
                objects[noNode].push_back(token);
        }

        void apply(const Update& update)
        {
            if (update.tree.full)
            {
                for (const NodeId id : ids)
                    remove(id);
                ids.clear();
            }
            for (const NodeId id : update.tree.removed)
            {
                remove(id);
                ids.erase(id);
            }
            tree.apply(update.tree);
            geometry = update.geometry;
            windowFocused = update.focused;
            for (const Node& node : update.tree.nodes)
            {
                if (connection != nullptr)
                {
                    if (ids.contains(node.id))
                        remove(node.id);
                    registerObject(node.id, node);
                }
                ids.insert(node.id);
            }
        }

        void remove(NodeId id)
        {
            if (const auto found = objects.find(id); found != objects.end())
            {
                for (const guint registration : found->second)
                    g_dbus_connection_unregister_object(connection, registration);
                objects.erase(found);
            }
        }

        static GVariant* property(GDBusConnection*, const gchar*, const gchar* path, const gchar* interface,
                                  const gchar* key, GError** error, gpointer data)
        {
            auto& self = *static_cast<Impl*>(data);
            const Node* node = self.find(path);
            if (node != nullptr)
                if (GVariant* result = self.get(*node, interface, key))
                    return result;
            g_set_error_literal(error, G_DBUS_ERROR, G_DBUS_ERROR_UNKNOWN_PROPERTY, "Unknown accessible property");
            return nullptr;
        }

        GVariant* get(const Node& node, std::string_view interface, std::string_view key) const
        {
            if (interface == accessible)
            {
                if (key == "Name")
                    return g_variant_new_string(nameOf(node).c_str());
                if (key == "Description" || key == "HelpText")
                    return g_variant_new_string(node.hint.c_str());
                if (key == "Parent")
                    return parentReference(node);
                if (key == "ChildCount")
                    return g_variant_new_int32(static_cast<int>(childrenOf(node).size()));
                if (key == "Locale")
                    return g_variant_new_string("C");
                if (key == "AccessibleId")
                    return g_variant_new_string(std::to_string(node.id).c_str());
            }
            if (interface == application && node.id == noNode)
            {
                if (key == "Id")
                    return g_variant_new_int32(applicationId);
                if (key == "ToolkitName")
                    return g_variant_new_string("Soundor");
                if (key == "Version" || key == "ToolkitVersion")
                    return g_variant_new_string(SOUNDOR_ENGINE_VERSION);
                if (key == "AtspiVersion")
                    return g_variant_new_string("2.1");
            }
            if (interface == actionInterface && key == "NActions")
                return g_variant_new_int32(static_cast<int>(node.actions.size()));
            if (interface == valueInterface)
            {
                if (key == "CurrentValue")
                    return g_variant_new_double(node.value.now.value_or(0));
                if (key == "MinimumValue")
                    return g_variant_new_double(node.value.min.value_or(-std::numeric_limits<double>::max()));
                if (key == "MaximumValue")
                    return g_variant_new_double(node.value.max.value_or(std::numeric_limits<double>::max()));
                if (key == "MinimumIncrement")
                    return g_variant_new_double(0); // No step in Soundor's semantic contract.
                if (key == "Text")
                    return g_variant_new_string(node.value.text.c_str());
            }
            return nullptr;
        }

        static gboolean setProperty(GDBusConnection*, const gchar*, const gchar* path, const gchar* interface,
                                    const gchar* key, GVariant* value, GError** error, gpointer data)
        {
            auto& self = *static_cast<Impl*>(data);
            if (! self.closing && std::string_view(path) == rootPath && std::string_view(interface) == application
                && std::string_view(key) == "Id")
            {
                self.applicationId = g_variant_get_int32(value);
                return TRUE;
            }
            g_set_error_literal(error, G_DBUS_ERROR, G_DBUS_ERROR_PROPERTY_READ_ONLY, "Property is read-only");
            return FALSE;
        }

        static void method(GDBusConnection*, const gchar*, const gchar* path, const gchar* interface,
                           const gchar* member, GVariant* args, GDBusMethodInvocation* invocation, gpointer data)
        {
            auto& self = *static_cast<Impl*>(data);
            if (self.closing)
            {
                g_dbus_method_invocation_return_error_literal(invocation, G_DBUS_ERROR, G_DBUS_ERROR_DISCONNECTED,
                                                              "Editor is closing");
                return;
            }
            GVariant* result = nullptr;
            if (std::string_view(interface) == cacheInterface && std::string_view(member) == "GetItems")
            {
                GVariantBuilder items;
                g_variant_builder_init(&items, G_VARIANT_TYPE("a((so)(so)(so)iiassusau)"));
                g_variant_builder_add_value(&items, self.cacheItem(self.app));
                for (const NodeId id : self.ids)
                    if (const Node* node = self.tree.find(id))
                        g_variant_builder_add_value(&items, self.cacheItem(*node));
                result = g_variant_new("(@a((so)(so)(so)iiassusau))", g_variant_builder_end(&items));
            }
            else if (const Node* node = self.find(path))
                result = self.call(*node, interface, member, args);
            if (result != nullptr)
                g_dbus_method_invocation_return_value(invocation, result);
            else
                g_dbus_method_invocation_return_error_literal(invocation, G_DBUS_ERROR, G_DBUS_ERROR_INVALID_ARGS,
                                                              "Unsupported method or invalid arguments");
        }

        GVariant* call(const Node& node, std::string_view interface, std::string_view member, GVariant* args)
        {
            if (interface == accessible)
            {
                if (member == "GetRole")
                    return g_variant_new("(u)", node.id == noNode ? 75U : role(node.role).value);
                if (member == "GetRoleName" || member == "GetLocalizedRoleName")
                    return g_variant_new("(s)", node.id == noNode ? "application" : role(node.role).name.data());
                if (member == "GetApplication")
                    return g_variant_new("(@(so))", reference(noNode));
                if (member == "GetIndexInParent")
                    return g_variant_new("(i)", indexOf(node));
                if (member == "GetRelationSet")
                    return g_variant_new("(a(ua(so)))", nullptr);
                if (member == "GetState")
                    return g_variant_new("(@au)", stateArray(node, windowFocused && node.id == tree.focus(),
                                                             windowFocused && node.id == tree.root()));
                if (member == "GetInterfaces")
                    return g_variant_new("(@as)", stringArray(interfaces(node, node.id == noNode)));
                if (member == "GetAttributes")
                {
                    GVariantBuilder attributes;
                    g_variant_builder_init(&attributes, G_VARIANT_TYPE("a{ss}"));
                    if (! node.placeholder.empty())
                        g_variant_builder_add(&attributes, "{ss}", "placeholder-text", node.placeholder.c_str());
                    if (! node.value.text.empty())
                        g_variant_builder_add(&attributes, "{ss}", "valuetext", node.value.text.c_str());
                    return g_variant_new("(@a{ss})", g_variant_builder_end(&attributes));
                }
                const auto children = childrenOf(node);
                if (member == "GetChildAtIndex")
                {
                    gint32 index = -1;
                    g_variant_get(args, "(i)", &index);
                    if (index < 0 || static_cast<std::size_t>(index) >= children.size())
                        return nullptr;
                    return g_variant_new("(@(so))", reference(children[static_cast<std::size_t>(index)]));
                }
                if (member == "GetChildren")
                {
                    GVariantBuilder out;
                    g_variant_builder_init(&out, G_VARIANT_TYPE("a(so)"));
                    for (const NodeId id : children)
                        g_variant_builder_add_value(&out, reference(id));
                    return g_variant_new("(@a(so))", g_variant_builder_end(&out));
                }
            }
            if (interface == application)
            {
                if (member == "GetLocale")
                    return g_variant_new("(s)", "C");
                if (member == "GetApplicationBusAddress")
                    return g_variant_new("(s)", ""); // No separate peer-to-peer application bus.
            }
            return nullptr;
        }

        std::string name;
        std::string address;
        GMainContext* context;
        GCancellable* cancel;
        std::atomic<bool> closing { false };
        std::atomic<bool> registered { false };
        std::mutex mutex;
        std::vector<Update> updates;
        std::vector<ActionRequest> requests;
        // Everything below belongs exclusively to the owned event thread.
        GDBusNodeInfo* metadata = nullptr;
        GDBusConnection* connection = nullptr;
        std::string busName;
        std::string parentBus;
        std::string parentPath = nullPath;
        int applicationId = -1;
        unsigned pending = 0;
        bool discovering = false;
        gint64 retryAt = 0;
        Tree tree;
        Node app;
        std::unordered_set<NodeId> ids;
        std::unordered_map<NodeId, std::vector<guint>> objects;
        ViewGeometry geometry;
        bool windowFocused = false;
        std::thread worker;
    };

    Session::Session(std::string name, std::string address)
        : impl(std::make_unique<Impl>(std::move(name), std::move(address)))
    {
    }
    Session::~Session() = default;
    void Session::update(TreeUpdate update, ViewGeometry geometry, bool focused)
    {
        impl->update(std::move(update), geometry, focused);
    }
    std::vector<ActionRequest> Session::takeRequests()
    {
        return impl->takeRequests();
    }
    bool Session::active() const
    {
        return impl->active();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::atspi
