# Skia (2D graphics) as the imported target `soundor_skia`.
#
# Skia is built from source once per machine and configuration (revision,
# build flags, platform, architectures) by SoundorSkiaBuild.cmake, into
# Soundor's cache directory, and reused by every build after that. The first
# configure takes a few minutes; it needs git, Python 3 and ninja.
#
#   SOUNDOR_SKIA_DIR    use this Skia install instead (include/, lib/, defines.txt)
#   SOUNDOR_CACHE (env) where to keep built Skias; default: the user cache
#                       directory (~/.cache/soundor, ~/Library/Caches/Soundor,
#                       %LOCALAPPDATA%\Soundor\cache)
#
# Skia's own symbols are hidden, and the library is linked PRIVATE: nothing of
# it is exported from a plugin.

include_guard(GLOBAL)

include(${CMAKE_CURRENT_LIST_DIR}/SoundorDependencies.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/SoundorPlatformLibraries.cmake)
include(${CMAKE_CURRENT_LIST_DIR}/SoundorWindowsCrt.cmake)

# Ganesh uses our assembled GLES interface, never a second ANGLE or native GL.
set(soundor_ganesh_default OFF)
if(WIN32 OR CMAKE_SYSTEM_NAME STREQUAL "Darwin")
  set(soundor_ganesh_default ON)
endif()
option(SOUNDOR_ENABLE_GANESH "Draw UI with Skia Ganesh on the compositor's ANGLE device" ${soundor_ganesh_default})
if((DEFINED SOUNDOR_ENABLE_GPU AND NOT SOUNDOR_ENABLE_GPU) OR IOS)
  set(SOUNDOR_ENABLE_GANESH OFF)
endif()

set(SOUNDOR_SKIA_DIR "" CACHE PATH "A Skia install made by SoundorSkiaBuild.cmake; empty: build one into the Soundor cache")

if(WIN32)
  set(soundor_skia_os win)
  set(soundor_skia_flavors ${SOUNDOR_WINDOWS_CRT_RELEASE} ${SOUNDOR_WINDOWS_CRT_DEBUG})
elseif(APPLE)
  set(soundor_skia_os mac)
  set(soundor_skia_flavors release)
else()
  set(soundor_skia_os linux)
  set(soundor_skia_flavors release)
endif()

# gn's names for the architectures to build (all of them for a macOS universal build).
set(soundor_skia_cpus "")
if(APPLE AND CMAKE_OSX_ARCHITECTURES)
  set(soundor_skia_archs ${CMAKE_OSX_ARCHITECTURES})
elseif(CMAKE_SYSTEM_PROCESSOR)
  set(soundor_skia_archs ${CMAKE_SYSTEM_PROCESSOR})
else()
  set(soundor_skia_archs ${CMAKE_HOST_SYSTEM_PROCESSOR})
endif()
foreach(arch IN LISTS soundor_skia_archs)
  string(TOLOWER "${arch}" arch)
  if(arch MATCHES "^(arm64|aarch64)$")
    list(APPEND soundor_skia_cpus arm64)
  elseif(arch MATCHES "^(x86_64|amd64|x64)$")
    list(APPEND soundor_skia_cpus x64)
  else()
    message(FATAL_ERROR "Soundor cannot build Skia for the architecture '${arch}'")
  endif()
endforeach()
list(REMOVE_DUPLICATES soundor_skia_cpus)

