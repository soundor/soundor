# cmake -DSOURCE=<Hermes source> -DFILES=<cmake/hermes> -DUNICODE=<ON|OFF> -P SoundorHermesPatch.cmake
#
# Soundor's changes to Hermes, applied by SoundorHermesBuild.cmake to the
# extracted archive. Each fails the build if Hermes's code no longer matches,
# so a Hermes update has to look at it again.
#
# - API/hermes/hermes.cpp gets SoundorHermes.inc appended (SoundorHermes.h:
#   typed-array views, the job queue and heap counters for Soundor's
#   bindings), and HermesRuntimeImpl befriends it.
# - include/hermes/VM/Runtime.h, lib/VM/Runtime.cpp: whether promise jobs are
#   queued (the queue is private) and how many have run.
# - With UNICODE (Linux), lib/Platform/Unicode/PlatformUnicodeLite.cpp is
#   replaced by Soundor's (cmake/hermes/PlatformUnicodeLite.cpp: QuickJS-NG's
#   Unicode tables instead of the system's ICU).

foreach(required SOURCE FILES UNICODE)
  if(NOT DEFINED ${required})
    message(FATAL_ERROR "SoundorHermesPatch.cmake: ${required} is required")
  endif()
endforeach()

# Replaces `upstream` with `patched` in `file`, once; fails when neither is
# there.
function(soundor_hermes_patch file upstream patched)
  file(READ "${SOURCE}/${file}" content)
  string(FIND "${content}" "${patched}" already)
  if(NOT already EQUAL -1)
    return()
  endif()
  string(FIND "${content}" "${upstream}" found)
  if(found EQUAL -1)
    message(FATAL_ERROR "${file} changed; update SoundorHermesPatch.cmake")
  endif()
  string(REPLACE "${upstream}" "${patched}" content "${content}")
  file(WRITE "${SOURCE}/${file}" "${content}")
endfunction()

file(COPY "${FILES}/SoundorHermes.h" "${FILES}/SoundorHermes.inc" DESTINATION "${SOURCE}/API/hermes")

soundor_hermes_patch(API/hermes/hermes.cpp
  "#include \"hermes.h\"\n"
  "#include \"hermes.h\"\n\n// Soundor: SoundorHermes.inc, appended below, reaches into HermesRuntimeImpl.\nstruct SoundorHermesAccess;\n")
soundor_hermes_patch(API/hermes/hermes.cpp
  "  friend struct ::HermesTestHelper;\n"
  "  friend struct ::HermesTestHelper;\n  friend struct ::SoundorHermesAccess;\n")
file(READ "${SOURCE}/API/hermes/hermes.cpp" content)
string(FIND "${content}" "#include \"SoundorHermes.inc\"" appended)
if(appended EQUAL -1)
  file(APPEND "${SOURCE}/API/hermes/hermes.cpp" "\n// Soundor (SoundorHermesPatch.cmake).\n#include \"SoundorHermes.inc\"\n")
endif()

soundor_hermes_patch(include/hermes/VM/Runtime.h
  "  ExecutionStatus drainJobs();\n"
  "  ExecutionStatus drainJobs();\n\n  /// Soundor: whether jobs are queued, and how many drainJobs() ran\n  /// (SoundorHermesPatch.cmake).\n  bool soundorHasPendingJobs() const {\n    return !jobQueue_.empty();\n  }\n  uint64_t soundorJobsRun() const {\n    return soundorJobsRun_;\n  }\n  uint64_t soundorJobsRun_{0};\n")
soundor_hermes_patch(lib/VM/Runtime.cpp
  "    job = jobQueue_.front();\n    jobQueue_.pop_front();\n"
  "    job = jobQueue_.front();\n    jobQueue_.pop_front();\n    ++soundorJobsRun_;\n")

if(UNICODE)
  file(READ "${SOURCE}/lib/Platform/Unicode/PlatformUnicodeLite.cpp" lite)
  string(FIND "${lite}" "void convertToCase(" known)
  if(known EQUAL -1)
    message(FATAL_ERROR "lib/Platform/Unicode/PlatformUnicodeLite.cpp changed; update SoundorHermesPatch.cmake")
  endif()
  file(COPY_FILE "${FILES}/PlatformUnicodeLite.cpp" "${SOURCE}/lib/Platform/Unicode/PlatformUnicodeLite.cpp")
  file(COPY "${FILES}/SoundorUnicode.c" DESTINATION "${SOURCE}/lib/Platform/Unicode")
endif()
