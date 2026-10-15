#include "../support/Modules.h"
#include "js/Bindings.h"

#include <soundor/js/Context.h>
#include <soundor/js/ModuleLoader.h>

#include <doctest/doctest.h>

#include <memory>
#include <stdexcept>
#include <string>

using namespace soundor::js;
namespace bind = soundor::js::bind;
namespace jsi = facebook::jsi;

namespace
{
    std::shared_ptr<MemoryModuleLoader> makeLoader()
    {
        auto loader = std::make_shared<MemoryModuleLoader>();
        loader->add("/app/math.js", soundor::test::module("export const add = (a, b) => a + b;"));
        loader->add("/app/lib/greet.js",
                    soundor::test::module("import { add } from '../math.js';\n"
                                          "export const greet = (n) => `hello ${n} (${add(1, 1)})`;"));
        return loader;
    }

    // A minimal native module, the shape generated bindings will take.
    detail::NativeModule answerModule()
    {
        return {
            [](detail::ContextState& context, jsi::Object& exports)
            {
                const auto doubleIt = [](detail::ContextState& c, const jsi::Value&, const jsi::Value* args,
                                         std::size_t count) -> jsi::Value
                {
                    if (count < 1 || ! args[0].isNumber())
                        bind::throwTypeError(c, "double() expects a number");
                    return { args[0].getNumber() * 2 };
                };
                bind::setProperty(context, exports, "answer", jsi::Value(42));
                bind::setProperty(context, exports, "double", bind::function(context, "double", 1, doubleIt));
            },
            {},
            {},
        };
    }
} // namespace

TEST_SUITE("Modules")
{
    TEST_CASE("MemoryModuleLoader resolves relative and absolute specifiers")
    {
        MemoryModuleLoader loader;
        CHECK(loader.resolve("./a.js", "/app/main.js").value() == "/app/a.js");
        CHECK(loader.resolve("../a.js", "/app/lib/x.js").value() == "/app/a.js");
        CHECK(loader.resolve("./b/../c/./d.js", "/app/main.js").value() == "/app/c/d.js");
        CHECK(loader.resolve("/lib/x.js", "/app/main.js").value() == "/lib/x.js");
        CHECK_FALSE(loader.resolve("../../../etc/passwd", "/app/main.js").ok());
        CHECK_FALSE(loader.resolve("react", "/app/main.js").ok());
    }

    TEST_CASE("evaluates a module graph through the loader")
    {
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = makeLoader() });
        auto result = context.evaluateModule(soundor::test::module("import { greet } from './lib/greet.js';\n"
                                                                   "globalThis.out = greet('soundor');"),
                                             "/app/main.js");
        REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
        CHECK(context.evaluateScript("out").value().asString() == "hello soundor (2)");
    }

    TEST_CASE("importModule loads an entry by name and evaluates each module once")
    {
        auto loader = makeLoader();
        loader->add("/app/counter.js",
                    soundor::test::module("globalThis.loads = (globalThis.loads ?? 0) + 1; export const n = 1;"));
        loader->add("/app/entry.js",
                    soundor::test::module("import './counter.js'; import { n } from '/app/counter.js';"));
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = loader });
        REQUIRE(context.importModule("/app/entry.js").ok());
        CHECK(context.evaluateScript("loads").value().asNumber() == 1);
    }

    TEST_CASE("exposes the module name as import.meta.url")
    {
        Runtime runtime;
        Context context(runtime);
        REQUIRE(
            context.evaluateModule(soundor::test::module("globalThis.url = import.meta.url;"), "/app/main.js").ok());
        CHECK(context.evaluateScript("url").value().asString() == "/app/main.js");
    }

    TEST_CASE("rejects bare specifiers and engine host modules")
    {
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = makeLoader() });
        for (const char* specifier : { "react", "std", "os", "qjs:std", "qjs:os", "node:fs" })
        {
            CAPTURE(specifier);
            auto result = context.evaluateModule(soundor::test::module(std::string("import '") + specifier + "';"),
                                                 "/app/main.js");
            REQUIRE_FALSE(result.ok());
            CHECK(result.error().message.find(specifier) != std::string::npos);
        }
    }

    TEST_CASE("without a loader only soundor: modules are importable")
    {
        Runtime runtime;
        Context context(runtime);
        auto result = context.evaluateModule(soundor::test::module("import './x.js';"), "/app/main.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().message.find("no module loader") != std::string::npos);
        CHECK_FALSE(context.importModule("/app/main.js").ok());
    }

    TEST_CASE("reports a missing module")
    {
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = makeLoader() });
        auto result = context.evaluateModule(soundor::test::module("import './missing.js';"), "/app/main.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().message == "Cannot find module '/app/missing.js'");
    }

    TEST_CASE("imports registered native modules")
    {
        Runtime runtime;
        Context context(runtime);
        registerNativeModule(context, "soundor:test", answerModule());
        auto result = context.evaluateModule(soundor::test::module("import { answer, double } from 'soundor:test';\n"
                                                                   "globalThis.out = double(answer);"),
                                             "/app/main.js");
        REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
        CHECK(context.evaluateScript("out").value().asNumber() == 84);

        auto misuse = context.evaluateModule(soundor::test::module("import { double } from 'soundor:test'; double();"),
                                             "/app/b.js");
        REQUIRE_FALSE(misuse.ok());
        CHECK(misuse.error().toString() == "TypeError: double() expects a number");
    }

    TEST_CASE("soundor: specifiers never reach the module loader")
    {
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = makeLoader() });
        auto result = context.evaluateModule(soundor::test::module("import 'soundor:missing';"), "/app/main.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().message == "Unknown Soundor module 'soundor:missing'");
    }

    TEST_CASE("module exceptions and rejected top-level await become errors")
    {
        Runtime runtime;
        Context context(runtime);

        auto thrown = context.evaluateModule(soundor::test::module("throw new Error('at load');"), "/app/a.js");
        REQUIRE_FALSE(thrown.ok());
        CHECK(thrown.error().toString() == "Error: at load");

        auto awaited =
            context.evaluateModule(soundor::test::module("await Promise.reject(new Error('async'));"), "/app/b.js");
        REQUIRE_FALSE(awaited.ok());
        CHECK(awaited.error().toString() == "Error: async");

        auto syntax = context.evaluateModule(soundor::test::module("export default {"), "/app/c.js");
        REQUIRE_FALSE(syntax.ok());
        CHECK(syntax.error().name == "SyntaxError");
    }

    TEST_CASE("top-level await settles while jobs are pumped")
    {
        Runtime runtime;
        Context context(runtime);
        REQUIRE(
            context.evaluateModule(soundor::test::module("globalThis.v = await Promise.resolve(7);"), "/app/main.js")
                .ok());
        CHECK(context.evaluateScript("v").value().asNumber() == 7);
    }

    TEST_CASE("a loader throwing a C++ exception becomes a JavaScript error")
    {
        struct ThrowingLoader final : ModuleLoader
        {
            Result<std::string> resolve(std::string_view, std::string_view) override
            {
                throw std::runtime_error("boom");
            }
            Result<std::string> load(std::string_view) override { return Error { "Error", "unreachable", {} }; }
        };
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = std::make_shared<ThrowingLoader>() });
        auto result = context.evaluateModule(soundor::test::module("import './x.js';"), "/app/main.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().name == "InternalError");
    }
}
