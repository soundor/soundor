#include "WebTestSupport.h"

#include <atomic>
#include <filesystem>
#include <fstream>
#include <memory>
#include <random>
#include <string>

using namespace soundor;
using test::WebFixture;
namespace fs = std::filesystem;

namespace
{
    // A unique, removed-on-exit directory.
    struct TempDir
    {
        TempDir()
            : path(fs::temp_directory_path()
                   / ("soundor-test-" + std::to_string(std::random_device {}()) + "-"
                      + std::to_string(counter++)))
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

    RuntimeHost::Options withData(const fs::path& directory)
    {
        RuntimeHost::Options options;
        options.dataDirectory = directory;
        options.pluginId = "com.example.test";
        options.pluginName = "Test";
        return options;
    }

    // Runs an async body to completion and returns its result (or "rejected:
    // <name>: <message>").
    js::Value await(WebFixture& f, const std::string& imports, const std::string& body)
    {
        f.run(imports + "globalThis.done = false; (async () => {" + body
              + "})().then((v) => { globalThis.result = v; }, (e) => { globalThis.result = 'rejected: ' + e.name"
                " + ': ' + e.message; }).finally(() => { globalThis.done = true; });");
        REQUIRE(f.tickUntil("done"));
        return f.eval("globalThis.result");
    }

    const std::string fsImports = "import * as fs from 'soundor:fs';\n";
    const std::string storageImports = "import { storage } from 'soundor:storage';\n";

