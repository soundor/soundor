#include "../web/WebTestSupport.h"

#include <cstdint>
#include <string>

using namespace soundor;
using test::WebFixture;

namespace
{
    RuntimeHost::Options timed()
    {
        RuntimeHost::Options options;
        options.textEngine = ui::approximateTextEngine();
        options.runtime.timeNativeCalls = true;
        return options;
    }
} // namespace

TEST_SUITE("RuntimeHost statistics")
{
    TEST_CASE("native calls are counted per API, and timed only when asked")
    {
        WebFixture f;
        const auto before = f.host.statistics().runtime;
        f.run(R"(
            import { root, createView, createCanvas } from 'soundor:ui';
            const view = createView();
            root.appendChild(view);
            view.style = { width: 10, height: 10 };
            const canvas = createCanvas({ width: 10, height: 10 });
            root.appendChild(canvas);
            const ctx = canvas.getContext('2d');
            for (let i = 0; i < 10; i++) ctx.fillRect(i, 0, 1, 1);
        )");
        const auto after = f.host.statistics().runtime;
        CHECK(after.ui.calls > before.ui.calls);
        CHECK(after.canvas.calls >= before.canvas.calls + 10);
        CHECK(after.webgl.calls == before.webgl.calls);
        // Timing is off by default.
        CHECK(after.ui.nanoseconds == 0);
        CHECK(after.canvas.nanoseconds == 0);

        WebFixture timing(timed());
        timing.run(R"(
            import { root, createView } from 'soundor:ui';
            for (let i = 0; i < 100; i++) root.appendChild(createView());
        )");
        const auto measured = timing.host.statistics().runtime;
        CHECK(measured.ui.calls >= 100);
        CHECK(measured.ui.nanoseconds > 0);
    }

    TEST_CASE("style changes, layout passes and invalidations are counted")
    {
        WebFixture f(timed());
        f.host.surface().setSize({ 100, 100 });
        f.run(R"(
            import { root, createView } from 'soundor:ui';
            globalThis.view = createView();
            root.appendChild(view);
        )");
        f.host.surface().layout();
        const auto before = f.host.statistics().surface;
        f.eval("view.style = { width: 20, height: 20 }; view.style = { width: 30, height: 20 };");
        f.host.surface().layout();
        const auto changed = f.host.statistics().surface;
        CHECK(changed.styleChanges == before.styleChanges + 2);
        CHECK(changed.layoutPasses == before.layoutPasses + 1);
        CHECK(changed.layoutNanoseconds > before.layoutNanoseconds);
        CHECK(changed.invalidations > before.invalidations);

        // A clean tree is not laid out again.
        f.host.surface().layout();
        CHECK(f.host.statistics().surface.layoutPasses == changed.layoutPasses);
    }

    TEST_CASE("the engine's allocations and heap are counted")
    {
        WebFixture f;
        const auto before = f.host.statistics().runtime;
        CHECK(before.heapBytes > 0);
        // Blocks over 512 bytes come from the C allocator one by one; small
        // objects from the engine's arenas, which grow the heap.
        f.eval("globalThis.garbage = Array.from({ length: 1000 }, () => new Float64Array(128)); "
               "globalThis.small = Array.from({ length: 10000 }, (_, i) => ({ i })); 0");
        const auto grown = f.host.statistics().runtime;
        CHECK(grown.allocations >= before.allocations + 1000);
        CHECK(grown.allocatedBytes >= before.allocatedBytes + std::uint64_t { 1000 } * 1024);
        CHECK(grown.heapBytes > before.heapBytes + std::uint64_t { 1000 } * 1024);

        f.eval("globalThis.garbage = null; globalThis.small = null; 0");
        f.host.runtime().collectGarbage();
        CHECK(f.host.statistics().runtime.heapBytes < grown.heapBytes);
    }

    TEST_CASE("tick() is timed by step")
    {
        WebFixture f;
        f.run(R"(
            requestAnimationFrame(() => {
                const end = performance.now() + 5;
                while (performance.now() < end);
            });
        )");
        const auto before = f.host.statistics().tick;
        f.host.tick();
        const auto after = f.host.statistics().tick;
        CHECK(after.ticks == before.ticks + 1);
        CHECK(after.animationFrames - before.animationFrames >= 5'000'000);
    }
}
