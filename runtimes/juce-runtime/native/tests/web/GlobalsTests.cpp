#include "WebTestSupport.h"

#include <string>
#include <vector>

using namespace soundor;
using test::WebFixture;

TEST_SUITE("web globals")
{
    TEST_CASE("globalThis and self are the same object")
    {
        WebFixture f;
        CHECK(f.run("globalThis.result = self === globalThis;").asBoolean());
    }

    TEST_CASE("installs the Web-compatible globals, non-enumerable")
    {
        WebFixture f;
        for (const char* name : { "console", "performance", "setTimeout", "clearTimeout", "setInterval",
                                  "clearInterval", "queueMicrotask", "reportError", "DOMException", "atob", "btoa" })
        {
            CAPTURE(name);
            CHECK(f.eval(std::string("typeof ") + name).asString() != "undefined");
            CHECK_FALSE(f.eval(std::string("Object.keys(globalThis).includes('") + name + "')").asBoolean());
        }
    }

    TEST_CASE("does not pretend to be a browser or Node")
    {
        WebFixture f;
        for (const char* name : { "window", "document", "HTMLElement", "navigator", "location", "localStorage",
                                  "XMLHttpRequest", "global", "process", "require", "module", "exports",
                                  "Buffer", "std", "os", "print", "scriptArgs" })
        {
            CAPTURE(name);
            CHECK(f.eval(std::string("typeof ") + name).asString() == "undefined");
        }
    }

    TEST_CASE("internal platform modules stay private")
    {
        WebFixture f;
        CHECK(f.error("import 'soundor:internal/platform';")
              == "TypeError: Cannot import 'soundor:internal/platform': it is internal to the Soundor runtime");
        CHECK(f.error("import 'soundor:internal/web/timers';").find("internal to the Soundor runtime")
              != std::string::npos);
    }

    TEST_CASE("DOMException, atob and btoa come from the engine")
    {
        WebFixture f;
        CHECK(f.run("const e = new DOMException('gone', 'AbortError');"
                    "globalThis.result = [e.name, e.message, e.code, e instanceof Error].join();")
                  .asString()
              == "AbortError,gone,20,true");
        CHECK(f.run("globalThis.result = btoa('Soundor') + ' ' + atob('U291bmRvcg==');").asString()
              == "U291bmRvcg== Soundor");
        CHECK(f.run("globalThis.result = atob(btoa('ü'));").asString() == "ü"); // Latin-1 is fine
        CHECK(f.error("btoa('✓');").find("InvalidCharacterError") != std::string::npos);
    }
}

