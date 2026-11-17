#include "../web/WebTestSupport.h"

#include <soundor/platform/Resources.h>

#include <doctest/doctest.h>

#include <array>
#include <chrono>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <regex>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    // soundor_embed_ui() in tests/CMakeLists.txt.
    std::span<const platform::EmbeddedFile> fixtureUiCompiled();
    std::span<const platform::EmbeddedFile> fixtureRunawayCompiled();
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
        CHECK(resources.find("bundle.js.hbc").has_value());
        CHECK(resources.find("lib.js.hbc").has_value());
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

    TEST_CASE("compiled modules accept LF and Windows CRLF revision markers")
    {
        for (const std::string_view newline : { "\n", "\r\n" })
        {
            CAPTURE(newline.size());
            const auto original = embedded::fixtureUiCompiled();
            std::vector<std::vector<std::uint8_t>> contents;
            std::vector<platform::EmbeddedFile> files;
            contents.reserve(original.size());
            files.reserve(original.size());
            for (const auto& file : original)
            {
                contents.emplace_back(file.data.begin(), file.data.end());
                auto& bytes = contents.back();
                if (file.path.ends_with(".hbc"))
                {
                    const std::string text(bytes.begin(), bytes.end());
                    const auto marker = text.rfind("soundor-hermes ");
                    REQUIRE(marker != std::string::npos);
                    const std::size_t ending = text.ends_with("\r\n") ? 2 : 1;
                    REQUIRE(marker >= ending);
                    const std::string trailer = std::string(newline)
                                                + text.substr(marker, text.size() - ending - marker)
                                                + std::string(newline);
                    bytes.resize(marker - ending);
                    bytes.insert(bytes.end(), trailer.begin(), trailer.end());
                }
                files.push_back({ file.path, bytes });
            }
            RuntimeHost host({ .pluginName = "Fixture",
                               .resources = std::make_shared<platform::EmbeddedResources>(files),
                               .entry = "/bundle.js" });
            REQUIRE_MESSAGE(host.entryResult().ok(),
                            (host.entryResult().ok() ? "" : host.entryResult().error().toString()));
            CHECK(host.context().evaluateScript("started").value().asString() == "bundle of Fixture");
        }
    }

    TEST_CASE("bytecode stops at the time limit too")
    {
        // hermesc compiled its loop with the checks the limit needs.
        RuntimeHost host(
            { .runtime = { .timeLimit = std::chrono::milliseconds(200) },
              .pluginName = "Fixture",
              .resources = std::make_shared<platform::EmbeddedResources>(embedded::fixtureRunawayCompiled()),
              .entry = "/bundle.js" });
        REQUIRE_FALSE(host.entryResult().ok());
        CHECK(host.entryResult().error().name == "TimeoutError");
        CHECK(host.entryResult().error().stack.find("/bundle.js") != std::string::npos);
    }
#endif

    TEST_CASE("bytecode for another Hermes is refused with a clear error")
    {
        // Not this build's epilogue (src/js/Bytecode.h).
        static constexpr std::string_view stale =
            "\xc6\x1f\xbc\x03\xc1\x03\x19\x1f\nsoundor-hermes 0000000000000000000000000000000000000000\n";
        const std::array<platform::EmbeddedFile, 1> files { {
            { "bundle.js.hbc",
              std::span<const std::uint8_t>(reinterpret_cast<const std::uint8_t*>(stale.data()), stale.size()) },
        } };
        RuntimeHost host({ .resources = std::make_shared<platform::EmbeddedResources>(files), .entry = "/bundle.js" });
        REQUIRE_FALSE(host.entryResult().ok());
        CHECK(host.entryResult().error().toString().find("compiled for another Hermes") != std::string::npos);
    }

    TEST_CASE("bytecode in a directory is never read: only the source is")
    {
        const auto directory = std::filesystem::temp_directory_path() / "soundor-bytecode-test";
        std::filesystem::create_directories(directory);
        std::ofstream(directory / "bundle.js") << "(function () { globalThis.started = 'from source'; })";
        // Garbage that would crash the engine if it were read as bytecode.
        std::ofstream(directory / "bundle.js.hbc", std::ios::binary) << "\xff\xff\xff\xff\nsoundor-hermes garbage\n";
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
