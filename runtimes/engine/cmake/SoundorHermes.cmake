# Hermes (the JavaScript engine) as the imported targets `soundor_hermes_full`
# (the VM with its compiler: evaluates source and bytecode) and
# `soundor_hermes_lean` (the VM alone: bytecode compiled at build time only),
# and `soundor_hermesc`, the bytecode compiler, a build tool.
#
# Hermes is built from source once per machine and configuration (revision,
# patches, compiler, platform, architectures) by SoundorHermesBuild.cmake,
# into Soundor's cache directory, and reused by every build after that. The
# first configure takes several minutes.
#
#   SOUNDOR_HERMES_DIR  use this Hermes install instead (include/, lib/, bin/)
#   SOUNDOR_CACHE (env) where to keep built Hermes; default: the user cache
#                       directory (~/.cache/soundor, ~/Library/Caches/Soundor,
#                       %LOCALAPPDATA%\Soundor\cache)
#
# It is the interpreter only: no JIT, no Static Hermes, no debugger. Its
# symbols are hidden, its libraries static and linked PRIVATE: nothing of it
# is exported from a plugin. Like Skia, it is always an optimized build.

include_guard(GLOBAL)

include(${CMAKE_CURRENT_LIST_DIR}/SoundorDependencies.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/SoundorPlatformLibraries.cmake)

set(SOUNDOR_HERMES_DIR "" CACHE PATH "A Hermes install made by SoundorHermesBuild.cmake; empty: build one into the Soundor cache")
# Hermes compiled for link-time optimization (ThinLTO with Clang): its code is
# then optimized and pruned with the plugin's when the plugin links with LTO
# (JUCE's juce_recommended_lto_flags, in Release builds). Off: see
# engine/README.md for what it measured.
option(SOUNDOR_HERMES_LTO "Build Hermes for link-time optimization" OFF)

if(WIN32)
  set(soundor_hermes_os win)
  # One build per C runtime, like Skia: Debug builds link the debug one.
  set(soundor_hermes_flavors md mdd)
elseif(APPLE)
  set(soundor_hermes_os mac)
  set(soundor_hermes_flavors release)
else()
  set(soundor_hermes_os linux)
  set(soundor_hermes_flavors release)
endif()

if(APPLE AND CMAKE_OSX_ARCHITECTURES)
  set(soundor_hermes_archs ${CMAKE_OSX_ARCHITECTURES})
elseif(CMAKE_SYSTEM_PROCESSOR)
  set(soundor_hermes_archs ${CMAKE_SYSTEM_PROCESSOR})
else()
  set(soundor_hermes_archs ${CMAKE_HOST_SYSTEM_PROCESSOR})
endif()
string(TOLOWER "${soundor_hermes_archs}" soundor_hermes_archs)
list(JOIN soundor_hermes_archs "-" soundor_hermes_arch_names)

