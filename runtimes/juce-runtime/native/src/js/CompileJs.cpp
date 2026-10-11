// soundor_compile_js: compiles an ES module ahead of time into QuickJS bytecode
// (see Bytecode.h), at build time, for the runtime's own modules and a
// plugin's UI bundle.
//
//   soundor_compile_js <module.js> <output> <module name>
//
// <module name> is the name the runtime loads it under ("/bundle.js",
// "soundor:internal/ui"): it is in the bytecode, in stack traces and
// import.meta. Imports are not resolved here: each is a placeholder, linked
// when the runtime loads the module. The bytecode keeps line numbers, not
// source text. Exits non-zero, saying why, when the module does not compile.

#include "Bytecode.h"

#include <quickjs.h>

#include <cstdio>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

namespace
{
    int noExports(JSContext*, JSModuleDef*)
    {
        return 0;
    }

    // Every import is a placeholder: compiling does not need what it is.
    JSModuleDef* placeholder(JSContext* ctx, const char* name, void*)
    {
        return JS_NewCModule(ctx, name, noExports);
    }

    std::string describeException(JSContext* ctx)
    {
        JSValue exception = JS_GetException(ctx);
        const char* text = JS_ToCString(ctx, exception);
        std::string out = text == nullptr ? "unknown error" : text;
        JS_FreeCString(ctx, text);
        JSValue stack = JS_GetPropertyStr(ctx, exception, "stack");
        if (JS_IsString(stack))
        {
            const char* where = JS_ToCString(ctx, stack);
            if (where != nullptr)
                out += std::string("\n") + where;
            JS_FreeCString(ctx, where);
        }
        JS_FreeValue(ctx, stack);
        JS_FreeValue(ctx, exception);
        return out;
    }
} // namespace

int main(int argc, char** argv)
{
    if (argc != 4)
    {
        std::cerr << "usage: soundor_compile_js <module.js> <output> <module name>\n";
        return 2;
    }
    std::ifstream input(argv[1], std::ios::binary);
    if (! input)
    {
        std::cerr << "soundor_compile_js: cannot read " << argv[1] << "\n";
        return 1;
    }
    const std::string source((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());

    JSRuntime* rt = JS_NewRuntime();
    JS_SetModuleLoaderFunc(rt, nullptr, placeholder, nullptr);
    JSContext* ctx = JS_NewContext(rt);
    int status = 0;
    // JS_Eval reads up to a terminating NUL, which std::string has.
    JSValue module =
        JS_Eval(ctx, source.c_str(), source.size(), argv[3], JS_EVAL_TYPE_MODULE | JS_EVAL_FLAG_COMPILE_ONLY);
    if (JS_IsException(module))
    {
        std::cerr << "soundor_compile_js: " << argv[1] << ": " << describeException(ctx) << "\n";
        status = 1;
    }
    else
    {
        std::size_t size = 0;
        std::uint8_t* bytecode = JS_WriteObject(ctx, &size, module, JS_WRITE_OBJ_BYTECODE | JS_WRITE_OBJ_STRIP_SOURCE);
        JS_FreeValue(ctx, module);
        if (bytecode == nullptr)
        {
            std::cerr << "soundor_compile_js: " << argv[1] << ": " << describeException(ctx) << "\n";
            status = 1;
        }
        else
        {
            std::ofstream output(argv[2], std::ios::binary | std::ios::trunc);
            const std::string header = soundor::js::detail::bytecodeHeader();
            output.write(header.data(), static_cast<std::streamsize>(header.size()));
            output.write(reinterpret_cast<const char*>(bytecode), static_cast<std::streamsize>(size));
            if (! output)
            {
                std::cerr << "soundor_compile_js: cannot write " << argv[2] << "\n";
                status = 1;
            }
            js_free(ctx, bytecode);
        }
    }
    JS_FreeContext(ctx);
    JS_FreeRuntime(rt);
    return status;
}