    std::string readFile(const fs::path& path)
    {
        std::ifstream in(path, std::ios::binary);
        return { std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>() };
    }
} // namespace

TEST_SUITE("soundor:fs")
{
    TEST_CASE("writes, reads, lists, stats and removes inside the data directory")
    {
        TempDir data;
        WebFixture f(withData(data.path));
        CHECK(await(f, fsImports,
                    "await fs.writeText('presets/warm.json', '{\"gain\":0.5}');"
                    "await fs.writeBytes('raw.bin', new Uint8Array([1, 2, 3]));"
                    "await fs.mkdir('empty');"
                    "const listing = (await fs.readDir()).map((e) => e.name + ':' + e.kind).join(',');"
                    "const stat = await fs.stat('raw.bin');"
                    "const text = await fs.readText('presets/warm.json');"
                    "const bytes = Array.from(await fs.readBytes('raw.bin')).join(' ');"
                    "const before = await fs.exists('raw.bin'); await fs.remove('raw.bin');"
                    "return [listing, stat.kind, stat.size, stat.modified > 1.6e12, text, bytes, before,"
                    "  await fs.exists('raw.bin'), await fs.stat('missing')].join('|');")
                  .asString()
              == "empty:directory,presets:directory,raw.bin:file|file|3|true|{\"gain\":0.5}|1 2 3|true|false|");
        CHECK(readFile(data.path / "files" / "presets" / "warm.json") == "{\"gain\":0.5}");
    }

    TEST_CASE("paths cannot leave the data directory")
    {
        TempDir data;
        WebFixture f(withData(data.path));
        for (const std::string path : { "../escape.txt", "a/../../escape.txt", "/etc/passwd", "C:/Windows/x", "a\\\\b" })
        {
            CAPTURE(path);
            const std::string result =
                await(f, fsImports, std::string("return await fs.readText('") + path + "');").asString();
            CAPTURE(result);
            CHECK(result.find("rejected: TypeError: Invalid path") == 0);
        }
        // A symlink pointing outside the root is refused.
        TempDir outside;
        fs::create_directories(data.path / "files");
        std::error_code error;
        fs::create_directory_symlink(outside.path, data.path / "files" / "link", error);
        if (! error)
        {
            CHECK(await(f, fsImports, "return await fs.writeText('link/x.txt', 'escaped');").asString()
                  == "rejected: NotAllowedError: 'link/x.txt' leads outside the data directory");
            CHECK_FALSE(fs::exists(outside.path / "x.txt"));
        }
    }

    TEST_CASE("errors carry DOMException names")
    {
        TempDir data;
        WebFixture f(withData(data.path));
        CHECK(await(f, fsImports, "return await fs.readText('missing.txt');").asString().find(
                  "rejected: NotFoundError: cannot read 'missing.txt'")
              == 0);
        CHECK(await(f, fsImports, "await fs.mkdir('d'); await fs.writeText('d/f', 'x'); await fs.remove('d');")
                  .asString()
                  .find("rejected: InvalidModificationError")
              == 0);
        CHECK(await(f, fsImports, "await fs.remove('d', { recursive: true }); return await fs.exists('d');")
                  .asBoolean()
              == false);
        CHECK(await(f, fsImports, "await fs.mkdir('x'); await fs.mkdir('x');").asString().find(
                  "rejected: InvalidModificationError")
              == 0);
        CHECK(await(f, fsImports, "await fs.mkdir('deep/er/est', { recursive: true }); return 'ok';").asString()
              == "ok");
        CHECK(await(f, fsImports, "await fs.remove('.');").asString()
              == "rejected: NotAllowedError: cannot remove the root directory");
        CHECK(await(f, fsImports, "await fs.writeBytes('x', [1, 2]);").asString()
              == "rejected: TypeError: writeBytes() expects an ArrayBuffer or a typed array");
    }

    TEST_CASE("rejects every operation without a data directory")
    {
        WebFixture f;
        CHECK(await(f, fsImports, "return await fs.readText('a');").asString()
              == "rejected: NotAllowedError: this plugin has no data directory");
    }
}

TEST_SUITE("soundor:storage")
{
    TEST_CASE("stores JSON values persistently, per plugin")
    {
        TempDir data;
        {
            WebFixture f(withData(data.path));
            CHECK(await(f, storageImports,
                        "await storage.set('volume', 0.5); await storage.set('preset', { name: 'warm', tags: ['a'] });"
                        "await storage.set('unicode \\u2713', 'ü\\n\"q\"'); await storage.set('gone', 1);"
                        "await storage.delete('gone');"
                        "return [await storage.get('volume'), (await storage.get('preset')).tags[0],"
                        "  await storage.get('gone'), (await storage.keys()).join()].join('|');")
                      .asString()
                  == "0.5|a||preset,unicode ✓,volume");
        }
        // A new runtime (e.g. after a reload or a session restore) sees the data.
        WebFixture again(withData(data.path));
        CHECK(await(again, storageImports, "return (await storage.get('preset')).name + await storage.get('unicode ✓');")
                  .asString()
              == "warmü\n\"q\"");
        CHECK(await(again, storageImports, "await storage.clear(); return (await storage.keys()).length;").asNumber()
              == 0);
        // Another plugin's directory is a different store.
        TempDir other;
        WebFixture otherPlugin(withData(other.path));
        CHECK(await(otherPlugin, storageImports, "return (await storage.keys()).length;").asNumber() == 0);
    }

    TEST_CASE("rejects values JSON cannot represent and non-string keys")
    {
        TempDir data;
        WebFixture f(withData(data.path));
        CHECK(await(f, storageImports, "await storage.set('f', () => {});").asString()
              == "rejected: TypeError: soundor:storage cannot store function values; store JSON data");
        CHECK(await(f, storageImports, "await storage.set(1, 'x');").asString()
              == "rejected: TypeError: Storage keys must be strings");
    }

    TEST_CASE("reports a corrupt storage file instead of losing it")
    {
        TempDir data;
        {
            std::ofstream(data.path / "storage.json") << "not json";
        }
        WebFixture f(withData(data.path));
        CHECK(await(f, storageImports, "return await storage.get('x');").asString()
              == "rejected: DataError: the plugin's storage file is corrupt");
        CHECK(readFile(data.path / "storage.json") == "not json");
    }

    TEST_CASE("writes made before teardown reach the disk")
    {
        TempDir data;
        {
            WebFixture f(withData(data.path));
            f.run(storageImports + "for (let i = 0; i < 20; i++) storage.set('k' + i, i);");
        }
        const std::string stored = readFile(data.path / "storage.json");
        CHECK(stored.find("\"k19\": \"19\"") != std::string::npos);
    }
}

namespace
{
    struct FakeHostInfo final : platform::HostInfo
    {
        [[nodiscard]] platform::HostSnapshot snapshot() const override { return current; }
        platform::HostSnapshot current;
    };
} // namespace

TEST_SUITE("soundor:host")
{
    TEST_CASE("exposes the plugin identity and host snapshots")
    {
        auto host = std::make_shared<FakeHostInfo>();
        host->current.sampleRate = 48000;
        host->current.blockSize = 256;
        host->current.hostName = "Test DAW";
        auto options = withData({});
        options.hostInfo = host;
        WebFixture f(options);
        CHECK(f.run("import { plugin, snapshot } from 'soundor:host';"
                    "const s = snapshot();"
                    "globalThis.result = [plugin.id, plugin.name, s.sampleRate, s.blockSize, s.hostName, s.transport,"
                    "  Object.isFrozen(s)].join('|');")
                  .asString()
              == "com.example.test|Test|48000|256|Test DAW||true");
    }

    TEST_CASE("delivers changes to subscribers, once per change")
    {
        auto host = std::make_shared<FakeHostInfo>();
        auto options = withData({});
        options.hostInfo = host;
        WebFixture f(options);
        f.run("import { subscribe } from 'soundor:host';"
              "globalThis.seen = [];"
              "globalThis.stop = subscribe((s) => seen.push(s.transport?.playing ? 'playing ' + s.transport.bpm"
              "  + ' ' + s.transport.timeSignature.numerator + '/' + s.transport.timeSignature.denominator : 'stopped'));");
        f.host.tick(); // first tick: the initial state counts as a change
        f.host.tick(); // unchanged: nothing
        platform::Transport transport;
        transport.playing = true;
        transport.bpm = 128;
        transport.timeSignatureNumerator = 7;
        transport.timeSignatureDenominator = 8;
        host->current.transport = transport;
        f.host.tick();
        f.host.tick();
        f.eval("stop()");
        host->current.transport.reset();
        f.host.tick();
        CHECK(f.eval("seen.join('|')").asString() == "stopped|playing 128 7/8");
    }

    TEST_CASE("without host information the snapshot is empty")
    {
        WebFixture f;
        CHECK(f.run("import { plugin, snapshot } from 'soundor:host';"
                    "globalThis.result = JSON.stringify([plugin, snapshot()]);")
                  .asString()
              == "[{\"id\":\"\",\"name\":\"\"},{\"sampleRate\":0,\"blockSize\":0,\"hostName\":\"\",\"transport\":null}]");
    }
}
