#include <soundor/platform/FileLog.h>
#include <soundor/runtime/DevSession.h>

#include <doctest/doctest.h>

#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <random>
#include <string>
#include <thread>
#include <vector>

using namespace soundor;
namespace fs = std::filesystem;

namespace
{
    struct TempDir
    {
        TempDir()
            : path(fs::temp_directory_path()
                   / ("soundor-dev-" + std::to_string(std::random_device {}()) + "-" + std::to_string(counter++)))
        {
            fs::create_directories(path);
        }
        ~TempDir()
        {
            std::error_code ignored;
            fs::remove_all(path, ignored);
        }
        TempDir(const TempDir&) = delete;
        TempDir& operator=(const TempDir&) = delete;
        fs::path path;
        static inline std::atomic<int> counter { 0 };
    };

    // Records what reaches the "plugin" across reloads.
    struct RecordingHost final : parameters::Host
    {
        std::vector<parameters::Info> declared { { "gain", "Gain", parameters::Kind::Float, 0, 1, 0.5, "", {} } };
        double gain = 0.5;
        parameters::ChangeFlags flags { 1 };
        std::vector<std::string> log;
        [[nodiscard]] std::span<const parameters::Info> infos() const override { return declared; }
        [[nodiscard]] double value(std::size_t) const override { return gain; }
        void setValue(std::size_t, double v) override { gain = v; }
        void beginGesture(std::size_t) override { log.emplace_back("begin"); }
        void endGesture(std::size_t) override { log.emplace_back("end"); }
        parameters::ChangeFlags& changes() override { return flags; }
    };

    struct Fixture
    {
        Fixture()
            : session({ .host = { .runtime = { .log = [this](js::LogLevel, std::string_view message)
                                               { logs.emplace_back(message); } },
                                  .parameters = parameters },
                        .bundleDirectory = dir.path,
                        .pollInterval = std::chrono::milliseconds(0) })
        {
        }

        // Writes a bundle, then (last, like the CLI) its build id.
        void build(const std::string& code, const std::string& id) const
        {
            std::ofstream(dir.path / "bundle.js") << code;
            std::ofstream(dir.path / "build-id") << id;
        }

        [[nodiscard]] bool sawLog(const std::string& text) const
        {
            return std::any_of(logs.begin(), logs.end(),
                               [&](const std::string& line) { return line.find(text) != std::string::npos; });
        }

        std::vector<std::string> logs;
        TempDir dir;
        std::shared_ptr<RecordingHost> parameters = std::make_shared<RecordingHost>();
        DevSession session;
    };

    constexpr const char* v1 = R"(
        import { parameters } from 'soundor:parameters';
        globalThis.version = 1;
        parameters.gain.subscribe((g) => console.info('v1 saw ' + g));
        parameters.gain.beginGesture();
        setInterval(() => console.info('v1 timer'), 0);
    )";
    constexpr const char* v2 = R"(
        import { parameters } from 'soundor:parameters';
        globalThis.version = 2;
        parameters.gain.subscribe((g) => console.info('v2 saw ' + g));
    )";
} // namespace

TEST_SUITE("DevSession")
{
    TEST_CASE("waits for the first build, then loads it")
    {
        Fixture f;
        CHECK(f.session.buildId().empty());
        CHECK(f.sawLog("Waiting for the first UI build"));
        f.session.tick();
        CHECK(f.session.reloadCount() == 0);

        f.build(v1, "1");
        f.session.tick();
        CHECK(f.session.buildId() == "1");
        CHECK(f.session.host().context().evaluateScript("version").value().asNumber() == 1);
        CHECK(f.sawLog("UI reloaded"));
    }

    TEST_CASE("a new build replaces the runtime and everything the old one held")
    {
        Fixture f;
        f.build(v1, "1");
        f.session.reload();
        f.session.tick();
        REQUIRE(f.sawLog("v1 timer"));
        CHECK(f.parameters->log == std::vector<std::string> { "begin" });

        f.build(v2, "2");
        f.session.tick(); // reloads, then ticks the new runtime
        f.logs.clear();
        f.parameters->gain = 0.75;
        f.parameters->flags.markChanged(0);
        for (int i = 0; i < 5; ++i)
            f.session.tick();

        CHECK(f.session.host().context().evaluateScript("version").value().asNumber() == 2);
        CHECK(f.sawLog("v2 saw 0.75"));
        CHECK_FALSE(f.sawLog("v1"));                                             // no old subscribers, no old timers
        CHECK(f.parameters->log == std::vector<std::string> { "begin", "end" }); // old gesture ended
    }

    TEST_CASE("a broken build is reported and the next good one recovers")
    {
        Fixture f;
        f.build(v1, "1");
        f.session.tick();
        f.build("export const = ;", "2");
        f.session.tick();
        CHECK(f.session.buildId() == "2");
        CHECK(f.sawLog("The plugin UI failed to start: SyntaxError"));
        CHECK(f.session.host().context().evaluateScript("typeof version").value().asString() == "undefined");

        f.build(v2, "3");
        f.session.tick();
        CHECK(f.session.host().context().evaluateScript("version").value().asNumber() == 2);
    }

    TEST_CASE("an unchanged build id does not reload")
    {
        Fixture f;
        f.build(v2, "7");
        f.session.tick();
        const unsigned reloads = f.session.reloadCount();
        for (int i = 0; i < 10; ++i)
            f.session.tick();
        CHECK(f.session.reloadCount() == reloads);
    }

    TEST_CASE("many reloads leave nothing behind")
    {
        Fixture f;
        for (int i = 1; i <= 20; ++i)
        {
            f.build(i % 2 == 0 ? v1 : v2, std::to_string(i));
            f.session.tick();
        }
        CHECK(f.session.reloadCount() == 20);
        // Only the fixture and the session's options hold the host now.
        CHECK(f.parameters.use_count() <= 3);
    }

    TEST_CASE("polls at most once per interval")
    {
        TempDir dir;
        DevSession session({ .bundleDirectory = dir.path, .pollInterval = std::chrono::hours(1) });
        std::ofstream(dir.path / "bundle.js") << "globalThis.version = 1;";
        std::ofstream(dir.path / "build-id") << "1";
        session.tick();
        CHECK(session.buildId().empty()); // not yet looked
        session.reload();
        CHECK(session.buildId() == "1");
    }
}

TEST_SUITE("fileLogSink")
{
    TEST_CASE("appends one escaped JSON object per line")
    {
        TempDir dir;
        const auto file = dir.path / "nested" / "ui.log";
        {
            auto sink = platform::fileLogSink(file, "Soundor \"Basic\"");
            sink(js::LogLevel::Info, "hello");
            sink(js::LogLevel::Error, "line 1\nline 2\t\\ \x01");
            auto second = platform::fileLogSink(file, "other");
            second(js::LogLevel::Warn, "appended");
        }
        std::ifstream in(file);
        std::vector<std::string> lines;
        for (std::string line; std::getline(in, line);)
            lines.push_back(line);
        REQUIRE(lines.size() == 3);
        CHECK(lines[0] == R"({"level":"info","source":"Soundor \"Basic\"","message":"hello"})");
        CHECK(lines[1] == R"({"level":"error","source":"Soundor \"Basic\"","message":"line 1\nline 2\t\\ \u0001"})");
        CHECK(lines[2] == R"({"level":"warn","source":"other","message":"appended"})");
    }
}
