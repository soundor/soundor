# `soundor_engine_stage` lays this build out as the contents of a prebuilt
# engine archive (README.md, "Prebuilt engines") in SOUNDOR_ENGINE_STAGE_DIR:
# the engine's libraries and every static library it links, the headers its
# internal consumers compile against, hermesc, license notices, and
# soundor-engine.json describing them. .github/scripts/engine-prebuilts.mjs
# packs it. A prebuilt release has two variants, each staged by its preset:
#
#   debug    Debug, DevTools, Hermes with its compiler (evaluates source)
#   release  Release, no DevTools, the bytecode-only Hermes VM
#
# Included by CMakeLists.txt after SoundorEngineSource.cmake.

include_guard(GLOBAL)

set(SOUNDOR_ENGINE_STAGE_DIR "" CACHE PATH "Where soundor_engine_stage lays this build out as a prebuilt engine")
set(SOUNDOR_ENGINE_SOURCE_COMMIT "" CACHE STRING "The full source commit a staged prebuilt engine records")
if(NOT SOUNDOR_ENGINE_STAGE_DIR)
  return()
endif()

if(SOUNDOR_ENABLE_DEVTOOLS AND SOUNDOR_JS_SOURCE)
  set(soundor_stage_variant debug)
  set(soundor_stage_config Debug)
elseif(NOT SOUNDOR_ENABLE_DEVTOOLS AND NOT SOUNDOR_JS_SOURCE)
  set(soundor_stage_variant release)
  set(soundor_stage_config Release)
else()
  message(FATAL_ERROR "A prebuilt engine is either debug (SOUNDOR_ENABLE_DEVTOOLS and SOUNDOR_JS_SOURCE ON) or "
                      "release (both OFF); use the prebuilt-debug or prebuilt-release preset")
endif()
if(NOT CMAKE_CONFIGURATION_TYPES AND NOT CMAKE_BUILD_TYPE STREQUAL soundor_stage_config)
  message(FATAL_ERROR "The ${soundor_stage_variant} prebuilt engine is a ${soundor_stage_config} build")
endif()
if(SOUNDOR_ENABLE_SANITIZERS OR SOUNDOR_HERMES_LTO OR CMAKE_CROSSCOMPILING)
  message(FATAL_ERROR "A prebuilt engine is built natively, without sanitizers or Hermes LTO")
endif()
if(NOT SOUNDOR_ENGINE_SOURCE_COMMIT MATCHES "^[0-9a-f]+$")
  message(FATAL_ERROR "SOUNDOR_ENGINE_SOURCE_COMMIT must be the full commit the engine is built from")
endif()

# The target: what its archive is named after, and what a consumer checks.
if(APPLE)
  set(soundor_stage_os macos)
  set(soundor_stage_archs ${CMAKE_OSX_ARCHITECTURES})
  if(NOT CMAKE_OSX_DEPLOYMENT_TARGET)
    message(FATAL_ERROR "A macOS prebuilt engine names its minimum macOS: set CMAKE_OSX_DEPLOYMENT_TARGET")
  endif()
elseif(WIN32)
  set(soundor_stage_os windows)
  set(soundor_stage_archs ${CMAKE_SYSTEM_PROCESSOR})
  if(CMAKE_VS_PLATFORM_NAME)
    set(soundor_stage_archs ${CMAKE_VS_PLATFORM_NAME})
  endif()
  if(NOT MSVC)
    message(FATAL_ERROR "A Windows prebuilt engine is built with MSVC")
  endif()
else()
  set(soundor_stage_os linux)
  set(soundor_stage_archs ${CMAKE_SYSTEM_PROCESSOR})
endif()
set(soundor_stage_cpus "")
foreach(arch IN LISTS soundor_stage_archs)
  string(TOLOWER "${arch}" arch)
  if(arch MATCHES "^(x86_64|amd64|x64)$")
    list(APPEND soundor_stage_cpus x64)
  elseif(arch MATCHES "^(arm64|aarch64)$")
    list(APPEND soundor_stage_cpus arm64)
  else()
    message(FATAL_ERROR "No prebuilt engine for the architecture '${arch}'")
  endif()
