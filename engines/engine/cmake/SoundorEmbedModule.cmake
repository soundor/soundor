# cmake -DSYMBOL=<name> -DOUTPUT=<cpp> (-DBYTECODE=<file> | -DSOURCE=<symbol>) -P SoundorEmbedModule.cmake
#
# Defines embedded::<SYMBOL>, a ModuleCode (src/modules/Embedded.h): the
# bytecode in BYTECODE, or a pointer to the source embedded as <SOURCE> by
# soundor_embed_text().

if(DEFINED BYTECODE AND NOT BYTECODE STREQUAL "")
  file(READ "${BYTECODE}" hex HEX)
  string(LENGTH "${hex}" length)
  math(EXPR size "${length} / 2")
  string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," bytes "${hex}")
  set(definition "    namespace
    {
        alignas(16) const std::uint8_t bytecode[] = { ${bytes} };
    } // namespace

    extern const ModuleCode ${SYMBOL};
    const ModuleCode ${SYMBOL} { nullptr, std::span<const std::uint8_t>(bytecode, ${size}) };
")
else()
  set(definition "    extern const std::string_view ${SOURCE};
    extern const ModuleCode ${SYMBOL};
    const ModuleCode ${SYMBOL} { &${SOURCE}, {} };
")
endif()

file(WRITE "${OUTPUT}.tmp" "// Generated. Do not edit.
#include \"modules/Embedded.h\"

#include <cstdint>
#include <span>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
${definition}} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
")
file(COPY_FILE "${OUTPUT}.tmp" "${OUTPUT}" ONLY_IF_DIFFERENT)
file(REMOVE "${OUTPUT}.tmp")
