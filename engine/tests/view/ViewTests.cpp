#include <soundor/render/Compositor.h>
#include <soundor/view/View.h>

#include <doctest/doctest.h>

#include <optional>
#include <vector>

using namespace soundor;

namespace
{
    struct Target final : render::RasterTarget
    {
        render::RasterSurface pixels;
        int presents = 0;
        Pixels acquire(int width, int height) override
        {
            const bool resized = pixels.resize(width, height);
            return { pixels.bitmap(), ! resized };
        }
        void present(const render::Region&) override { ++presents; }
    };

    // An editor without a native view: the CPU compositor, no native input,
    // no accessibility; what the View asks of it is recorded.
    struct Editor final : view::Platform
    {
        State current { .size = { 800, 600 }, .pixelScale = 2, .visible = true, .focused = true };
        std::vector<ui::Cursor> cursors;
        std::vector<ui::Size> requests;
        std::vector<view::Placement> placements;
        std::vector<bool> scaledOnGpu;
        int presses = 0;

        State state() override { return current; }
        void setCursor(ui::Cursor cursor) override { cursors.push_back(cursor); }
        ui::Size holdSize(ui::Size wanted) override { return { std::min(wanted.width, 1000.0F), wanted.height }; }
        void requestSize(ui::Size wanted) override { requests.push_back(wanted); }
        float surfaceScale(float wanted, bool gpu) override
        {
            scaledOnGpu.push_back(gpu);
            return wanted;
        }
        void placed(const view::Placement& placement) override { placements.push_back(placement); }
        void pressed() override { ++presses; }
    };

    view::View::Options optionsFor(Target& target, bool scale = true)
    {
        view::View::Options options;
        options.layout = { .size = { 400, 300 },
                           .resizable = true,
                           .resize = scale ? view::Layout::Resize::Scale : view::Layout::Resize::Layout };
        options.canRequestSize = true;
        options.raster = &target;
        options.nativeInput = false;
        options.name = "Test";
        options.runtimeName = "Test";
        return options;
    }
} // namespace

TEST_SUITE("view")
{
    TEST_CASE("a frame places the UI, ticks the runtime and renders")
    {
        Target target;
        Editor editor;
        view::View view(editor, optionsFor(target));
        view.frame();

        auto& surface = view.runtime().surface();
        // 800×600 over 400×300: a zoom of 2.
        CHECK(surface.size().width == doctest::Approx(400));
        CHECK(surface.size().height == doctest::Approx(300));
        CHECK(surface.editorSize().width == doctest::Approx(800));
        CHECK(surface.scale() == doctest::Approx(4));
        CHECK(surface.isVisible());
        CHECK(surface.isFocused());
        CHECK(surface.canRequestEditorSize());
        REQUIRE(editor.placements.size() == 1);
        CHECK(editor.placements[0].zoom == doctest::Approx(2));
        CHECK(editor.scaledOnGpu == std::vector<bool> { false });
        CHECK_FALSE(view.gpu());
        CHECK(target.presents > 0);

        const int presents = target.presents;
        view.frame();
        // Nothing changed: nothing drawn.
        CHECK(target.presents == presents);
    }

    TEST_CASE("a size the UI asks for is held at once and asked of the editor once a frame")
    {
        Target target;
        Editor editor;
        view::View view(editor, optionsFor(target));
        view.frame();
        auto& surface = view.runtime().surface();
        const auto asked = surface.requestEditorSize({ 1200, 700 });
        REQUIRE(asked);
        CHECK(asked.value_or(ui::Size {}).width == doctest::Approx(1000));
        (void)surface.requestEditorSize({ 900, 700 });
        CHECK(editor.requests.empty());
        view.frame();
        REQUIRE(editor.requests.size() == 1);
        CHECK(editor.requests[0].width == doctest::Approx(900));
        view.frame();
        CHECK(editor.requests.size() == 1);
    }

    TEST_CASE("the cursor is set when it changes, and input reaches the layout")
    {
        Target target;
        Editor editor;
        view::View view(editor, optionsFor(target));
        auto& surface = view.runtime().surface();
        // A 100×100 node at (100, 100) of the layout: (200, 200) to
        // (400, 400) in the editor, at a zoom of 2.
        const auto node = surface.createNode(ui::NodeType::View);
        ui::Style style;
        style.position = ui::Position::Absolute;
        style.inset.left = ui::Length::points(100);
        style.inset.top = ui::Length::points(100);
        style.width = ui::Length::points(100);
        style.height = ui::Length::points(100);
        style.cursor = ui::Cursor::Pointer;
        surface.setStyle(node, style);
        surface.insertChild(surface.root().id(), node);

        view.frame();
        REQUIRE(editor.cursors.size() == 1);
        const auto first = editor.cursors[0];
        CHECK(first != ui::Cursor::Pointer);
        view.frame();
        CHECK(editor.cursors.size() == 1);

        // (250, 250) in the editor is (125, 125) in the layout: over the node.
        view.pointer({ .phase = ui::PointerInput::Phase::Move, .position = { 250, 250 } });
        REQUIRE(editor.cursors.size() == 2);
        CHECK(editor.cursors[1] == ui::Cursor::Pointer);
        // (150, 150) is (75, 75): outside it.
        view.pointer({ .phase = ui::PointerInput::Phase::Move, .position = { 150, 150 } });
        REQUIRE(editor.cursors.size() == 3);
        CHECK(editor.cursors[2] == first);

        view.pointer({ .phase = ui::PointerInput::Phase::Down, .position = { 150, 150 }, .buttons = 1 });
        CHECK(editor.presses == 1);
    }

    TEST_CASE("without native input, the focus is the editor's")
    {
        Target target;
        Editor editor;
        editor.current.focused = false;
        view::View view(editor, optionsFor(target, false));
        view.frame();
        CHECK_FALSE(view.focused());
        CHECK_FALSE(view.runtime().surface().isFocused());
        CHECK(view.inputDescriptor() == -1);
        CHECK(view.nativeInput() == nullptr);
    }
}
