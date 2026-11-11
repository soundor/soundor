#pragma once

#include <soundor/Config.h>

#include <dlfcn.h>
#include <xcb/shape.h>
#include <xcb/xcb.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    // A private function table: importing an engine never requires an X server or its libraries.
    class Xcb
    {
    public:
        Xcb()
        {
            library = dlopen("libxcb.so.1", RTLD_NOW | RTLD_LOCAL);
            shape = dlopen("libxcb-shape.so.0", RTLD_NOW | RTLD_LOCAL);
            if (library == nullptr || shape == nullptr)
                return;
            bool complete = true;
            connect = reinterpret_cast<decltype(connect)>(dlsym(library, "xcb_connect"));
            complete = complete && connect != nullptr;
            connection_has_error =
                reinterpret_cast<decltype(connection_has_error)>(dlsym(library, "xcb_connection_has_error"));
            complete = complete && connection_has_error != nullptr;
            disconnect = reinterpret_cast<decltype(disconnect)>(dlsym(library, "xcb_disconnect"));
            complete = complete && disconnect != nullptr;
            get_setup = reinterpret_cast<decltype(get_setup)>(dlsym(library, "xcb_get_setup"));
            complete = complete && get_setup != nullptr;
            setup_roots_iterator =
                reinterpret_cast<decltype(setup_roots_iterator)>(dlsym(library, "xcb_setup_roots_iterator"));
            complete = complete && setup_roots_iterator != nullptr;
            query_tree = reinterpret_cast<decltype(query_tree)>(dlsym(library, "xcb_query_tree"));
            complete = complete && query_tree != nullptr;
            query_tree_reply = reinterpret_cast<decltype(query_tree_reply)>(dlsym(library, "xcb_query_tree_reply"));
            complete = complete && query_tree_reply != nullptr;
            generate_id = reinterpret_cast<decltype(generate_id)>(dlsym(library, "xcb_generate_id"));
            complete = complete && generate_id != nullptr;
            request_check = reinterpret_cast<decltype(request_check)>(dlsym(library, "xcb_request_check"));
            complete = complete && request_check != nullptr;
            create_colormap_checked =
                reinterpret_cast<decltype(create_colormap_checked)>(dlsym(library, "xcb_create_colormap_checked"));
            complete = complete && create_colormap_checked != nullptr;
            create_window_checked =
                reinterpret_cast<decltype(create_window_checked)>(dlsym(library, "xcb_create_window_checked"));
            complete = complete && create_window_checked != nullptr;
            configure_window_checked =
                reinterpret_cast<decltype(configure_window_checked)>(dlsym(library, "xcb_configure_window_checked"));
            complete = complete && configure_window_checked != nullptr;
            map_window_checked =
                reinterpret_cast<decltype(map_window_checked)>(dlsym(library, "xcb_map_window_checked"));
            complete = complete && map_window_checked != nullptr;
            unmap_window_checked =
                reinterpret_cast<decltype(unmap_window_checked)>(dlsym(library, "xcb_unmap_window_checked"));
            complete = complete && unmap_window_checked != nullptr;
            shape_query_version =
                reinterpret_cast<decltype(shape_query_version)>(dlsym(shape, "xcb_shape_query_version"));
            complete = complete && shape_query_version != nullptr;
            shape_query_version_reply =
                reinterpret_cast<decltype(shape_query_version_reply)>(dlsym(shape, "xcb_shape_query_version_reply"));
            complete = complete && shape_query_version_reply != nullptr;
            shape_rectangles_checked =
                reinterpret_cast<decltype(shape_rectangles_checked)>(dlsym(shape, "xcb_shape_rectangles_checked"));
            complete = complete && shape_rectangles_checked != nullptr;
            available = complete;
        }
        ~Xcb()
        {
            if (shape != nullptr)
                dlclose(shape);
            if (library != nullptr)
                dlclose(library);
        }
        Xcb(const Xcb&) = delete;
        Xcb& operator=(const Xcb&) = delete;
        bool available = false;
        decltype(&xcb_connect) connect = nullptr;
        decltype(&xcb_connection_has_error) connection_has_error = nullptr;
        decltype(&xcb_disconnect) disconnect = nullptr;
        decltype(&xcb_get_setup) get_setup = nullptr;
        decltype(&xcb_setup_roots_iterator) setup_roots_iterator = nullptr;
        decltype(&xcb_query_tree) query_tree = nullptr;
        decltype(&xcb_query_tree_reply) query_tree_reply = nullptr;
        decltype(&xcb_generate_id) generate_id = nullptr;
        decltype(&xcb_request_check) request_check = nullptr;
        decltype(&xcb_create_colormap_checked) create_colormap_checked = nullptr;
        decltype(&xcb_create_window_checked) create_window_checked = nullptr;
        decltype(&xcb_configure_window_checked) configure_window_checked = nullptr;
        decltype(&xcb_map_window_checked) map_window_checked = nullptr;
        decltype(&xcb_unmap_window_checked) unmap_window_checked = nullptr;
        decltype(&xcb_shape_query_version) shape_query_version = nullptr;
        decltype(&xcb_shape_query_version_reply) shape_query_version_reply = nullptr;
        decltype(&xcb_shape_rectangles_checked) shape_rectangles_checked = nullptr;

    private:
        void* library = nullptr;
        void* shape = nullptr;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
