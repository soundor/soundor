# cmake -DFILE=<YGMacros.h> -P SoundorYogaPatch.cmake
#
# Yoga marks its C API visibility("default") outside MSVC, which would export
# every YG* function from a plugin binary. Soundor links Yoga privately into
# each plugin, so the API stays hidden like the rest of the runtime.

file(READ "${FILE}" content)
set(exported "#define YG_EXPORT __attribute__((visibility(\"default\")))")
string(FIND "${content}" "${exported}" found)
if(found EQUAL -1)
  string(FIND "${content}" "#define YG_EXPORT /* hidden by Soundor */" patched)
  if(patched EQUAL -1)
    message(FATAL_ERROR "${FILE}: YG_EXPORT definition not found; update SoundorYogaPatch.cmake")
  endif()
  return()
endif()
string(REPLACE "${exported}" "#define YG_EXPORT /* hidden by Soundor */" content "${content}")
file(WRITE "${FILE}" "${content}")