if(NOT SOUNDOR_SKIA_DIR)
  soundor_cache_root(cache_root)

  # On Linux and macOS Skia is built with the project's compiler when it is
  # Clang (Skia's supported compiler), otherwise with the clang on PATH.
  set(skia_cc "")
  set(skia_cxx "")
  if(NOT WIN32)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
      set(skia_cc "${CMAKE_C_COMPILER}")
      set(skia_cxx "${CMAKE_CXX_COMPILER}")
    else()
      find_program(SOUNDOR_SKIA_CLANG NAMES clang)
      find_program(SOUNDOR_SKIA_CLANGXX NAMES clang++)
      if(SOUNDOR_SKIA_CLANG AND SOUNDOR_SKIA_CLANGXX)
        set(skia_cc "${SOUNDOR_SKIA_CLANG}")
        set(skia_cxx "${SOUNDOR_SKIA_CLANGXX}")
      endif()
    endif()
  endif()

  # The cache key: anything that changes the build changes the directory.
  file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/SoundorSkiaBuild.cmake" script_hash)
  file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/skia/SoundorSkiaPrefix.h" prefix_hash)
  get_filename_component(skia_cxx_name "${skia_cxx}" NAME)
  # On Windows, with the project's MSVC: gn would take the newest installed.
  set(skia_win_vc "")
  set(skia_win_toolchain "")
  if(WIN32 AND CMAKE_CXX_COMPILER MATCHES "^(.*/VC)/Tools/MSVC/([^/]+)/bin/")
    set(skia_win_vc "${CMAKE_MATCH_1}")
    set(skia_win_toolchain "${CMAKE_MATCH_2}")
  endif()
  string(SHA256 key "${SOUNDOR_SKIA_REVISION};${SOUNDOR_SKIA_DEPENDENCIES};${script_hash};${prefix_hash};${skia_cxx_name};${skia_win_toolchain};${SOUNDOR_WINDOWS_CRT_RELEASE};${SOUNDOR_ENABLE_GANESH}")
  if(SOUNDOR_ENABLE_SANITIZERS)
    # ASan adds state to Skia's inline containers. A non-ASan archive has a
    # different SVG node layout and cannot be read through these headers.
    string(SHA256 key "${key};address")
  endif()
  string(SUBSTRING "${key}" 0 12 key)
  string(SUBSTRING "${SOUNDOR_SKIA_REVISION}" 0 10 short_revision)
  list(JOIN soundor_skia_cpus "-" cpu_names)
  set(SOUNDOR_SKIA_DIR "${cache_root}/skia-${short_revision}-${soundor_skia_os}-${cpu_names}-${key}")

  if(NOT EXISTS "${SOUNDOR_SKIA_DIR}/defines.txt")
    file(MAKE_DIRECTORY "${cache_root}")
    # Parallel configures wait for each other instead of building twice.
    file(LOCK "${SOUNDOR_SKIA_DIR}.lock" GUARD PROCESS TIMEOUT 7200)
    if(NOT EXISTS "${SOUNDOR_SKIA_DIR}/defines.txt")
      message(STATUS "Building Skia ${SOUNDOR_SKIA_VERSION} into ${SOUNDOR_SKIA_DIR} (once per machine)")
      execute_process(
        COMMAND ${CMAKE_COMMAND}
          "-DOUT=${SOUNDOR_SKIA_DIR}"
          "-DREVISION=${SOUNDOR_SKIA_REVISION}"
          "-DREPOSITORY=${SOUNDOR_SKIA_REPOSITORY}"
          "-DDEPENDENCIES=${SOUNDOR_SKIA_DEPENDENCIES}"
          "-DTARGET_OS=${soundor_skia_os}"
          "-DCPUS=${soundor_skia_cpus}"
          "-DFLAVORS=${soundor_skia_flavors}"
          "-DWIN_VC=${skia_win_vc}"
          "-DWIN_TOOLCHAIN=${skia_win_toolchain}"
          "-DCC=${skia_cc}"
          "-DCXX=${skia_cxx}"
          "-DADDRESS_SANITIZER=${SOUNDOR_ENABLE_SANITIZERS}"
          "-DGANESH=${SOUNDOR_ENABLE_GANESH}"
          -P "${CMAKE_CURRENT_LIST_DIR}/SoundorSkiaBuild.cmake"
        RESULT_VARIABLE status)
      if(NOT status EQUAL 0)
        message(FATAL_ERROR "Building Skia failed (see above). Soundor needs git, Python 3 and ninja to build it.")
      endif()
    endif()
    file(LOCK "${SOUNDOR_SKIA_DIR}.lock" RELEASE)
  endif()
endif()

if(NOT EXISTS "${SOUNDOR_SKIA_DIR}/defines.txt")
  message(FATAL_ERROR "SOUNDOR_SKIA_DIR (${SOUNDOR_SKIA_DIR}) is not a Skia install")
endif()

add_library(soundor_skia STATIC IMPORTED GLOBAL)
if(WIN32)
  set_target_properties(soundor_skia PROPERTIES
    IMPORTED_CONFIGURATIONS "RELEASE;DEBUG"
    IMPORTED_LOCATION "${SOUNDOR_SKIA_DIR}/lib/${SOUNDOR_WINDOWS_CRT_RELEASE}/skia.lib"
    IMPORTED_LOCATION_RELEASE "${SOUNDOR_SKIA_DIR}/lib/${SOUNDOR_WINDOWS_CRT_RELEASE}/skia.lib"
    IMPORTED_LOCATION_DEBUG "${SOUNDOR_SKIA_DIR}/lib/${SOUNDOR_WINDOWS_CRT_DEBUG}/skia.lib"
    MAP_IMPORTED_CONFIG_MINSIZEREL RELEASE
    MAP_IMPORTED_CONFIG_RELWITHDEBINFO RELEASE)
else()
  set_target_properties(soundor_skia PROPERTIES IMPORTED_LOCATION "${SOUNDOR_SKIA_DIR}/lib/release/libskia.a")
endif()

file(STRINGS "${SOUNDOR_SKIA_DIR}/defines.txt" soundor_skia_defines REGEX "^SK")
if(SOUNDOR_ENABLE_GANESH AND NOT "SK_GANESH" IN_LIST soundor_skia_defines)
  message(FATAL_ERROR "SOUNDOR_ENABLE_GANESH needs a Ganesh-enabled Skia; rebuild SOUNDOR_SKIA_DIR with -DGANESH=ON")
endif()
# Skia is always a release build; its headers must agree whatever we build.
target_compile_definitions(soundor_skia INTERFACE SK_RELEASE ${soundor_skia_defines})
if(SOUNDOR_ENABLE_GANESH)
  target_compile_definitions(soundor_skia INTERFACE SK_DISABLE_LEGACY_GL_MAKE_NATIVE_INTERFACE)
endif()
target_include_directories(soundor_skia SYSTEM INTERFACE "${SOUNDOR_SKIA_DIR}")
target_link_libraries(soundor_skia INTERFACE ${SOUNDOR_SKIA_SYSTEM_LIBRARIES})
