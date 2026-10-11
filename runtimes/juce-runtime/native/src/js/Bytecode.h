#pragma once

// Private to soundor_runtime and soundor_compile_js: precompiled modules.
//
// soundor_compile_js compiles an ES module ahead of time into QuickJS
// bytecode, without its source text (functions keep their line numbers, not
// their text), behind a header naming the QuickJS revision it was made with.
// Bytecode only ever comes from the build itself: QuickJS reads it without
// defending against a hostile writer, so nothing read at run time from disk
// or elsewhere is treated as bytecode.

#include <soundor/Config.h>

#include <cstddef>
#include <cstdint>
#include <span>
#include <string>
#include <string_view>

#ifndef SOUNDOR_QUICKJS_REVISION
    #error "SOUNDOR_QUICKJS_REVISION must name the QuickJS revision (see SoundorQuickJS.cmake)"
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
{
    // "soundor-bytecode <revision>\n": bytecode is only readable by the
    // QuickJS that wrote it.
    inline std::string bytecodeHeader()
    {
        return std::string("soundor-bytecode ") + SOUNDOR_QUICKJS_REVISION + "\n";
    }

    // The bytecode after the header, or an empty span when the header is
    // missing or names another revision.
    inline std::span<const std::uint8_t> bytecodeBody(std::span<const std::uint8_t> compiled)
    {
        const std::string header = bytecodeHeader();
        if (compiled.size() <= header.size()
            || std::string_view(reinterpret_cast<const char*>(compiled.data()), header.size()) != header)
            return {};
        return compiled.subspan(header.size());
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