endforeach()
list(REMOVE_DUPLICATES soundor_stage_cpus)
list(SORT soundor_stage_cpus)
if(APPLE AND soundor_stage_cpus STREQUAL "arm64;x64")
  set(soundor_stage_target macos-universal)
elseif(APPLE)
  message(FATAL_ERROR "The macOS prebuilt engine is universal: CMAKE_OSX_ARCHITECTURES=arm64;x86_64")
else()
  set(soundor_stage_target "${soundor_stage_os}-${soundor_stage_cpus}")
endif()

# One build of each dependency per C runtime on Windows (md/mdd); elsewhere one.
set(soundor_stage_flavor release)
set(soundor_stage_crt "")
if(WIN32)
  if(soundor_stage_variant STREQUAL debug)
    set(soundor_stage_flavor mdd)
    set(soundor_stage_crt MultiThreadedDebugDLL)
  else()
    set(soundor_stage_flavor md)
    set(soundor_stage_crt MultiThreadedDLL)
  endif()
  if(CMAKE_MSVC_RUNTIME_LIBRARY AND NOT CMAKE_MSVC_RUNTIME_LIBRARY MATCHES "DLL")
    message(FATAL_ERROR "A Windows prebuilt engine uses the DLL C runtime (/MD, /MDd)")
  endif()
endif()

# Everything copied: <from>|<to>, files (`copies`) or directories (`trees`).
# Library paths are generator expressions, resolved per configuration.
set(soundor_stage_copies "")
set(soundor_stage_trees "")
set(soundor_stage_link_engine "")
foreach(library soundor_runtime soundor_ada soundor_yoga)
  list(APPEND soundor_stage_copies "$<TARGET_FILE:${library}>|lib/$<TARGET_FILE_NAME:${library}>")
  list(APPEND soundor_stage_link_engine "\"lib/$<TARGET_FILE_NAME:${library}>\"")
endforeach()
list(APPEND soundor_stage_copies "${CMAKE_CURRENT_BINARY_DIR}/generated/soundor/Abi.h|include/soundor/Abi.h")

# Hermes: the variant's libraries, its headers (JSI, for generated bindings),
# and its bytecode compiler for the build machine.
set(soundor_stage_hermes "${SOUNDOR_HERMES_DIR}/${soundor_stage_flavor}")
if(SOUNDOR_JS_SOURCE)
  set(soundor_stage_hermes_set full)
else()
  set(soundor_stage_hermes_set lean)
endif()
file(STRINGS "${soundor_stage_hermes}/lib/${soundor_stage_hermes_set}/libraries.txt" soundor_stage_names)
set(soundor_stage_link_hermes "")
foreach(name IN LISTS soundor_stage_names)
  list(APPEND soundor_stage_copies "${soundor_stage_hermes}/lib/${soundor_stage_hermes_set}/${name}|hermes/lib/${name}")
  list(APPEND soundor_stage_link_hermes "\"hermes/lib/${name}\"")
endforeach()
get_filename_component(soundor_stage_hermesc "${soundor_hermesc_path}" NAME)
list(APPEND soundor_stage_copies "${soundor_hermesc_path}|hermes/bin/${soundor_stage_hermesc}")
list(APPEND soundor_stage_trees "${soundor_stage_hermes}/include|hermes/include")
file(STRINGS "${soundor_stage_hermes}/system.txt" soundor_stage_system)

# Skia: its library only; its headers are the engine's private business.
if(WIN32)
  set(soundor_stage_skia "${SOUNDOR_SKIA_DIR}/lib/${soundor_stage_flavor}/skia.lib")
else()
  set(soundor_stage_skia "${SOUNDOR_SKIA_DIR}/lib/release/libskia.a")
endif()
get_filename_component(name "${soundor_stage_skia}" NAME)
list(APPEND soundor_stage_copies "${soundor_stage_skia}|skia/lib/${name}")
set(soundor_stage_link_skia "\"skia/lib/${name}\"")

