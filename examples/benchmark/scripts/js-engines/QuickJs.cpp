#include <quickjs.h>

#include <cstdint>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

namespace
{
    JSValue print(JSContext* context, JSValueConst, int argc, JSValueConst* argv)
    {
        for (int i = 0; i < argc; ++i)
        {
            const char* text = JS_ToCString(context, argv[i]);
            if (text == nullptr)
                return JS_EXCEPTION;
            if (i != 0)
                std::cout << ' ';
            std::cout << text;
            JS_FreeCString(context, text);
        }
        std::cout << '\n';
        return JS_UNDEFINED;
    }

    void reportException(JSContext* context)
    {
        JSValue exception = JS_GetException(context);
        JSValue stack = JS_GetPropertyStr(context, exception, "stack");
        for (JSValueConst value : { exception, stack })
        {
            const char* text = JS_ToCString(context, value);
            if (text != nullptr)
            {
                std::cerr << text << '\n';
                JS_FreeCString(context, text);
            }
        }
        JS_FreeValue(context, stack);
        JS_FreeValue(context, exception);
    }
} // namespace

int main(int argc, char** argv)
{
    const bool compile = argc == 4 && std::string(argv[1]) == "--compile";
    const bool bytecode = argc == 3 && std::string(argv[1]) == "--bytecode";
    if (! compile && ! bytecode && argc != 2)
    {
        std::cerr << "Usage: soundor_bench_js <source.js> | --compile <source.js> <out.qbc> | --bytecode <out.qbc>\n";
        return 1;
    }
    const char* filename = argv[compile || bytecode ? 2 : 1];
    std::ifstream input(filename, std::ios::binary);
    if (! input)
    {
        std::cerr << "Cannot read " << filename << '\n';
        return 1;
    }
    const std::string source { std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>() };
    JSRuntime* runtime = JS_NewRuntime();
    if (runtime == nullptr)
        return 1;
    JS_SetMaxStackSize(runtime, 512 * 1024);
    JSContext* context = JS_NewContext(runtime);
    if (context == nullptr)
    {
        JS_FreeRuntime(runtime);
        return 1;
    }
    JSValue global = JS_GetGlobalObject(context);
    JS_SetPropertyStr(context, global, "print", JS_NewCFunction(context, print, "print", 1));
    JS_FreeValue(context, global);
    JSValue result;
    if (bytecode)
    {
        result = JS_ReadObject(context, reinterpret_cast<const std::uint8_t*>(source.data()), source.size(),
                               JS_READ_OBJ_BYTECODE);
        if (! JS_IsException(result))
            result = JS_EvalFunction(context, result);
    }
    else
    {
        result = JS_Eval(context, source.c_str(), source.size(), filename,
                         JS_EVAL_TYPE_GLOBAL | (compile ? JS_EVAL_FLAG_COMPILE_ONLY : 0));
    }
    int status = 0;
    if (JS_IsException(result))
    {
        reportException(context);
        status = 1;
    }
    else if (compile)
    {
        std::size_t size = 0;
        auto* bytes = JS_WriteObject(context, &size, result, JS_WRITE_OBJ_BYTECODE | JS_WRITE_OBJ_STRIP_SOURCE);
        if (bytes == nullptr)
        {
            reportException(context);
            status = 1;
        }
        else
        {
            std::ofstream output(argv[3], std::ios::binary);
            output.write(reinterpret_cast<const char*>(bytes), static_cast<std::streamsize>(size));
            status = output ? 0 : 1;
            js_free(context, bytes);
        }
    }
    JS_FreeValue(context, result);
    JS_FreeContext(context);
    JS_FreeRuntime(runtime);
    return status;
}
