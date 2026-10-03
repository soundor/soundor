#include "js/Internal.h"

#include <soundor/js/Context.h>
#include <soundor/js/ModuleLoader.h>

#include <doctest/doctest.h>

#include <memory>
#include <stdexcept>
#include <string>

using namespace soundor::js;

namespace
{
    std::shared_ptr<MemoryModuleLoader> makeLoader()
    {
        auto loader = std::make_shared<MemoryModuleLoader>();
        loader->add("/app/math.js", "export const add = (a, b) => a + b;");
        loader->add("/app/lib/greet.js", "import { add } from '../math.js';\n"
                                         "export const greet = (n) => `hello ${n} (${add(1, 1)})`;");
        return loader;
    }

    // A minimal native module, the shape generated bindings will take.
    detail::NativeModule answerModule()
    {
        return {
            { "answer", "double" },
            [](JSContext* ctx, JSModuleDef* module)
            {
                auto doubleIt = [](JSContext* c, JSValueConst, int argc, JSValueConst* argv) -> JSValue
                {
                    double value = 0;
                    if (argc < 1 || JS_ToFloat64(c, &value, argv[0]) < 0)
                        return JS_ThrowTypeError(c, "double() expects a number");
                    return JS_NewFloat64(c, value * 2);
                };
                return JS_SetModuleExport(ctx, module, "answer", JS_NewInt32(ctx, 42)) == 0
                       && JS_SetModuleExport(ctx, module, "double", JS_NewCFunction(ctx, doubleIt, "double", 1)) == 0;
            },
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
        auto result = context.evaluateModule("import { greet } from './lib/greet.js';\n"
                                             "globalThis.out = greet('soundor');",
                                             "/app/main.js");
        REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
        CHECK(context.evaluateScript("out").value().asString() == "hello soundor (2)");
    }

    TEST_CASE("importModule loads an entry by name and evaluates each module once")
    {
        auto loader = makeLoader();
        loader->add("/app/counter.js", "globalThis.loads = (globalThis.loads ?? 0) + 1; export const n = 1;");
        loader->add("/app/entry.js", "import './counter.js'; import { n } from '/app/counter.js';");
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = loader });
        REQUIRE(context.importModule("/app/entry.js").ok());
        CHECK(context.evaluateScript("loads").value().asNumber() == 1);
    }

    TEST_CASE("exposes the module name as import.meta.url")
    {
        Runtime runtime;
        Context context(runtime);
        REQUIRE(context.evaluateModule("globalThis.url = import.meta.url;", "/app/main.js").ok());
        CHECK(context.evaluateScript("url").value().asString() == "/app/main.js");
    }

    TEST_CASE("rejects bare specifiers and QuickJS host modules")
    {
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = makeLoader() });
        for (const char* specifier : { "react", "std", "os", "qjs:std", "qjs:os", "node:fs" })
        {
            CAPTURE(specifier);
            auto result = context.evaluateModule(std::string("import '") + specifier + "';", "/app/main.js");
            REQUIRE_FALSE(result.ok());
            CHECK(result.error().message.find(specifier) != std::string::npos);
        }
    }

    TEST_CASE("without a loader only soundor: modules are importable")
    {
        Runtime runtime;
        Context context(runtime);
        auto result = context.evaluateModule("import './x.js';", "/app/main.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().message.find("no module loader") != std::string::npos);
        CHECK_FALSE(context.importModule("/app/main.js").ok());
    }

    TEST_CASE("reports a missing module")
    {
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = makeLoader() });
        auto result = context.evaluateModule("import './missing.js';", "/app/main.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().message == "Cannot find module '/app/missing.js'");
    }

    TEST_CASE("imports registered native modules")
    {
        Runtime runtime;
        Context context(runtime);
        registerNativeModule(context, "soundor:test", answerModule());
        auto result = context.evaluateModule("import { answer, double } from 'soundor:test';\n"
                                             "globalThis.out = double(answer);",
                                             "/app/main.js");
        REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
        CHECK(context.evaluateScript("out").value().asNumber() == 84);

        auto misuse = context.evaluateModule("import { double } from 'soundor:test'; double();", "/app/b.js");
        REQUIRE_FALSE(misuse.ok());
        CHECK(misuse.error().toString() == "TypeError: double() expects a number");
    }

    TEST_CASE("soundor: specifiers never reach the module loader")
    {
        Runtime runtime;
        Context context(runtime, ContextOptions { .moduleLoader = makeLoader() });
        auto result = context.evaluateModule("import 'soundor:missing';", "/app/main.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().message == "Unknown Soundor module 'soundor:missing'");
    }

    TEST_CASE("module exceptions and rejected top-level await become errors")
    {
        Runtime runtime;
        Context context(runtime);

        auto thrown = context.evaluateModule("throw new Error('at load');", "/app/a.js");
        REQUIRE_FALSE(thrown.ok());
        CHECK(thrown.error().toString() == "Error: at load");

        auto awaited = context.evaluateModule("await Promise.reject(new Error('async'));", "/app/b.js");
        REQUIRE_FALSE(awaited.ok());
        CHECK(awaited.error().toString() == "Error: async");

        auto syntax = context.evaluateModule("export default {", "/app/c.js");
        REQUIRE_FALSE(syntax.ok());
        CHECK(syntax.error().name == "SyntaxError");
    }

    TEST_CASE("top-level await settles while jobs are pumped")
    {
        Runtime runtime;
        Context context(runtime);
        REQUIRE(context.evaluateModule("globalThis.v = await Promise.resolve(7);", "/app/main.js").ok());
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
        auto result = context.evaluateModule("import './x.js';", "/app/main.js");
        REQUIRE_FALSE(result.ok());
        CHECK(result.error().name == "InternalError");
    }
}
