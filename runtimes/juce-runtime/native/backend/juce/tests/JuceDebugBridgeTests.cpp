#include <soundor/backend/JuceDebugBridge.h>

#include <doctest/doctest.h>
#include <juce_core/juce_core.h>

#include <chrono>

using namespace soundor;

TEST_CASE("debug worker teardown does not wait for descriptor polling")
{
    const auto began = std::chrono::steady_clock::now();
    {
        backend::JuceDebugBridge bridge("/missing/soundor-session.json", "Test");
        RuntimeHost host({});
        host.surface().setSize({ 100, 100 });
        bridge.tick(host, 1);
    }
    CHECK(std::chrono::steady_clock::now() - began < std::chrono::seconds(1));
}