TEST_SUITE("console")
{
    TEST_CASE("writes each method at its log level")
    {
        WebFixture f;
        f.run("console.debug('d'); console.log('l'); console.info('i'); console.warn('w'); console.error('e');");
        const std::vector<std::pair<js::LogLevel, std::string>> expected {
            { js::LogLevel::Debug, "d" }, { js::LogLevel::Info, "l" },  { js::LogLevel::Info, "i" },
            { js::LogLevel::Warn, "w" },  { js::LogLevel::Error, "e" },
        };
        CHECK(f.logs == expected);
    }

    TEST_CASE("formats arguments like a terminal console")
    {
        WebFixture f;
        f.run("console.log('gain', 0.5, true, null, undefined, 10n, Symbol('s'));"
              "console.log('%s is %d dB (%i, %f) %j %%', 'gain', '-6.5', 7.9, '1.25', { a: 1 });"
              "console.log({ a: 1, b: [1, 2, { c: 'x' }], 'odd key': new Map([[1, 2]]) });"
              "console.log(new Set([1]), new Float32Array([0.5, 1]), new ArrayBuffer(8), new Date(0));"
              "console.log(function named() {}, () => {}, class Thing {}, new (class Thing {})());"
              "const cyclic = { name: 'x' }; cyclic.self = cyclic; console.log(cyclic);"
              "console.log({ deep: { deeper: { deepest: { gone: 1 } } } });"
              "console.log('%c styled', 'color: red');");
        const std::vector<std::string> expected {
            "gain 0.5 true null undefined 10n Symbol(s)",
            "gain is -6.5 dB (7, 1.25) {\"a\":1} %",
            "{ a: 1, b: [ 1, 2, { c: 'x' } ], 'odd key': Map(1) { 1 => 2 } }",
            "Set(1) { 1 } Float32Array(2) [ 0.5, 1 ] ArrayBuffer { byteLength: 8 } 1970-01-01T00:00:00.000Z",
            "[Function: named] [Function (anonymous)] [class: Thing] Thing {}",
            "{ name: 'x', self: [Circular] }",
            "{ deep: { deeper: { deepest: [Object] } } }",
            " styled",
        };
        REQUIRE(f.logs.size() == expected.size());
        for (std::size_t i = 0; i < expected.size(); ++i)
            CHECK(f.logs[i].second == expected[i]);
    }

    TEST_CASE("prints errors with their stack")
    {
        WebFixture f;
        f.run("function failing() { return new TypeError('bad'); } console.error(failing());");
        REQUIRE(f.logs.size() == 1);
        CHECK(f.logs[0].second.find("TypeError: bad\n") == 0);
        CHECK(f.logs[0].second.find("failing") != std::string::npos);
    }

    TEST_CASE("groups, counts, asserts and times")
    {
        WebFixture f;
        f.run("console.group('outer'); console.log('a\\nb'); console.group(); console.log('c');"
              "console.groupEnd(); console.groupEnd(); console.log('d');"
              "console.count(); console.count(); console.count('x'); console.countReset(); console.count();"
              "console.assert(true, 'never'); console.assert(false, 'oops', 1);"
              "console.timeLog('missing'); console.time('t'); console.timeEnd('t');");
        REQUIRE(f.logs.size() >= 11);
        CHECK(f.logs[0].second == "outer");
        CHECK(f.logs[1].second == "  a\n  b");
        CHECK(f.logs[2].second == "    c");
        CHECK(f.logs[3].second == "d");
        CHECK(f.logs[4].second == "default: 1");
        CHECK(f.logs[5].second == "default: 2");
        CHECK(f.logs[6].second == "x: 1");
        CHECK(f.logs[7].second == "default: 1");
        CHECK(f.logs[8] == std::pair { js::LogLevel::Error, std::string("Assertion failed: oops 1") });
        CHECK(f.logs[9] == std::pair { js::LogLevel::Warn, std::string("Timer 'missing' does not exist") });
        CHECK(f.logs[10].second.find("t: ") == 0);
        CHECK(f.logs[10].second.ends_with(" ms"));
    }

    TEST_CASE("reportError logs uncaught errors")
    {
        WebFixture f;
        f.run("reportError(new Error('lost'));");
        REQUIRE(f.logs.size() == 1);
        CHECK(f.logs[0].first == js::LogLevel::Error);
        CHECK(f.logs[0].second.find("Uncaught Error: lost") == 0);
    }
}

