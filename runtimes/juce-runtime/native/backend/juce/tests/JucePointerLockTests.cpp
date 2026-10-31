#include <soundor/backend/JucePointerLock.h>

#include <doctest/doctest.h>

#include <memory>
#include <string>
#include <vector>

using namespace soundor;

namespace
{
    // A mouse source that records what the lock does to it.
    struct FakeMouse
    {
        bool dragging = true;
        juce::Point<float> position { 40, 50 };
        std::vector<std::string> calls;
    };

    class FakeSource final : public backend::PointerLock::Source
    {
    public:
        explicit FakeSource(FakeMouse& mouse) : mouse(mouse) {}
        [[nodiscard]] bool isDragging() const override { return mouse.dragging; }
        [[nodiscard]] juce::Point<float> screenPosition() const override { return mouse.position; }
        void setScreenPosition(juce::Point<float> position) override
        {
            mouse.position = position;
            mouse.calls.push_back("moved to " + std::to_string(int(position.x)) + ","
                                  + std::to_string(int(position.y)));
        }

    private:
        FakeMouse& mouse;
    };

    backend::PointerLock::Sources sourcesOf(FakeMouse& mouse)
    {
        return [&mouse](int pointerId) -> std::unique_ptr<backend::PointerLock::Source>
        {
            if (pointerId != 1)
                return nullptr;
            return std::make_unique<FakeSource>(mouse);
        };
    }
} // namespace

TEST_SUITE("backend::PointerLock")
{
    const juce::Point<float> view { 400, 300 };
    const juce::Point<float> knob { 200, 150 }; // where the lock began, in the view

    TEST_CASE("carries positions on past the view, moving the pointer back when it strays")
    {
        FakeMouse mouse;
        backend::PointerLock lock(sourcesOf(mouse));
        lock.update(1, knob);
        CHECK(lock.active());
        CHECK(lock.follow(1, { 200, 120 }, view) == juce::Point<float>(200, 120)); // near: as it is
        // 110 points up: moved back to where it began, the position carries on.
        CHECK(lock.follow(1, { 200, 40 }, view) == juce::Point<float>(200, 40));
        CHECK(mouse.calls == std::vector<std::string> { "moved to 40,50" });
        // The next moves count from there.
        CHECK(lock.follow(1, { 200, 150 }, view) == juce::Point<float>(200, 40));
        CHECK(lock.follow(1, { 200, 100 }, view) == juce::Point<float>(200, -10));
        CHECK(lock.follow(2, { 5, 5 }, view) == juce::Point<float>(5, 5)); // another pointer
    }

    TEST_CASE("puts the pointer back where the lock began when it ends")
    {
        FakeMouse mouse;
        backend::PointerLock lock(sourcesOf(mouse));
        lock.update(1, knob);
        lock.update(1, knob); // still wanted: nothing more
        mouse.position = { 900, -300 };
        lock.update(std::nullopt, {}); // released, or the view let go
        CHECK_FALSE(lock.active());
        CHECK(mouse.calls == std::vector<std::string> { "moved to 40,50" });
        CHECK(lock.follow(1, { 10, 10 }, view) == juce::Point<float>(10, 10));
    }

    TEST_CASE("ends the lock when the drag ended without a release")
    {
        FakeMouse mouse;
        backend::PointerLock lock(sourcesOf(mouse));
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
        backend::PointerLock lock(sourcesOf(mouse));
        lock.update(1, knob);
        lock.update(7, knob); // no such source (a DevTools pointer)
        CHECK_FALSE(lock.active());
        CHECK(mouse.calls.empty());
    }

    TEST_CASE("the destructor ends a lock, as when the editor closes during a drag")
    {
        FakeMouse mouse;
        {
            backend::PointerLock lock(sourcesOf(mouse));
            lock.update(1, knob);
        }
        CHECK(mouse.calls == std::vector<std::string> { "moved to 40,50" });
    }
}
