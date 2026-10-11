#pragma once

// Private to soundor_runtime: modules compiled ahead of time.
//
// The build compiles JavaScript with hermesc, from the same Hermes build as
// the VM (SoundorCompileJs.cmake), and appends an epilogue naming that
// Hermes's revision: bytecode is only run by the VM it was made for. Bytecode
// only ever comes from the build itself: the VM does not defend against a
// hostile writer, so nothing read at run time from disk or elsewhere is
// treated as bytecode.

#include <soundor/Config.h>

#include <cstdint>
#include <span>
#include <string_view>

#ifndef SOUNDOR_HERMES_REVISION
    #error "SOUNDOR_HERMES_REVISION must name the Hermes revision (see SoundorHermes.cmake)"
#endif

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
{
    // What SoundorCompileJs.cmake appends to hermesc's output.
    inline constexpr std::string_view bytecodeEpilogue = "\nsoundor-hermes " SOUNDOR_HERMES_REVISION "\n";

    // Whether `compiled` ends with this build's epilogue.
    [[nodiscard]] inline bool isBytecodeForThisBuild(std::span<const std::uint8_t> compiled) noexcept
    {
        return compiled.size() > bytecodeEpilogue.size()
               && std::string_view(
                      reinterpret_cast<const char*>(compiled.data() + compiled.size() - bytecodeEpilogue.size()),
                      bytecodeEpilogue.size())
                      == bytecodeEpilogue;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js::detail
