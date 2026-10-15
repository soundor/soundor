# ANGLE (OpenGL ES 3 over Metal, Direct3D 11 or Vulkan) as the imported target
# `soundor_angle`.
#
# ANGLE is built from source once per machine and configuration (revision,
# build scripts, platform, architectures, compiler) by SoundorAngleBuild.cmake
# into Soundor's cache directory, and reused by every build after that. The
# first configure takes a while; it needs git, Python 3 and ninja.
#
#   SOUNDOR_ENABLE_GPU   OFF: build without ANGLE (CPU rendering only)
#   SOUNDOR_ANGLE_DIR    use this ANGLE install instead (include/, lib/, libs.txt)
#   SOUNDOR_CACHE (env)  where to keep built ANGLEs (see SoundorSkia.cmake)
#
# Everything of ANGLE is compiled hidden and linked PRIVATE: no EGL, GLES or
# ANGLE symbol is exported from a plugin, and two plugins each carry their own.

include_guard(GLOBAL)

include(${CMAKE_CURRENT_LIST_DIR}/SoundorDependencies.cmake)

option(SOUNDOR_ENABLE_GPU "Build the GPU renderer (ANGLE); OFF renders on the CPU only" ON)
set(SOUNDOR_ANGLE_DIR "" CACHE PATH "An ANGLE install made by SoundorAngleBuild.cmake; empty: build one into the Soundor cache")

set(SOUNDOR_HAS_GPU OFF)
if(NOT SOUNDOR_ENABLE_GPU OR IOS)
  return()
endif()
set(SOUNDOR_HAS_GPU ON)

if(WIN32)
  set(soundor_angle_os win)
  set(soundor_angle_flavors md mdd)
elseif(APPLE)
  set(soundor_angle_os mac)
  set(soundor_angle_flavors release)
else()
  set(soundor_angle_os linux)
  set(soundor_angle_flavors release)
endif()

# gn's names for the architectures to build (all of them for a macOS universal build).
set(soundor_angle_cpus "")
if(APPLE AND CMAKE_OSX_ARCHITECTURES)
  set(soundor_angle_archs ${CMAKE_OSX_ARCHITECTURES})
elseif(CMAKE_SYSTEM_PROCESSOR)
  set(soundor_angle_archs ${CMAKE_SYSTEM_PROCESSOR})
else()
  set(soundor_angle_archs ${CMAKE_HOST_SYSTEM_PROCESSOR})
endif()
foreach(arch IN LISTS soundor_angle_archs)
  string(TOLOWER "${arch}" arch)
  if(arch MATCHES "^(arm64|aarch64)$")
    list(APPEND soundor_angle_cpus arm64)
  elseif(arch MATCHES "^(x86_64|amd64|x64)$")
    list(APPEND soundor_angle_cpus x64)
  else()
    message(FATAL_ERROR "Soundor cannot build ANGLE for the architecture '${arch}'")
  endif()
endforeach()
list(REMOVE_DUPLICATES soundor_angle_cpus)