# ANGLE: its library and headers (EGL and GLES, for GPU consumers).
set(soundor_stage_link_angle "")
set(soundor_stage_frameworks "")
if(SOUNDOR_HAS_GPU)
  if(WIN32)
    set(soundor_stage_angle "${SOUNDOR_ANGLE_DIR}/lib/${soundor_stage_flavor}/angle.lib")
  else()
    set(soundor_stage_angle "${SOUNDOR_ANGLE_DIR}/lib/release/libangle.a")
  endif()
  get_filename_component(name "${soundor_stage_angle}" NAME)
  list(APPEND soundor_stage_copies "${soundor_stage_angle}|angle/lib/${name}")
  list(APPEND soundor_stage_trees "${SOUNDOR_ANGLE_DIR}/include|angle/include")
  set(soundor_stage_link_angle "\"angle/lib/${name}\"")
  file(STRINGS "${SOUNDOR_ANGLE_DIR}/libs.txt" libraries)
  list(APPEND soundor_stage_system ${libraries})
  file(STRINGS "${SOUNDOR_ANGLE_DIR}/frameworks.txt" soundor_stage_frameworks)
endif()

# AccessKit: its static library and header.
set(soundor_stage_link_accesskit "")
if(SOUNDOR_HAS_ACCESSKIT)
  get_filename_component(name "${soundor_accesskit_library}" NAME)
  list(APPEND soundor_stage_copies "${soundor_accesskit_library}|accesskit/lib/${name}")
  list(APPEND soundor_stage_copies "${SOUNDOR_ACCESSKIT_DIR}/include/accesskit.h|accesskit/include/accesskit.h")
  set(soundor_stage_link_accesskit "\"accesskit/lib/${name}\"")
endif()
list(REMOVE_DUPLICATES soundor_stage_system)

# License notices: the texts each linked component ships with, plus the ones
# committed in licenses/ (README.md there) for what those leave out. The
# stage script fails when a linked component has none.
set(soundor_stage_licenses
  "engine|${SoundorEngine_SOURCE_DIR}/LICENSE"
  "engine|${SoundorEngine_SOURCE_DIR}/NOTICE.md"
  "hermes|${soundor_stage_hermes}/LICENSE"
  "hermes|${SoundorEngine_SOURCE_DIR}/licenses/hermes/llvh"
  "hermes|${SoundorEngine_SOURCE_DIR}/licenses/hermes/dtoa"
  "ada|${SoundorEngine_SOURCE_DIR}/licenses/ada"
  "yoga|${SoundorEngine_SOURCE_DIR}/licenses/yoga"
  "skia|${SOUNDOR_SKIA_DIR}/LICENSE"
  "skia|${SoundorEngine_SOURCE_DIR}/licenses/skia")
if(soundor_stage_os STREQUAL linux)
  list(APPEND soundor_stage_licenses "hermes|${SoundorEngine_SOURCE_DIR}/licenses/hermes/quickjs-ng")
endif()
if(SOUNDOR_HAS_GPU)
  list(APPEND soundor_stage_licenses "angle|${SOUNDOR_ANGLE_DIR}/licenses")
endif()
if(SOUNDOR_HAS_ACCESSKIT)
  list(APPEND soundor_stage_licenses
    "accesskit|${SOUNDOR_ACCESSKIT_DIR}/LICENSE-MIT"
    "accesskit|${SOUNDOR_ACCESSKIT_DIR}/LICENSE-APACHE"
    "accesskit|${SOUNDOR_ACCESSKIT_DIR}/LICENSE.chromium"
    "accesskit|${SoundorEngine_SOURCE_DIR}/licenses/accesskit/crates-${soundor_stage_target}.md"
    "accesskit|${SoundorEngine_SOURCE_DIR}/licenses/rust")
endif()

function(soundor_stage_json_list out)
  set(items "")
  foreach(item IN LISTS ARGN)
    list(APPEND items "\"${item}\"")
  endforeach()
  list(JOIN items ", " joined)
  set(${out} "[${joined}]" PARENT_SCOPE)
endfunction()
list(JOIN soundor_stage_link_engine ", " soundor_stage_link_engine)
list(JOIN soundor_stage_link_hermes ", " soundor_stage_link_hermes)
soundor_stage_json_list(soundor_stage_archs_json ${soundor_stage_cpus})
soundor_stage_json_list(soundor_stage_system_json ${soundor_stage_system})
soundor_stage_json_list(soundor_stage_frameworks_json ${soundor_stage_frameworks})
set(soundor_stage_bool_devtools false)
set(soundor_stage_bool_source false)
set(soundor_stage_bool_gpu false)
set(soundor_stage_bool_accesskit false)
if(SOUNDOR_ENABLE_DEVTOOLS)
  set(soundor_stage_bool_devtools true)
