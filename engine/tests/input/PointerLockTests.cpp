#include <soundor/input/PointerLock.h>

#include <doctest/doctest.h>

#include <memory>
#include <string>
#include <vector>

using namespace soundor;

namespace
{
    // A mouse that records what the lock does to it.
    struct FakeMouse
    {
        bool dragging = true;
        ui::Point position { 40, 50 };
        std::vector<std::string> calls;
    };

    class FakeSource final : public input::PointerLock::Source
    {
    public:
        explicit FakeSource(FakeMouse& owner) : mouse(owner) {}
        [[nodiscard]] bool isDragging() const override { return mouse.dragging; }
        [[nodiscard]] ui::Point screenPosition() const override { return mouse.position; }
        void setScreenPosition(ui::Point position) override
        {
            mouse.position = position;
            mouse.calls.push_back("moved to " + std::to_string(static_cast<int>(position.x)) + ","
                                  + std::to_string(static_cast<int>(position.y)));
        }

    private:
        FakeMouse& mouse;
    };

    input::PointerLock::Sources sourcesOf(FakeMouse& mouse)
    {
        return [&mouse](int pointerId) -> std::unique_ptr<input::PointerLock::Source>
        {
            if (pointerId != 1)
                return nullptr;
            return std::make_unique<FakeSource>(mouse);
        };
    }

    bool same(ui::Point a, ui::Point b)
    {
        return a.x == b.x && a.y == b.y;
    }
} // namespace

TEST_SUITE("input::PointerLock")
{
    const ui::Point view { 400, 300 };
    const ui::Point knob { 200, 150 }; // where the lock began, in the view

    TEST_CASE("carries positions on past the view, moving the pointer back when it strays")
    {
        FakeMouse mouse;
        input::PointerLock lock(sourcesOf(mouse));
        lock.update(1, knob);
        CHECK(lock.active());
        CHECK(same(lock.follow(1, { 200, 120 }, view), { 200, 120 })); // near: as it is
        // 110 points up: moved back to where it began, the position carries on.
        CHECK(same(lock.follow(1, { 200, 40 }, view), { 200, 40 }));
        CHECK(mouse.calls == std::vector<std::string> { "moved to 40,50" });
        // The next moves count from there.
        CHECK(same(lock.follow(1, { 200, 150 }, view), { 200, 40 }));
        CHECK(same(lock.follow(1, { 200, 100 }, view), { 200, -10 }));
        CHECK(same(lock.follow(2, { 5, 5 }, view), { 5, 5 })); // another pointer
    }

    TEST_CASE("puts the pointer back where the lock began when it ends")
    {
        FakeMouse mouse;
        input::PointerLock lock(sourcesOf(mouse));
        lock.update(1, knob);
        lock.update(1, knob); // still wanted: nothing more
        mouse.position = { 900, -300 };
        lock.update(std::nullopt, {}); // released, or the view let go
        CHECK_FALSE(lock.active());
        CHECK(mouse.calls == std::vector<std::string> { "moved to 40,50" });
        CHECK(same(lock.follow(1, { 10, 10 }, view), { 10, 10 }));
    }

    TEST_CASE("ends the lock when the drag ended without a release")
    {
        FakeMouse mouse;
        input::PointerLock lock(sourcesOf(mouse));
        lock.update(1, knob);
        mouse.dragging = false;
        lock.update(1, knob); // the view still asks, but the source is no longer dragging
        CHECK_FALSE(lock.active());
        CHECK(mouse.calls == std::vector<std::string> { "moved to 40,50" });
    }

    TEST_CASE("locks nothing that is not dragging or not a mouse")
    {
        FakeMouse mouse;
        mouse.dragging = false;
        input::PointerLock lock(sourcesOf(mouse));
        lock.update(1, knob);
        lock.update(7, knob); // no such source (a DevTools pointer)
        CHECK_FALSE(lock.active());
        CHECK(mouse.calls.empty());
    }

    TEST_CASE("the destructor ends a lock, as when the editor closes during a drag")
    {
        FakeMouse mouse;
        {
            input::PointerLock lock(sourcesOf(mouse));
            lock.update(1, knob);
        }
        CHECK(mouse.calls == std::vector<std::string> { "moved to 40,50" });
    }
}
