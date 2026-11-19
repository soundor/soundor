#include <soundor/debug/Bridge.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>

#include <chrono>

using namespace soundor;

TEST_CASE("DevTools bridge: teardown does not wait for descriptor polling")
{
    std::chrono::steady_clock::time_point began;
    {
        debug::Bridge bridge({ .descriptor = "/missing/soundor-session.json", .name = "Test", .runtime = "Test" });
        RuntimeHost host({});
        host.surface().setSize({ 100, 100 });
        bridge.tick(host, 1);
        // Teardown alone: making a runtime takes its own time on a busy machine.
        began = std::chrono::steady_clock::now();
    }
    CHECK(std::chrono::steady_clock::now() - began < std::chrono::seconds(1));
}