endif()
if(SOUNDOR_JS_SOURCE)
  set(soundor_stage_bool_source true)
endif()
if(SOUNDOR_HAS_GPU)
  set(soundor_stage_bool_gpu true)
endif()
if(SOUNDOR_HAS_ACCESSKIT)
  set(soundor_stage_bool_accesskit true)
endif()

# What a consumer reads (SoundorEnginePrebuilt.cmake) and the release checks
# (engine-prebuilts.mjs): one object per archive, format 1.
set(soundor_stage_metadata [=[{
  "format": 1,
  "engine": {
    "version": "@SOUNDOR_ENGINE_VERSION@",
    "abiNamespace": "@SOUNDOR_ABI_NAMESPACE@",
    "sourceCommit": "@SOUNDOR_ENGINE_SOURCE_COMMIT@"
  },
  "variant": "@soundor_stage_variant@",
  "configuration": "@soundor_stage_config@",
  "target": {
    "name": "@soundor_stage_target@",
    "os": "@soundor_stage_os@",
    "architectures": @soundor_stage_archs_json@,
    "minimumOsVersion": "@CMAKE_OSX_DEPLOYMENT_TARGET@"
  },
  "toolchain": {
    "compiler": "@CMAKE_CXX_COMPILER_ID@",
    "compilerVersion": "@CMAKE_CXX_COMPILER_VERSION@",
    "msvcRuntime": "@soundor_stage_crt@"
  },
  "features": {
    "devtools": @soundor_stage_bool_devtools@,
    "jsSource": @soundor_stage_bool_source@,
    "gpu": @soundor_stage_bool_gpu@,
    "accessKit": @soundor_stage_bool_accesskit@
  },
  "hermes": {
    "revision": "@SOUNDOR_HERMES_REVISION@",
    "bytecodeVersion": "@SOUNDOR_HERMES_BYTECODE_VERSION@",
    "compiler": "hermes/bin/@soundor_stage_hermesc@"
  },
  "link": {
    "engine": [@soundor_stage_link_engine@],
    "hermes": [@soundor_stage_link_hermes@],
    "skia": [@soundor_stage_link_skia@],
    "angle": [@soundor_stage_link_angle@],
    "accessKit": [@soundor_stage_link_accesskit@],
    "system": @soundor_stage_system_json@,
    "frameworks": @soundor_stage_frameworks_json@
  }
}
]=])
string(CONFIGURE "${soundor_stage_metadata}" soundor_stage_metadata @ONLY)

file(GENERATE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/soundor-engine-stage-$<CONFIG>.cmake" CONTENT "\
set(STAGE [==[${SOUNDOR_ENGINE_STAGE_DIR}]==])
set(CONFIG [==[$<CONFIG>]==])
set(EXPECTED_CONFIG [==[${soundor_stage_config}]==])
set(COPIES [==[${soundor_stage_copies}]==])
set(TREES [==[${soundor_stage_trees}]==])
set(LICENSES [==[${soundor_stage_licenses}]==])
set(LINKED [==[engine;hermes;ada;yoga;skia$<$<BOOL:${SOUNDOR_HAS_GPU}>:;angle>$<$<BOOL:${SOUNDOR_HAS_ACCESSKIT}>:;accesskit>]==])
set(METADATA [==[${soundor_stage_metadata}]==])
")
add_custom_target(soundor_engine_stage
  COMMAND ${CMAKE_COMMAND} "-DINPUTS=${CMAKE_CURRENT_BINARY_DIR}/soundor-engine-stage-$<CONFIG>.cmake"
          -P "${CMAKE_CURRENT_LIST_DIR}/SoundorEngineStageFiles.cmake"
  DEPENDS soundor_runtime soundor_ada soundor_yoga
  COMMENT "Staging the ${soundor_stage_variant} prebuilt engine for ${soundor_stage_target}"
  VERBATIM)
