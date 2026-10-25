cmake_minimum_required(VERSION 3.22)
# Fails when an object of ARCHIVE whose name matches MEMBERS defines a C symbol
# that does not start with PREFIX: Skia's copies of libjpeg-turbo, libpng and
# libwebp are renamed (cmake/skia/SoundorSkiaPrefix.h) so a plugin can contain
# another copy of each, as JUCE's. A name the header misses, which a Skia
# update can bring, is reported; cmake/skia/prefix.py adds it.
#
#   cmake -DARCHIVE=<a> -DMEMBERS=<regex> -DPREFIX=<p> -DNM=<nm> -DAPPLE=<bool> -P CheckPrefixed.cmake
execute_process(
  COMMAND ${NM} -g --defined-only ${ARCHIVE}
  OUTPUT_VARIABLE output
  ERROR_QUIET
  RESULT_VARIABLE status)
if(NOT status EQUAL 0)
  message(FATAL_ERROR "${NM} failed on ${ARCHIVE}")
endif()

string(REPLACE ";" "\\;" output "${output}")
string(REPLACE "\n" ";" lines "${output}")
set(member "")
set(unprefixed "")
foreach(line IN LISTS lines)
  # "member.o:" (ELF) or "archive(member.o):" (Mach-O) starts a member.
  if(line MATCHES "^(.*\\()?([^()]+)\\)?:$")
    get_filename_component(member "${CMAKE_MATCH_2}" NAME)
    continue()
  endif()
  if(NOT member MATCHES "${MEMBERS}")
    continue()
  endif()
  # Strong definitions only: weak and common ones are merged, not clashes.
  if(NOT line MATCHES "^[0-9a-fA-F]+ [TDBRS] (.+)$")
    continue()
  endif()
  set(symbol "${CMAKE_MATCH_1}")
  # Mach-O names carry one extra leading underscore.
  if(APPLE AND symbol MATCHES "^_(.*)$")
    set(symbol "${CMAKE_MATCH_1}")
  endif()
  # C names only: C++ ones (_Z...) are the linker's to merge.
  if(NOT symbol MATCHES "^[A-Za-z][A-Za-z0-9_]*$" OR symbol MATCHES "^${PREFIX}")
    continue()
  endif()
  list(APPEND unprefixed "${symbol} (${member})")
endforeach()

if(unprefixed)
  list(REMOVE_DUPLICATES unprefixed)
  list(LENGTH unprefixed count)
  list(SORT unprefixed)
  list(JOIN unprefixed "\n  " report)
  message(FATAL_ERROR "${count} symbols of ${MEMBERS} in ${ARCHIVE} lack the ${PREFIX} prefix "
                      "(regenerate cmake/skia/SoundorSkiaPrefix.h with cmake/skia/prefix.py):\n  ${report}")
endif()
message(STATUS "Every symbol of ${MEMBERS} in ${ARCHIVE} starts with ${PREFIX}")