if(NOT SOUNDOR_ANGLE_DIR)
  soundor_cache_root(cache_root)

  # The gn binary for this machine.
  string(TOLOWER "${CMAKE_HOST_SYSTEM_PROCESSOR}" host_cpu)
  if(CMAKE_HOST_WIN32)
    set(gn_platform windows-amd64)
  elseif(CMAKE_HOST_APPLE)
    if(host_cpu MATCHES "^(arm64|aarch64)$")
      set(gn_platform mac-arm64)
    else()
      set(gn_platform mac-amd64)
    endif()
  elseif(host_cpu MATCHES "^(arm64|aarch64)$")
    set(gn_platform linux-arm64)
  else()
    set(gn_platform linux-amd64)
  endif()
  string(REPLACE "-" "_" gn_key "${gn_platform}")
  set(gn_url "https://chrome-infra-packages.appspot.com/dl/gn/gn/${gn_platform}/+/${SOUNDOR_ANGLE_GN_VERSION}")
  set(gn_sha256 "${SOUNDOR_ANGLE_GN_SHA256_${gn_key}}")

  # Like Skia: built with the project's compiler when it is Clang (or MSVC on
  # Windows), otherwise with the clang on PATH.
  set(angle_cc "")
  set(angle_cxx "")
  if(NOT WIN32)
    if(CMAKE_CXX_COMPILER_ID MATCHES "Clang")
      set(angle_cc "${CMAKE_C_COMPILER}")
      set(angle_cxx "${CMAKE_CXX_COMPILER}")
    else()
      find_program(SOUNDOR_ANGLE_CLANG NAMES clang)
      find_program(SOUNDOR_ANGLE_CLANGXX NAMES clang++)
      if(SOUNDOR_ANGLE_CLANG AND SOUNDOR_ANGLE_CLANGXX)
        set(angle_cc "${SOUNDOR_ANGLE_CLANG}")
        set(angle_cxx "${SOUNDOR_ANGLE_CLANGXX}")
      endif()
    endif()
  endif()

  set(dependencies ${SOUNDOR_ANGLE_DEPENDENCIES})
  if(soundor_angle_os STREQUAL "linux")
    list(APPEND dependencies ${SOUNDOR_ANGLE_LINUX_DEPENDENCIES})
  endif()

  # The cache key: anything that changes the build changes the directory.
  file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/SoundorAngleBuild.cmake" build_hash)
  file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/SoundorAnglePatch.cmake" patch_hash)
  file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/angle/CMakeLists.txt" project_hash)
  file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/angle/targets.py" targets_hash)
  file(SHA256 "${CMAKE_CURRENT_LIST_DIR}/angle/deps.py" deps_hash)
  get_filename_component(angle_cxx_name "${angle_cxx}" NAME)
  string(SHA256 key
    "${SOUNDOR_ANGLE_REVISION};${dependencies};${build_hash};${patch_hash};${project_hash};${targets_hash};${deps_hash};${angle_cxx_name}")
  string(SUBSTRING "${key}" 0 12 key)
  string(SUBSTRING "${SOUNDOR_ANGLE_REVISION}" 0 10 short_revision)
  list(JOIN soundor_angle_cpus "-" cpu_names)
  set(SOUNDOR_ANGLE_DIR "${cache_root}/angle-${short_revision}-${soundor_angle_os}-${cpu_names}-${key}")

  if(NOT EXISTS "${SOUNDOR_ANGLE_DIR}/libs.txt")
    file(MAKE_DIRECTORY "${cache_root}")
    # Parallel configures wait for each other instead of building twice.
    file(LOCK "${SOUNDOR_ANGLE_DIR}.lock" GUARD PROCESS TIMEOUT 10800)
    if(NOT EXISTS "${SOUNDOR_ANGLE_DIR}/libs.txt")
      message(STATUS "Building ANGLE ${SOUNDOR_ANGLE_VERSION} into ${SOUNDOR_ANGLE_DIR} (once per machine)")
      execute_process(
        COMMAND ${CMAKE_COMMAND}
          "-DOUT=${SOUNDOR_ANGLE_DIR}"
          "-DREVISION=${SOUNDOR_ANGLE_REVISION}"
          "-DREPOSITORY=${SOUNDOR_ANGLE_REPOSITORY}"
          "-DDEPENDENCIES=${dependencies}"
          "-DTARGET_OS=${soundor_angle_os}"
          "-DCPUS=${soundor_angle_cpus}"
          "-DFLAVORS=${soundor_angle_flavors}"
          "-DGN_URL=${gn_url}"
          "-DGN_SHA256=${gn_sha256}"
          "-DCC=${angle_cc}"
          "-DCXX=${angle_cxx}"
          "-DGENERATOR=${CMAKE_GENERATOR}"
          -P "${CMAKE_CURRENT_LIST_DIR}/SoundorAngleBuild.cmake"
        RESULT_VARIABLE status)
      if(NOT status EQUAL 0)
        message(FATAL_ERROR "Building ANGLE failed (see above). Soundor needs git, Python 3 and ninja to build it; "
                            "-DSOUNDOR_ENABLE_GPU=OFF builds without it.")
      endif()
    endif()
    file(LOCK "${SOUNDOR_ANGLE_DIR}.lock" RELEASE)
  endif()
endif()

if(NOT EXISTS "${SOUNDOR_ANGLE_DIR}/libs.txt")
  message(FATAL_ERROR "SOUNDOR_ANGLE_DIR (${SOUNDOR_ANGLE_DIR}) is not an ANGLE install")
endif()

add_library(soundor_angle STATIC IMPORTED GLOBAL)
if(WIN32)
  set_target_properties(soundor_angle PROPERTIES
    IMPORTED_CONFIGURATIONS "RELEASE;DEBUG"
    IMPORTED_LOCATION "${SOUNDOR_ANGLE_DIR}/lib/md/angle.lib"
    IMPORTED_LOCATION_RELEASE "${SOUNDOR_ANGLE_DIR}/lib/md/angle.lib"
    IMPORTED_LOCATION_DEBUG "${SOUNDOR_ANGLE_DIR}/lib/mdd/angle.lib"
    MAP_IMPORTED_CONFIG_MINSIZEREL RELEASE
    MAP_IMPORTED_CONFIG_RELWITHDEBINFO RELEASE)
else()
  set_target_properties(soundor_angle PROPERTIES IMPORTED_LOCATION "${SOUNDOR_ANGLE_DIR}/lib/release/libangle.a")
endif()
# The headers declare everything, extensions included, without dllimport or
# default visibility.
target_compile_definitions(soundor_angle INTERFACE KHRONOS_STATIC ANGLE_EXPORT= GL_GLEXT_PROTOTYPES=1
                                                   EGL_EGLEXT_PROTOTYPES=1)
target_include_directories(soundor_angle SYSTEM INTERFACE "${SOUNDOR_ANGLE_DIR}/include")
file(STRINGS "${SOUNDOR_ANGLE_DIR}/libs.txt" soundor_angle_libs)
file(STRINGS "${SOUNDOR_ANGLE_DIR}/frameworks.txt" soundor_angle_frameworks)
foreach(framework IN LISTS soundor_angle_frameworks)
  string(REGEX REPLACE "\\.framework$" "" framework "${framework}")
  list(APPEND soundor_angle_libs "-framework ${framework}")
endforeach()
target_link_libraries(soundor_angle INTERFACE ${soundor_angle_libs})
