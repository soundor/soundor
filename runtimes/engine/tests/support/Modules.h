#pragma once

// Test-only: the native tests write their snippets as ES modules; the runtime
// runs modules in its own form (engine/README.md, "Modules"), which @soundor/core's
// toNativeModule() makes from ES modules at build time. This makes the same
// from a test snippet with regular expressions over its import and export
// declarations — enough for snippets, and nothing a plugin goes through.
//
// - `import { a, b as c } from 's'`  →  `const { a, b: c } = require('s')`
// - `import * as X from 's'`         →  `const X = require('s')`
// - `import X from 's'`              →  `const X = require('s').default`
// - `import 's'`                     →  `require('s')`
// - `import('s')`                    →  a promise of require('s')
// - `export const|let|var|function|class x`, `export default`, `import.meta`
//
// The module function is async, so a snippet may await at top level; its
// first line stays its first line.

#include <regex>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::test
{
    inline std::string module(std::string_view esm)
    {
        std::string code(esm);
        const auto replace = [&code](const char* pattern, const char* replacement)
        { code = std::regex_replace(code, std::regex(pattern), replacement); };

        // Named imports: "a as b" becomes "a: b" inside the braces.
        {
            static const std::regex named(R"(import\s*\{([^}]*)\}\s*from\s*('[^']*'|"[^"]*")\s*;?)");
            static const std::regex alias(R"((\w+)\s+as\s+(\w+))");
            std::string out;
            auto begin = std::sregex_iterator(code.begin(), code.end(), named);
            std::size_t last = 0;
            for (auto it = begin; it != std::sregex_iterator(); ++it)
            {
                const auto& match = *it;
                out += code.substr(last, static_cast<std::size_t>(match.position()) - last);
                out += "const {" + std::regex_replace(match[1].str(), alias, "$1: $2") + "} = require(" + match[2].str()
                       + ");";
                last = static_cast<std::size_t>(match.position() + match.length());
            }
            code = out + code.substr(last);
        }
        replace(R"(import\s*\*\s*as\s+(\w+)\s+from\s*('[^']*'|"[^"]*")\s*;?)", "const $1 = require($2);");
        replace(R"(import\s+(\w+)\s+from\s*('[^']*'|"[^"]*")\s*;?)", "const $1 = require($2).default;");
        replace(R"(import\s*('[^']*'|"[^"]*")\s*;?)", "require($1);");
        replace(R"((^|[^\w.$])import\s*\()", "$1__import(");
        replace(R"(import\.meta)", "module.meta");
        replace(R"(export\s+default\s+)", "exports.default = ");

        std::vector<std::string> exported;
        {
            static const std::regex declaration(
                R"(export\s+(const|let|var|function\*?|async\s+function|class)\s+(\w+))");
            std::string out;
            std::size_t last = 0;
            for (auto it = std::sregex_iterator(code.begin(), code.end(), declaration); it != std::sregex_iterator();
                 ++it)
            {
                const auto& match = *it;
                out += code.substr(last, static_cast<std::size_t>(match.position()) - last);
                out += match[1].str() + " " + match[2].str();
                exported.push_back(match[2].str());
                last = static_cast<std::size_t>(match.position() + match.length());
            }
            code = out + code.substr(last);
        }
        std::string module = "(async function (exports, require, module) { 'use strict'; "
                             "const __import = (s) => Promise.resolve().then(() => require(s));";
        module += code;
        module += '\n';
        for (const auto& name : exported)
            module.append("exports.").append(name).append(" = ").append(name).append(";");
        module += "\n})";
        return module;
    }
} // namespace soundor::test
