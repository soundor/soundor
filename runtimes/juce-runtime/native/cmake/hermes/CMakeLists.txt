# The project SoundorHermesBuild.cmake builds Hermes with: Hermes's own
# CMake, configured the way Soundor embeds it, plus a list of the static
# libraries each VM consists of, in link order.
#
#   -DHERMES_SOURCE=<patched Hermes source>
#   -DSOUNDOR_UNICODE_SOURCE=<QuickJS-NG source> (Linux: Unicode tables)
#
# Writes soundor-full.txt and soundor-lean.txt (one library per line, each
# before the ones it needs) and soundor-system.txt (what they need from the
# system) into the build directory.

cmake_minimum_required(VERSION 3.22)
project(SoundorHermes LANGUAGES C CXX)

if(NOT HERMES_SOURCE)
  message(FATAL_ERROR "HERMES_SOURCE is required")
endif()

set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_C_VISIBILITY_PRESET hidden)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
# Hermes's API marks itself default-visible (or dllexport) for a shared
# libhermes. Linked statically into a plugin, nothing of it may be exported:
# Soundor's headers see the same empty definitions (SoundorHermes.cmake).
add_compile_definitions(JSI_EXPORT= HERMES_EXPORT=)
# A section per function and object, so that a plugin's link drops what it
# never calls (the generated setup.cmake links Release plugins with
# --gc-sections / -dead_strip). MSVC's Release builds do this already (/Gy).
if(NOT MSVC)
  add_compile_options(-ffunction-sections -fdata-sections)
endif()

# Only the VM, its JSI API and hermesc: no inspector/debugger, tests or other
# tools.
set(HERMES_ENABLE_DEBUGGER OFF CACHE BOOL "" FORCE)
set(HERMES_MEMORY_INSTRUMENTATION OFF CACHE BOOL "" FORCE)
set(HERMES_ENABLE_TEST_SUITE OFF CACHE BOOL "" FORCE)
set(HERMES_ENABLE_INTL OFF CACHE BOOL "" FORCE)
set(HERMES_BUILD_APPLE_FRAMEWORK OFF CACHE BOOL "" FORCE)
set(HERMES_BUILD_SHARED_JSI OFF CACHE BOOL "" FORCE)
set(HERMES_ENABLE_WERROR OFF CACHE BOOL "" FORCE)
set(HERMES_THREAD_SAFETY_ANALYSIS OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
# Running out of JavaScript heap throws (JSOutOfMemoryError) instead of
# aborting: a plugin must not take its host down. The VM is then compiled
# with exceptions and RTTI.
set(HERMESVM_EXCEPTION_ON_OOM ON CACHE BOOL "" FORCE)
if(SOUNDOR_UNICODE_SOURCE)
  # Hermes's "lite" Unicode, which SoundorHermesPatch.cmake replaced with
  # Soundor's; ICU is then neither needed nor linked.
  set(HERMES_UNICODE_LITE ON CACHE BOOL "" FORCE)
  set(ICU_FOUND 1)
endif()

add_subdirectory("${HERMES_SOURCE}" hermes)

if(SOUNDOR_UNICODE_SOURCE)
  # QuickJS-NG's Unicode tables, with QuickJS's own flags (it is developed
  # with unsigned chars), in Hermes's Unicode library.
  add_library(soundor_unicode OBJECT
    "${HERMES_SOURCE}/lib/Platform/Unicode/SoundorUnicode.c"
    "${SOUNDOR_UNICODE_SOURCE}/libunicode.c")
  target_include_directories(soundor_unicode PRIVATE "${SOUNDOR_UNICODE_SOURCE}")
  target_compile_definitions(soundor_unicode PRIVATE _GNU_SOURCE)
  target_compile_options(soundor_unicode PRIVATE -funsigned-char -w)
  target_sources(hermesPlatformUnicode PRIVATE $<TARGET_OBJECTS:soundor_unicode>)
endif()

# The static libraries `target` consists of, depth first: each library is
# recorded after everything it needs, so the reversed list links in one pass.
function(soundor_collect target variant)
  get_property(seen GLOBAL PROPERTY soundor_seen_${variant})
  if(target IN_LIST seen)
    return()
  endif()
  set_property(GLOBAL APPEND PROPERTY soundor_seen_${variant} "${target}")
  get_target_property(type ${target} TYPE)
  set(dependencies "")
  foreach(property LINK_LIBRARIES INTERFACE_LINK_LIBRARIES)
    if(NOT type STREQUAL "INTERFACE_LIBRARY" OR property STREQUAL "INTERFACE_LINK_LIBRARIES")
      get_target_property(items ${target} ${property})
      if(items)
        list(APPEND dependencies ${items})
      endif()
    endif()
  endforeach()
  foreach(item IN LISTS dependencies)
    if(item MATCHES "^\\$<LINK_ONLY:(.+)>$")
      set(item "${CMAKE_MATCH_1}")
    endif()
    if(item MATCHES "^\\$<")
      message(FATAL_ERROR "Hermes target ${target} links '${item}', which SoundorHermes cannot follow")
    endif()
    if(TARGET ${item})
      get_target_property(imported ${item} IMPORTED)
      if(imported)
        set_property(GLOBAL APPEND PROPERTY soundor_system "${item}")
      else()
        soundor_collect(${item} ${variant})
      endif()
    elseif(NOT item STREQUAL "")
      set_property(GLOBAL APPEND PROPERTY soundor_system "${item}")
    endif()
  endforeach()
  if(type STREQUAL "STATIC_LIBRARY")
    set_property(GLOBAL APPEND PROPERTY soundor_order_${variant} "${target}")
  endif()
endfunction()

foreach(variant full lean)
  if(variant STREQUAL "full")
    soundor_collect(hermesvm ${variant})
  else()
    soundor_collect(hermesvmlean ${variant})
  endif()
  get_property(order GLOBAL PROPERTY soundor_order_${variant})
  list(REVERSE order)
  set(content "")
  foreach(library IN LISTS order)
    string(APPEND content "$<TARGET_FILE:${library}>\n")
  endforeach()
  file(GENERATE OUTPUT "${CMAKE_BINARY_DIR}/soundor-${variant}.txt" CONTENT "${content}")
endforeach()

get_property(system GLOBAL PROPERTY soundor_system)
list(REMOVE_DUPLICATES system)
list(JOIN system "\n" system)
file(GENERATE OUTPUT "${CMAKE_BINARY_DIR}/soundor-system.txt" CONTENT "${system}\n")
file(GENERATE OUTPUT "${CMAKE_BINARY_DIR}/soundor-hermesc.txt" CONTENT "$<TARGET_FILE:hermesc>\n")
