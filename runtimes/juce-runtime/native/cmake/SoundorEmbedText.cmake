# cmake -DINPUT=<file> -DOUTPUT=<cpp> -DSYMBOL=<name> -P SoundorEmbedText.cmake
#
# Writes the file as adjacent raw string literals of at most ~4 KB each, cut
# after an ASCII character (a line end where there is one): MSVC limits a
# single literal's length. Past 60 KB, which is about what compilers must
# accept after concatenation, the literals are joined at load instead.

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
  # Cut after an ASCII character, which is never inside a UTF-8 sequence:
  # the last newline, or on a longer line the last space or semicolon.
  if(size EQUAL 4000)
    set(cut -1)
    foreach(separator "\n" " " ";")
      string(FIND "${chunk}" "${separator}" cut REVERSE)
      if(cut GREATER 0)
        break()
      endif()
    endforeach()
    if(NOT cut GREATER 0)
      message(FATAL_ERROR "${INPUT}: 4000 bytes without a newline, space or semicolon at ${offset}")
    endif()
    math(EXPR size "${cut} + 1")
    string(SUBSTRING "${content}" ${offset} ${size} chunk)
  endif()
  string(APPEND chunks "    R\"SOUNDOR_EMBED(${chunk})SOUNDOR_EMBED\"\n")
  math(EXPR offset "${offset} + ${size}")
endwhile()

if(length LESS 60000)
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
else()
  # Longer than compilers must accept as one (concatenated) literal: the
  # chunks stay apart and are joined once, at load.
  string(REPLACE ")SOUNDOR_EMBED\"\n" ")SOUNDOR_EMBED\",\n" parts "${chunks}")
  file(WRITE "${OUTPUT}.tmp" "// Generated from ${INPUT}. Do not edit.
#include <soundor/Config.h>

#include <string>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    namespace
    {
        const std::string& ${SYMBOL}Text()
        {
            static const std::string text = []
            {
                constexpr std::string_view parts[] = {
${parts}                };
                std::string joined;
                for (const std::string_view part : parts)
                    joined += part;
                return joined;
            }();
            return text;
        }
    } // namespace

    extern const std::string_view ${SYMBOL};
    const std::string_view ${SYMBOL} = ${SYMBOL}Text();
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
")
endif()
file(COPY_FILE "${OUTPUT}.tmp" "${OUTPUT}" ONLY_IF_DIFFERENT)
file(REMOVE "${OUTPUT}.tmp")
