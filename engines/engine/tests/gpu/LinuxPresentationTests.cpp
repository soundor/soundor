#include "GpuTestSupport.h"
#include "TestWindow.h"
#include "gpu/Presentation.h"

#include <soundor/render/GpuCompositor.h>

#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/shape.h>
#include <dlfcn.h>

#include <chrono>
#include <cstdint>
#include <thread>

using namespace soundor;

TEST_SUITE("Linux GPU presentation")
{
    TEST_CASE("the rendering child leaves input with its parent and follows bounds and visibility")
    {
        void* view = test::createTestWindow(200, 160);
        if (view == nullptr)
        {
            if (test::gpuRequired())
                FAIL("Linux presentation tests need an X11 display");
            return;
        }
        std::string failure;
        auto presentation = gpu::createPresentation(view, &failure);
        INFO(failure);
        REQUIRE(presentation != nullptr);
        Display* display = XOpenDisplay(nullptr);
        REQUIRE(display != nullptr);
        const auto child = static_cast<Window>(reinterpret_cast<std::uintptr_t>(presentation->nativeWindow()));
        Window root = 0, parent = 0;
        Window* children = nullptr;
        unsigned count = 0;
        REQUIRE(XQueryTree(display, child, &root, &parent, &children, &count));
        XFree(children);
        CHECK(parent == static_cast<Window>(reinterpret_cast<std::uintptr_t>(view)));

        int rectangles = -1, ordering = 0;
        auto* input = XShapeGetRectangles(display, child, ShapeInput, &rectangles, &ordering);
        XFree(input);
        CHECK(rectangles == 0);

        presentation->setBounds(12, 15, 120, 90, 1);
        presentation->setVisible(true);
        XWindowAttributes attributes {};
        REQUIRE(XGetWindowAttributes(display, child, &attributes));
        CHECK(attributes.x == 12);
        CHECK(attributes.y == 15);
        CHECK(attributes.width == 120);
        CHECK(attributes.height == 90);
        CHECK(attributes.map_state == IsViewable);
        // Real X server input must reach the parent, including wheel buttons.
        void* xtest = dlopen("libXtst.so.6", RTLD_NOW | RTLD_LOCAL);
        REQUIRE(xtest != nullptr);
        using FakeButton = int (*)(Display*, unsigned int, Bool, unsigned long);
        const auto button = reinterpret_cast<FakeButton>(dlsym(xtest, "XTestFakeButtonEvent"));
        REQUIRE(button != nullptr);
        XSelectInput(display, parent, ButtonPressMask | ButtonReleaseMask);
        XWarpPointer(display, None, parent, 0, 0, 0, 0, 30, 30);
        button(display, 1, True, 0);
        button(display, 1, False, 0);
        button(display, 4, True, 0);
        button(display, 4, False, 0);
        XSync(display, False);
        XEvent event {};
        unsigned clicks = 0, wheels = 0;
        while (XCheckWindowEvent(display, parent, ButtonPressMask | ButtonReleaseMask, &event))
        {
            if (event.type == ButtonPress && event.xbutton.button == 1)
                ++clicks;
            if (event.type == ButtonPress && event.xbutton.button == 4)
                ++wheels;
        }
        CHECK(clicks == 1);
        CHECK(wheels == 1);

        presentation->setBounds(2, 3, 80, 70, 2);
        REQUIRE(XGetWindowAttributes(display, child, &attributes));
        CHECK(attributes.width == 80);
        CHECK(attributes.height == 70);
        presentation->setVisible(false);
        REQUIRE(XGetWindowAttributes(display, child, &attributes));
        CHECK(attributes.map_state == IsUnmapped);
        presentation.reset();
        XCloseDisplay(display);
        dlclose(xtest);
        test::destroyTestWindow(view);
    }

    TEST_CASE("a parent destroyed by the host does not terminate the process")
    {
        void* view = test::createTestWindow(100, 100);
        if (view == nullptr)
        {
            if (test::gpuRequired())
                FAIL("Linux presentation tests need an X11 display");
            return;
        }
        auto presentation = gpu::createPresentation(view, nullptr);
        REQUIRE(presentation != nullptr);
        test::destroyTestWindow(view);
        presentation->setVisible(true);
        CHECK_FALSE(presentation->healthy());
        presentation.reset();
        std::string failure;
        CHECK(gpu::createPresentation(view, &failure) == nullptr);
        CHECK_FALSE(failure.empty());
    }

    TEST_CASE("the Vulkan compositor presents pixels into its rendering child")
    {
        void* view = test::createTestWindow(100, 100);
        if (view == nullptr)
        {
            if (test::gpuRequired())
                FAIL("Linux presentation tests need an X11 display");
            return;
        }
        std::string failure;
        auto compositor = render::GpuCompositor::create(
            { .view = { view }, .background = 0xFFCC3300, .allowSoftware = true }, &failure);
        INFO(failure);
        REQUIRE(compositor != nullptr);
        compositor->setBounds(0, 0, 100, 100, 1);
        compositor->setVisible(true);
        compositor->composite({ .width = 100, .height = 100 });
        REQUIRE(compositor->healthy());
        Display* display = XOpenDisplay(nullptr);
        REQUIRE(display != nullptr);
        const auto parent = static_cast<Window>(reinterpret_cast<std::uintptr_t>(view));
        Window root = 0, returnedParent = 0;
        Window* children = nullptr;
        unsigned count = 0;
        REQUIRE(XQueryTree(display, parent, &root, &returnedParent, &children, &count));
        REQUIRE(count == 1);
        const Window child = children[0];
        XFree(children);
        // Presentation is asynchronous; observing the X server must not add
        // a glFinish or readback to the production renderer.
        bool presented = false;
        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
        do
        {
            XImage* image = XGetImage(display, child, 50, 50, 1, 1, AllPlanes, ZPixmap);
            if (image != nullptr)
            {
                presented = (XGetPixel(image, 0, 0) & 0xFFFFFFUL) == 0xCC3300UL;
                XDestroyImage(image);
            }
            if (! presented)
                std::this_thread::sleep_for(std::chrono::milliseconds(20));
        } while (! presented && std::chrono::steady_clock::now() < deadline);
        CHECK(presented);
        compositor.reset();
        XCloseDisplay(display);
        test::destroyTestWindow(view);
    }

    TEST_CASE("a missing parent selects the CPU fallback")
    {
        std::string failure;
        CHECK(gpu::createPresentation(nullptr, &failure) == nullptr);
        CHECK_FALSE(failure.empty());
    }
}
