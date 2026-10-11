#include "../web/WebTestSupport.h"

#include <soundor/platform/Resources.h>

#include <doctest/doctest.h>

#include <array>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <regex>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    // soundor_embed_ui() in tests/CMakeLists.txt.
    std::span<const platform::EmbeddedFile> fixtureUiCompiled();
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded

using namespace soundor;

TEST_SUITE("bytecode")
{
#if SOUNDOR_TESTS_PRECOMPILE_JS
    TEST_CASE("soundor_embed_ui embeds a bundle's modules as bytecode, and its assets as they are")
    {
        const platform::EmbeddedResources resources(embedded::fixtureUiCompiled());
        CHECK_FALSE(resources.find("bundle.js").has_value());
        CHECK_FALSE(resources.find("lib.js").has_value());
        CHECK(resources.find("bundle.js.qjsbc").has_value());
        CHECK(resources.find("lib.js.qjsbc").has_value());
        CHECK(resources.find("assets/0123456789abcdef.png").has_value());
    }

    TEST_CASE("RuntimeHost runs a bundle and what it imports from bytecode")
    {
        RuntimeHost host({ .pluginName = "Fixture",
                           .resources = std::make_shared<platform::EmbeddedResources>(embedded::fixtureUiCompiled()),
                           .entry = "/bundle.js" });
        REQUIRE_MESSAGE(host.entryResult().ok(),
                        (host.entryResult().ok() ? "" : host.entryResult().error().toString()));
        CHECK(host.context().evaluateScript("started").value().asString() == "bundle of Fixture");
    }
#endif

    TEST_CASE("bytecode for another QuickJS is refused with a clear error")
    {
        static constexpr std::string_view stale = "soundor-bytecode 0000000000000000000000000000000000000000\n\x01\x02";
        const std::array<platform::EmbeddedFile, 1> files { {
            { "bundle.js.qjsbc",
              std::span<const std::uint8_t>(reinterpret_cast<const std::uint8_t*>(stale.data()), stale.size()) },
        } };
        RuntimeHost host({ .resources = std::make_shared<platform::EmbeddedResources>(files), .entry = "/bundle.js" });
        REQUIRE_FALSE(host.entryResult().ok());
        CHECK(host.entryResult().error().toString().find("compiled for another QuickJS") != std::string::npos);
    }

    TEST_CASE("bytecode in a directory is never read: only the source is")
    {
        const auto directory = std::filesystem::temp_directory_path() / "soundor-bytecode-test";
        std::filesystem::create_directories(directory);
        std::ofstream(directory / "bundle.js") << "globalThis.started = 'from source';";
        // Garbage that would crash the engine if it were read as bytecode.
        std::ofstream(directory / "bundle.js.qjsbc", std::ios::binary) << "soundor-bytecode garbage\n\xff\xff\xff\xff";
        RuntimeHost host(
            { .resources = std::make_shared<platform::DirectoryResources>(directory), .entry = "/bundle.js" });
        REQUIRE(host.entryResult().ok());
        CHECK(host.context().evaluateScript("started").value().asString() == "from source");
        std::filesystem::remove_all(directory);
    }

    TEST_CASE("the runtime's modules keep their line numbers in stack traces")
    {
        test::WebFixture f;
        f.run(R"(
            import { createView } from 'soundor:ui';
            try {
                createView().style = { width: 'wide' };
            } catch (error) {
                globalThis.result = error.stack;
            }
        )");
        const std::string stack = f.eval("result").asString();
        INFO(stack);
        CHECK(std::regex_search(stack, std::regex("soundor:ui:[0-9]+")));
    }
}