if(NOT SOUNDOR_HERMES_DIR)
  if(CMAKE_CROSSCOMPILING)
    # hermesc has to run on the build machine while the VM is built for the
    # target: two Hermes builds, which this file does not make yet.
    message(FATAL_ERROR "Cross-compiling needs SOUNDOR_HERMES_DIR: a Hermes for the target, made by "
                        "SoundorHermesBuild.cmake with a host hermesc")
  endif()
  soundor_cache_root(cache_root)

  # Like Skia: built with the project's compiler when it is Clang, otherwise
  # with the clang on PATH; MSVC on Windows.
  set(hermes_cc "")
  set(hermes_cxx "")
  if(NOT WIN32)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
      set(hermes_cc "${CMAKE_C_COMPILER}")
      set(hermes_cxx "${CMAKE_CXX_COMPILER}")
    else()
      find_program(SOUNDOR_HERMES_CLANG NAMES clang)
      find_program(SOUNDOR_HERMES_CLANGXX NAMES clang++)
      if(SOUNDOR_HERMES_CLANG AND SOUNDOR_HERMES_CLANGXX)
        set(hermes_cc "${SOUNDOR_HERMES_CLANG}")
        set(hermes_cxx "${SOUNDOR_HERMES_CLANGXX}")
      endif()
    endif()
  endif()
  find_program(SOUNDOR_HERMES_NINJA NAMES ninja)
  set(hermes_generator "")
  if(SOUNDOR_HERMES_NINJA AND NOT WIN32)
    set(hermes_generator Ninja)
  endif()
  set(hermes_unicode_revision "")
  set(hermes_unicode_sha256 "")
  if(soundor_hermes_os STREQUAL "linux")
    set(hermes_unicode_revision "${SOUNDOR_QUICKJS_REVISION}")
    set(hermes_unicode_sha256 "${SOUNDOR_QUICKJS_SHA256}")
  endif()

  # The cache key: anything that changes the build changes the directory.
  set(hermes_inputs "")
  foreach(file SoundorHermesBuild.cmake SoundorHermesPatch.cmake hermes/CMakeLists.txt hermes/SoundorHermes.h
               hermes/SoundorHermes.inc hermes/PlatformUnicodeLite.cpp hermes/SoundorUnicode.c)
    file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/${file}" hash)
    list(APPEND hermes_inputs "${hash}")
  endforeach()
  get_filename_component(hermes_cxx_name "${hermes_cxx}" NAME)
  string(SHA256 key "${SOUNDOR_HERMES_REVISION};${hermes_unicode_revision};${hermes_inputs};${hermes_cxx_name};${CMAKE_OSX_DEPLOYMENT_TARGET};${SOUNDOR_HERMES_LTO}")
  string(SUBSTRING "${key}" 0 12 key)
  string(SUBSTRING "${SOUNDOR_HERMES_REVISION}" 0 10 short_revision)
  set(hermes_lto_name "")
  if(SOUNDOR_HERMES_LTO)
    set(hermes_lto_name "-lto")
  endif()
  set(SOUNDOR_HERMES_DIR "${cache_root}/hermes-${short_revision}-${soundor_hermes_os}-${soundor_hermes_arch_names}${hermes_lto_name}-${key}")

  foreach(flavor IN LISTS soundor_hermes_flavors)
    set(out "${SOUNDOR_HERMES_DIR}/${flavor}")
    if(EXISTS "${out}/hermes.txt")
      continue()
    endif()
    file(MAKE_DIRECTORY "${cache_root}")
    # Parallel configures wait for each other instead of building twice.
    file(LOCK "${out}.lock" GUARD PROCESS TIMEOUT 7200)
    if(NOT EXISTS "${out}/hermes.txt")
      set(runtime "")
      if(flavor STREQUAL "md")
        set(runtime MultiThreadedDLL)
      elseif(flavor STREQUAL "mdd")
        set(runtime MultiThreadedDebugDLL)
      endif()
      message(STATUS "Building Hermes ${SOUNDOR_HERMES_VERSION} (${flavor}) into ${out} (once per machine)")
      execute_process(
        COMMAND ${CMAKE_COMMAND}
          "-DOUT=${out}"
          "-DREVISION=${SOUNDOR_HERMES_REVISION}"
          "-DSHA256=${SOUNDOR_HERMES_SHA256}"
          "-DFILES=${CMAKE_CURRENT_LIST_DIR}/hermes"
          "-DUNICODE_REVISION=${hermes_unicode_revision}"
          "-DUNICODE_SHA256=${hermes_unicode_sha256}"
          "-DCC=${hermes_cc}"
          "-DCXX=${hermes_cxx}"
          "-DGENERATOR=${hermes_generator}"
          "-DOSX_ARCHITECTURES=${CMAKE_OSX_ARCHITECTURES}"
          "-DOSX_DEPLOYMENT_TARGET=${CMAKE_OSX_DEPLOYMENT_TARGET}"
          "-DMSVC_RUNTIME=${runtime}"
          "-DLTO=${SOUNDOR_HERMES_LTO}"
          -P "${CMAKE_CURRENT_LIST_DIR}/SoundorHermesBuild.cmake"
        RESULT_VARIABLE status)
      if(NOT status EQUAL 0)
        message(FATAL_ERROR "Building Hermes failed (see above).")
      endif()
    endif()
    file(LOCK "${out}.lock" RELEASE)
  endforeach()
