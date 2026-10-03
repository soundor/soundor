# cmake -DINPUT=<file> -DOUTPUT=<cpp> -DSYMBOL=<name> -P SoundorEmbedText.cmake
#
# Writes the file as adjacent raw string literals of at most ~4 KB each, cut at
# line ends: MSVC limits a single literal's length, not the concatenation's.

file(READ "${INPUT}" content)
string(FIND "${content}" ")SOUNDOR_EMBED\"" collision)
if(NOT collision EQUAL -1)
  message(FATAL_ERROR "${INPUT} contains the raw-string delimiter )SOUNDOR_EMBED\"")
endif()

string(LENGTH "${content}" length)
set(chunks "")
set(offset 0)
while(offset LESS length)
  math(EXPR remaining "${length} - ${offset}")
  set(size 4000)
  if(remaining LESS size)
    set(size ${remaining})
  endif()
  string(SUBSTRING "${content}" ${offset} ${size} chunk)
  # Cut after the last newline so a chunk never splits a UTF-8 sequence.
  if(size EQUAL 4000)
    string(FIND "${chunk}" "\n" newline REVERSE)
    if(newline GREATER 0)
      math(EXPR size "${newline} + 1")
      string(SUBSTRING "${content}" ${offset} ${size} chunk)
    endif()
  endif()
  string(APPEND chunks "    R\"SOUNDOR_EMBED(${chunk})SOUNDOR_EMBED\"\n")
  math(EXPR offset "${offset} + ${size}")
endwhile()

file(WRITE "${OUTPUT}.tmp" "// Generated from ${INPUT}. Do not edit.
#include <soundor/Config.h>

#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    extern const std::string_view ${SYMBOL};
    const std::string_view ${SYMBOL} =
${chunks}    ;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
")
file(COPY_FILE "${OUTPUT}.tmp" "${OUTPUT}" ONLY_IF_DIFFERENT)
file(REMOVE "${OUTPUT}.tmp")
