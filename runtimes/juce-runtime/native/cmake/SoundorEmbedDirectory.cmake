# cmake -DDIRECTORY=<dir> -DOUTPUT=<cpp> -DFUNCTION=<name> -P SoundorEmbedDirectory.cmake

file(GLOB_RECURSE files LIST_DIRECTORIES false RELATIVE "${DIRECTORY}" "${DIRECTORY}/*")
list(SORT files)

set(arrays "")
set(entries "")
set(index 0)
foreach(file IN LISTS files)
  file(READ "${DIRECTORY}/${file}" hex HEX)
  string(LENGTH "${hex}" length)
  math(EXPR size "${length} / 2")
  if(size EQUAL 0)
    set(bytes "0")
  else()
    string(REGEX REPLACE "([0-9a-f][0-9a-f])" "0x\\1," bytes "${hex}")
  endif()
  string(APPEND arrays "        alignas(16) const std::uint8_t file${index}[] = { ${bytes} };\n")
  string(REPLACE "\\" "/" path "${file}")
  string(APPEND entries "            { \"${path}\", std::span<const std::uint8_t>(file${index}, ${size}) },\n")
  math(EXPR index "${index} + 1")
endforeach()

if(index EQUAL 0)
  set(table "        const platform::EmbeddedFile* const files = nullptr;\n")
  set(span "std::span<const platform::EmbeddedFile>()")
else()
  set(table "        const platform::EmbeddedFile files[] = {\n${entries}        };\n")
  set(span "std::span<const platform::EmbeddedFile>(files)")
endif()

file(WRITE "${OUTPUT}.tmp" "// Generated from ${DIRECTORY}. Do not edit.
#include <soundor/platform/Resources.h>

#include <cstdint>
#include <span>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    namespace
    {
${arrays}${table}    } // namespace

    std::span<const platform::EmbeddedFile> ${FUNCTION}();
    std::span<const platform::EmbeddedFile> ${FUNCTION}() { return ${span}; }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
")
file(COPY_FILE "${OUTPUT}.tmp" "${OUTPUT}" ONLY_IF_DIFFERENT)
file(REMOVE "${OUTPUT}.tmp")
