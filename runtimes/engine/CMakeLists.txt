cmake_minimum_required(VERSION 3.22)

# The Soundor native runtime: the embedded JavaScript engine and everything
# around it. Standalone it builds the library and its tests; a plugin project
# add_subdirectory()s it and links `Soundor::Engine`, built from these sources
# or taken from a prebuilt archive (the same targets either way).
#
# This library is backend-independent: it never includes JUCE. JUCE adapters
# live in their own targets so the core stays testable without a plugin host.
project(SoundorEngine LANGUAGES C CXX)

if(PROJECT_IS_TOP_LEVEL)
  set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
endif()

list(APPEND CMAKE_MODULE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/cmake)

# Exact npm package version owns the C++ ABI identity.
include(SoundorAbi)
include(SoundorPluginShim)

include(SoundorCompilerOptions)
include(SoundorEmbed)
include(SoundorPlatformLibraries)

# JavaScript is compiled to Hermes bytecode while building, with the hermesc
# of the same Hermes build as the VM (SoundorEmbed.cmake): the runtime's own
# modules (soundor_embed_module()) and a plugin's UI bundle
# (soundor_embed_ui()). The build has to run hermesc, so a cross build embeds
# source instead.
option(SOUNDOR_PRECOMPILE_JS "Compile JavaScript to Hermes bytecode at build time (not when cross-compiling)" ON)
# The VM with Hermes's compiler can also evaluate JavaScript source: what
# development needs (soundor dev reloads the UI's source) and the tests use. A
# production plugin runs only the bytecode its build compiled, so it links the
# VM alone, without the compiler.
option(SOUNDOR_JS_SOURCE "Link Hermes's compiler, so that JavaScript source can be evaluated (development)" ON)
option(SOUNDOR_ENABLE_DEVTOOLS "Compile development-only UI inspection (never enable for production plugins)" OFF)
# -fno-inline keeps every function's frame in stack traces: measured, inlining
# saved no time (examples/benchmark) and 315 bytes of a 1.1 MB bundle.
set(SOUNDOR_HERMESC_FLAGS "-O -fno-inline" CACHE STRING "hermesc's options for the bytecode the build compiles")

# A prebuilt engine: the extracted archives of an engine prebuilt release, one
# per configuration (README.md, "Prebuilt engines"). Without them, the engine
# is built from this package's sources.
set(SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR "" CACHE PATH "An extracted Debug engine prebuilt; empty: build from source")
set(SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR "" CACHE PATH "An extracted Release engine prebuilt; empty: build from source")
if(SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR OR SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR)
  include(SoundorEnginePrebuilt)
else()
  include(SoundorEngineSource)
  # `soundor_engine_stage`: this build as a prebuilt archive's contents.
  include(SoundorEngineStage)
endif()

# `cmake -DINPUT=<module.js> -DOUTPUT=<bytecode> -DNAME=<module name> -P <this>`
# compiles a module like the build does (examples/benchmark's `pnpm bench`).
configure_file(cmake/SoundorCompileJsTool.cmake.in ${CMAKE_BINARY_DIR}/soundor-compile-js.cmake @ONLY)

# The engine library and the names consumers link: the same in both modes.
add_library(Soundor::Engine ALIAS soundor_runtime)
add_library(soundor::runtime ALIAS soundor_runtime)

# For Soundor-owned code built outside this library — generated bindings and
# backend adapters — that is written against the runtime's internal headers.
# Never linked by plugin code itself.
add_library(soundor_runtime_internal INTERFACE)
add_library(soundor::runtime_internal ALIAS soundor_runtime_internal)
target_include_directories(soundor_runtime_internal INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(soundor_runtime_internal INTERFACE soundor_runtime soundor_hermes)

option(SOUNDOR_BUILD_TESTS "Build the Soundor native runtime tests" ${PROJECT_IS_TOP_LEVEL})
if(SOUNDOR_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
