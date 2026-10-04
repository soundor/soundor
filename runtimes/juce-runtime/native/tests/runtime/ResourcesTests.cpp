#include <soundor/platform/Resources.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>

#include <filesystem>
#include <memory>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    std::span<const platform::EmbeddedFile> fixtureUi(); // soundor_embed_directory() in tests/CMakeLists.txt
}

using namespace soundor;

TEST_SUITE("resources")
{
    TEST_CASE("soundor_embed_directory compiles a directory into the binary")
    {
        const platform::EmbeddedResources resources(embedded::fixtureUi());
        if (const auto bundle = resources.find("bundle.js"))
            CHECK(std::string(bundle->begin(), bundle->end()).find("import { describe }") != std::string::npos);
        else
            FAIL("bundle.js is not embedded");
        if (const auto png = resources.find("/assets/0123456789abcdef.png"))
        {
            CHECK(png->size() == 15);
            CHECK(png->front() == 0x89);
        }
        else
        {
            FAIL("the asset is not embedded");
        }
        CHECK_FALSE(resources.find("missing.js").has_value());
    }

    TEST_CASE("RuntimeHost evaluates the entry module from resources")
    {
        RuntimeHost host({ .pluginName = "Fixture",
                           .resources = std::make_shared<platform::EmbeddedResources>(embedded::fixtureUi()),
                           .entry = "/bundle.js" });
        REQUIRE_MESSAGE(host.entryResult().ok(),
                        (host.entryResult().ok() ? "" : host.entryResult().error().toString()));
        CHECK(host.context().evaluateScript("started").value().asString() == "bundle of Fixture");
        if (const auto asset = host.asset("0123456789abcdef.png"))
            CHECK(asset->size() == 15);
        else
            FAIL("the asset does not resolve");
        CHECK_FALSE(host.asset("../bundle.js").has_value());
        CHECK_FALSE(host.asset("missing.png").has_value());
    }

    TEST_CASE("a failing entry is reported and leaves the host usable")
    {
        std::vector<std::string> logs;
        RuntimeHost host(
            { .runtime = { .log = [&](js::LogLevel, std::string_view message) { logs.emplace_back(message); } },
              .resources = std::make_shared<platform::DirectoryResources>(std::filesystem::path(SOUNDOR_TEST_FIXTURES)),
              .entry = "/broken.js" });
        REQUIRE_FALSE(host.entryResult().ok());
        CHECK(host.entryResult().error().toString() == "Error: broken bundle");
        REQUIRE(logs.size() == 1);
        CHECK(logs[0].find("The plugin UI failed to start: Error: broken bundle") == 0);
        CHECK(host.context().evaluateScript("1 + 1").value().asNumber() == 2);
    }

    TEST_CASE("DirectoryResources reads files and refuses to leave its root")
    {
        const platform::DirectoryResources resources(std::filesystem::path(SOUNDOR_TEST_FIXTURES) / "ui");
        CHECK(resources.find("lib.js").has_value());
        CHECK(resources.find("./assets/0123456789abcdef.png").has_value());
        CHECK_FALSE(resources.find("../broken.js").has_value());
        CHECK_FALSE(resources.find("").has_value());
    }

    TEST_CASE("a missing entry module fails clearly")
    {
        RuntimeHost host({ .resources = std::make_shared<platform::EmbeddedResources>(embedded::fixtureUi()),
                           .entry = "/missing.js" });
        REQUIRE_FALSE(host.entryResult().ok());
        CHECK(host.entryResult().error().toString() == "TypeError: Cannot find module '/missing.js'");
    }
}