endif()

list(GET soundor_hermes_flavors 0 soundor_hermes_first)
set(soundor_hermes_main "${SOUNDOR_HERMES_DIR}/${soundor_hermes_first}")
if(NOT EXISTS "${soundor_hermes_main}/hermes.txt")
  message(FATAL_ERROR "SOUNDOR_HERMES_DIR (${SOUNDOR_HERMES_DIR}) is not a Hermes install")
endif()

# Bytecode names the revision it was compiled for (SoundorEmbed.cmake, which a
# plugin project calls from its own directory scope).
set_property(GLOBAL PROPERTY SOUNDOR_HERMES_REVISION "${SOUNDOR_HERMES_REVISION}")

# What the runtime checks bytecode against (src/js/Bytecode.h).
file(STRINGS "${soundor_hermes_main}/hermes.txt" soundor_hermes_bytecode REGEX "^bytecode ")
string(REPLACE "bytecode " "" SOUNDOR_HERMES_BYTECODE_VERSION "${soundor_hermes_bytecode}")

if(CMAKE_HOST_WIN32)
  set(soundor_hermesc_path "${soundor_hermes_main}/bin/hermesc.exe")
else()
  set(soundor_hermesc_path "${soundor_hermes_main}/bin/hermesc")
endif()
if(NOT TARGET soundor_hermesc)
  add_executable(soundor_hermesc IMPORTED GLOBAL)
  set_target_properties(soundor_hermesc PROPERTIES IMPORTED_LOCATION "${soundor_hermesc_path}")
endif()

file(STRINGS "${soundor_hermes_main}/system.txt" soundor_hermes_system)

foreach(variant full lean)
  set(target soundor_hermes_${variant})
  if(TARGET ${target})
    continue()
  endif()
  add_library(${target} INTERFACE IMPORTED GLOBAL)
  set(libraries "")
  foreach(flavor IN LISTS soundor_hermes_flavors)
    file(STRINGS "${SOUNDOR_HERMES_DIR}/${flavor}/lib/${variant}/libraries.txt" names)
    set(paths "")
    foreach(name IN LISTS names)
      list(APPEND paths "${SOUNDOR_HERMES_DIR}/${flavor}/lib/${variant}/${name}")
    endforeach()
    if(flavor STREQUAL "md" OR flavor STREQUAL "mdd")
      if(flavor STREQUAL "md")
        set(condition "$<NOT:$<CONFIG:Debug>>")
      else()
        set(condition "$<CONFIG:Debug>")
      endif()
      foreach(path IN LISTS paths)
        list(APPEND libraries "$<${condition}:${path}>")
      endforeach()
    elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND CMAKE_VERSION VERSION_GREATER_EQUAL 3.24)
      # Single-pass linkers (GNU ld) see the archives as one group.
      list(JOIN paths "," joined)
      list(APPEND libraries "$<LINK_GROUP:RESCAN,${joined}>")
    else()
      list(APPEND libraries ${paths})
    endif()
  endforeach()
  set_target_properties(${target} PROPERTIES
    INTERFACE_INCLUDE_DIRECTORIES "${soundor_hermes_main}/include"
    INTERFACE_SYSTEM_INCLUDE_DIRECTORIES "${soundor_hermes_main}/include"
    # As Hermes was built (cmake/hermes/CMakeLists.txt): nothing exported.
    INTERFACE_COMPILE_DEFINITIONS "JSI_EXPORT=;HERMES_EXPORT=")
  target_link_libraries(${target} INTERFACE ${libraries} ${soundor_hermes_system} ${SOUNDOR_HERMES_SYSTEM_LIBRARIES})
endforeach()
