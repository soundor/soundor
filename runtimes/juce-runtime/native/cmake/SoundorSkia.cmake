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

set(SOUNDOR_SKIA_DIR "" CACHE PATH "A Skia install made by SoundorSkiaBuild.cmake; empty: build one into the Soundor cache")

if(WIN32)
  set(soundor_skia_os win)
  set(soundor_skia_flavors md mdd)
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
  get_filename_component(skia_cxx_name "${skia_cxx}" NAME)
  string(SHA256 key "${SOUNDOR_SKIA_REVISION};${SOUNDOR_SKIA_DEPENDENCIES};${script_hash};${skia_cxx_name}")
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
          "-DCC=${skia_cc}"
          "-DCXX=${skia_cxx}"
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
    IMPORTED_LOCATION "${SOUNDOR_SKIA_DIR}/lib/md/skia.lib"
    IMPORTED_LOCATION_RELEASE "${SOUNDOR_SKIA_DIR}/lib/md/skia.lib"
    IMPORTED_LOCATION_DEBUG "${SOUNDOR_SKIA_DIR}/lib/mdd/skia.lib"
    MAP_IMPORTED_CONFIG_MINSIZEREL RELEASE
    MAP_IMPORTED_CONFIG_RELWITHDEBINFO RELEASE)
else()
  set_target_properties(soundor_skia PROPERTIES IMPORTED_LOCATION "${SOUNDOR_SKIA_DIR}/lib/release/libskia.a")
endif()

file(STRINGS "${SOUNDOR_SKIA_DIR}/defines.txt" soundor_skia_defines REGEX "^SK")
# Skia is always a release build; its headers must agree whatever we build.
target_compile_definitions(soundor_skia INTERFACE SK_RELEASE ${soundor_skia_defines})
target_include_directories(soundor_skia SYSTEM INTERFACE "${SOUNDOR_SKIA_DIR}")

if(APPLE)
  target_link_libraries(soundor_skia INTERFACE
    "-framework CoreFoundation" "-framework CoreGraphics" "-framework CoreText" "-framework ImageIO")
elseif(WIN32)
  target_link_libraries(soundor_skia INTERFACE dwrite usp10 fontsub user32 ole32 oleaut32)
else()
  find_package(PkgConfig REQUIRED)
  pkg_check_modules(SOUNDOR_FONTS REQUIRED IMPORTED_TARGET GLOBAL fontconfig freetype2)
  target_link_libraries(soundor_skia INTERFACE PkgConfig::SOUNDOR_FONTS ${CMAKE_DL_LIBS})
endif()
