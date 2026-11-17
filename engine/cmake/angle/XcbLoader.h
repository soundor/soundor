// ANGLE's Vulkan X11 presentation uses XCB without a link-time dependency.
// Only called after availability was checked; an absent library keeps offscreen rendering usable.
#pragma once

#include <dlfcn.h>
#include <xcb/xcb.h>

namespace soundor_angle
{
    class Xcb
    {
    public:
        Xcb()
        {
            library = dlopen("libxcb.so.1", RTLD_NOW | RTLD_LOCAL);
            if (library == nullptr)
                return;
            bool complete = true;
            connect = reinterpret_cast<decltype(connect)>(dlsym(library, "xcb_connect"));
            complete = complete && connect != nullptr;
            connection_has_error =
                reinterpret_cast<decltype(connection_has_error)>(dlsym(library, "xcb_connection_has_error"));
            complete = complete && connection_has_error != nullptr;
            disconnect = reinterpret_cast<decltype(disconnect)>(dlsym(library, "xcb_disconnect"));
            complete = complete && disconnect != nullptr;
            query_tree = reinterpret_cast<decltype(query_tree)>(dlsym(library, "xcb_query_tree"));
            complete = complete && query_tree != nullptr;
            query_tree_reply = reinterpret_cast<decltype(query_tree_reply)>(dlsym(library, "xcb_query_tree_reply"));
            complete = complete && query_tree_reply != nullptr;
            screen_allowed_depths_iterator = reinterpret_cast<decltype(screen_allowed_depths_iterator)>(
                dlsym(library, "xcb_screen_allowed_depths_iterator"));
            complete = complete && screen_allowed_depths_iterator != nullptr;
            depth_next = reinterpret_cast<decltype(depth_next)>(dlsym(library, "xcb_depth_next"));
            complete = complete && depth_next != nullptr;
            depth_visuals_iterator =
                reinterpret_cast<decltype(depth_visuals_iterator)>(dlsym(library, "xcb_depth_visuals_iterator"));
            complete = complete && depth_visuals_iterator != nullptr;
            visualtype_next = reinterpret_cast<decltype(visualtype_next)>(dlsym(library, "xcb_visualtype_next"));
            complete = complete && visualtype_next != nullptr;
            setup_roots_iterator =
                reinterpret_cast<decltype(setup_roots_iterator)>(dlsym(library, "xcb_setup_roots_iterator"));
            complete = complete && setup_roots_iterator != nullptr;
            get_setup = reinterpret_cast<decltype(get_setup)>(dlsym(library, "xcb_get_setup"));
            complete = complete && get_setup != nullptr;
            get_input_focus = reinterpret_cast<decltype(get_input_focus)>(dlsym(library, "xcb_get_input_focus"));
            complete = complete && get_input_focus != nullptr;
            get_input_focus_reply =
                reinterpret_cast<decltype(get_input_focus_reply)>(dlsym(library, "xcb_get_input_focus_reply"));
            complete = complete && get_input_focus_reply != nullptr;
            get_geometry = reinterpret_cast<decltype(get_geometry)>(dlsym(library, "xcb_get_geometry"));
            complete = complete && get_geometry != nullptr;
            get_geometry_reply =
                reinterpret_cast<decltype(get_geometry_reply)>(dlsym(library, "xcb_get_geometry_reply"));
            complete = complete && get_geometry_reply != nullptr;
            get_window_attributes =
                reinterpret_cast<decltype(get_window_attributes)>(dlsym(library, "xcb_get_window_attributes"));
            complete = complete && get_window_attributes != nullptr;
            get_window_attributes_reply = reinterpret_cast<decltype(get_window_attributes_reply)>(
                dlsym(library, "xcb_get_window_attributes_reply"));
            complete = complete && get_window_attributes_reply != nullptr;
            available = complete;
        }
        ~Xcb()
        {
            if (library != nullptr)
                dlclose(library);
        }
        Xcb(const Xcb&) = delete;
        Xcb& operator=(const Xcb&) = delete;
        bool available = false;
        decltype(&xcb_connect) connect = nullptr;
        decltype(&xcb_connection_has_error) connection_has_error = nullptr;
        decltype(&xcb_disconnect) disconnect = nullptr;
        decltype(&xcb_query_tree) query_tree = nullptr;
        decltype(&xcb_query_tree_reply) query_tree_reply = nullptr;
        decltype(&xcb_screen_allowed_depths_iterator) screen_allowed_depths_iterator = nullptr;
        decltype(&xcb_depth_next) depth_next = nullptr;
        decltype(&xcb_depth_visuals_iterator) depth_visuals_iterator = nullptr;
        decltype(&xcb_visualtype_next) visualtype_next = nullptr;
        decltype(&xcb_setup_roots_iterator) setup_roots_iterator = nullptr;
        decltype(&xcb_get_setup) get_setup = nullptr;
        decltype(&xcb_get_input_focus) get_input_focus = nullptr;
        decltype(&xcb_get_input_focus_reply) get_input_focus_reply = nullptr;
        decltype(&xcb_get_geometry) get_geometry = nullptr;
        decltype(&xcb_get_geometry_reply) get_geometry_reply = nullptr;
        decltype(&xcb_get_window_attributes) get_window_attributes = nullptr;
        decltype(&xcb_get_window_attributes_reply) get_window_attributes_reply = nullptr;

    private:
        void* library = nullptr;
    };
    inline const Xcb& xcb()
    {
        static const Xcb functions;
        return functions;
    }
} // namespace soundor_angle