TEST_SUITE("timers")
{
    TEST_CASE("setTimeout runs callbacks in due order with arguments")
    {
        WebFixture f;
        f.run("globalThis.order = [];"
              "setTimeout((x) => order.push(x), 20, 'late');"
              "setTimeout((x, y) => order.push(x + y), 0, 'ea', 'rly');"
              "setTimeout(() => order.push('mid'), 5);");
        CHECK(f.eval("order.length").asNumber() == 0); // nothing runs synchronously
        REQUIRE(f.tickUntil("order.length === 3"));
        CHECK(f.eval("order.join()").asString() == "early,mid,late");
    }

    TEST_CASE("clearTimeout cancels, including from another callback")
    {
        WebFixture f;
        f.run("globalThis.ran = [];"
              "const doomed = setTimeout(() => ran.push('doomed'), 10);"
              "setTimeout(() => { ran.push('first'); clearTimeout(doomed); }, 0);"
              "const id = setTimeout(() => ran.push('never'), 0); clearTimeout(id); clearTimeout(id);"
              "clearTimeout(undefined); clearTimeout(12345);"
              "setTimeout(() => ran.push('done'), 30);");
        REQUIRE(f.tickUntil("ran.includes('done')"));
        CHECK(f.eval("ran.join()").asString() == "first,done");
    }

    TEST_CASE("setInterval repeats until cleared")
    {
        WebFixture f;
        f.run("globalThis.count = 0;"
              "const id = setInterval(() => { if (++count === 3) clearInterval(id); }, 1);");
        REQUIRE(f.tickUntil("count === 3"));
        f.tickFor(std::chrono::milliseconds(20));
        CHECK(f.eval("count").asNumber() == 3);
    }

    TEST_CASE("timers started by a timer wait for a later tick")
    {
        WebFixture f;
        f.run("globalThis.log = [];"
              "setTimeout(() => { log.push('a'); setTimeout(() => log.push('b'), 0); }, 0);");
        REQUIRE(f.tickUntil("log.length >= 1"));
        CHECK(f.eval("log.join()").asString() == "a");
        f.host.tick();
        CHECK(f.eval("log.join()").asString() == "a,b");
    }

    TEST_CASE("a throwing timer is reported and others still run")
    {
        WebFixture f;
        f.run("globalThis.ok = false;"
              "setTimeout(() => { throw new Error('timer failed'); }, 0);"
              "setTimeout(() => { ok = true; }, 0);");
        REQUIRE(f.tickUntil("ok"));
        REQUIRE(f.logs.size() == 1);
        CHECK(f.logs[0].second.find("Uncaught Error: timer failed") == 0);
    }

    TEST_CASE("validates callbacks and normalizes delays")
    {
        WebFixture f;
        CHECK(f.error("setTimeout('alert(1)');") == "TypeError: The timer callback must be a function");
        f.run("globalThis.fired = 0; setTimeout(() => fired++, -5); setTimeout(() => fired++, NaN);"
              "setTimeout(() => fired++, 'x'); globalThis.result = typeof setTimeout(() => {}, 1e12);");
        CHECK(f.eval("result").asString() == "number");
        REQUIRE(f.tickUntil("fired === 3"));
    }

    TEST_CASE("queueMicrotask runs before the next timer, errors are reported")
    {
        WebFixture f;
        f.run("globalThis.order = [];"
              "setTimeout(() => order.push('timer'), 0);"
              "queueMicrotask(() => order.push('micro'));"
              "queueMicrotask(() => { throw new Error('micro failed'); });");
        REQUIRE(f.tickUntil("order.length === 2"));
        CHECK(f.eval("order.join()").asString() == "micro,timer");
        CHECK(f.logs.at(0).second.find("Uncaught Error: micro failed") == 0);
        CHECK(f.error("queueMicrotask(1);") == "TypeError: queueMicrotask() expects a function");
    }

    TEST_CASE("pending timers are released with the runtime")
    {
        for (int i = 0; i < 20; ++i)
        {
            WebFixture f;
            f.run("for (let i = 0; i < 100; i++) setTimeout(() => {}, 1000 * i);"
                  "setInterval(() => {}, 1);");
            f.host.tick();
        }
    }
}

TEST_SUITE("performance")
{
    TEST_CASE("now() is monotonic, relative to timeOrigin")
    {
        WebFixture f;
        f.run("const a = performance.now(); const b = performance.now();"
              "globalThis.result = a >= 0 && b >= a && performance.timeOrigin > 1.6e12"
              " && Math.abs(performance.timeOrigin + b - Date.now()) < 1000;");
        CHECK(f.eval("result").asBoolean());
        CHECK(f.eval("JSON.stringify(performance).includes('timeOrigin')").asBoolean());
    }
}
