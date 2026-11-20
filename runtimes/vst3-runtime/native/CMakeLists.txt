# The VST3 runtime's adapter: libsoundor_vst3.a, the generic VST3 plugin
# (the SDK's base classes, the component, the controller, the editor), the
# same for every plugin, prebuilt once per engine variant and linked into each
# plugin by `soundor build vst3` (src/link.ts) with the plugin's Rust library
# and the engine.
#
# It is compiled against an engine archive (SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR
# or SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR, as @soundor/engine's engine() gives
# it: scripts/adapter.ts), whose headers and definitions it must match: the
# archive's library is linked into the plugin, never into this one.

cmake_minimum_required(VERSION 3.22)
# One adapter per engine target: linux-x64 (Clang or GCC), macos-universal
# (Apple Clang, arm64 and x86_64 in one archive, as the engine's) and
# windows-x64 (MSVC, with the static C runtime: the engine's -static
# archives; scripts/adapter.ts sets CMAKE_MSVC_RUNTIME_LIBRARY).
if(APPLE)
  set(CMAKE_OSX_ARCHITECTURES "arm64;x86_64" CACHE STRING "The adapter's architectures, as the engine's")
  project(SoundorVst3Adapter VERSION 0.0.0 LANGUAGES C CXX OBJCXX)
else()
  project(SoundorVst3Adapter VERSION 0.0.0 LANGUAGES C CXX)
endif()

if(NOT CMAKE_SYSTEM_NAME MATCHES "^(Linux|Darwin|Windows)$")
  message(FATAL_ERROR "The VST3 runtime's adapter builds for Linux, macOS and Windows")
endif()
if(NOT SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR AND NOT SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR)
  message(FATAL_ERROR "The adapter is built against an engine archive: set SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR or "
                      "SOUNDOR_ENGINE_PREBUILT_RELEASE_DIR (node scripts/adapter.ts build does)")
endif()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
# Linked into a shared object, and private to it: every symbol hidden, but
# the VST3 entry points (SMTG_EXPORT_SYMBOL), which the plugin's version
# script exports.
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(CMAKE_C_VISIBILITY_PRESET hidden)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

option(SOUNDOR_VST3_TESTS "Build the adapter's native unit tests" OFF)

find_program(SOUNDOR_NODE_EXE NAMES node REQUIRED)
execute_process(COMMAND "${SOUNDOR_NODE_EXE}" --input-type=module -e
  "import {createRequire} from 'node:module'; console.log(createRequire(process.argv[1]).resolve('@soundor/engine/package.json'))"
  "${CMAKE_CURRENT_SOURCE_DIR}/../package.json"
  OUTPUT_VARIABLE engine_package OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
get_filename_component(engine_dir "${engine_package}" DIRECTORY)

include("${engine_dir}/cmake/SoundorCompilerOptions.cmake")
set(SOUNDOR_BUILD_TESTS OFF CACHE BOOL "" FORCE)
add_subdirectory("${engine_dir}" engine EXCLUDE_FROM_ALL)
include(cmake/Vst3Sdk.cmake)

set(soundor_vst3_sources
  src/Controller.cpp
  src/Descriptor.cpp
  src/Editor.cpp
  src/Expression.cpp
  src/Factory.cpp
  src/Link.cpp
  src/Log.cpp
  src/Modules.cpp
  src/ParameterHost.cpp
  src/Presets.cpp
  src/Processor.cpp
  src/State.cpp
  src/StateDocument.cpp
  src/Strings.cpp)
if(APPLE)
  list(APPEND soundor_vst3_sources src/NativeWindowMac.mm src/TimerMac.cpp)
elseif(WIN32)
  list(APPEND soundor_vst3_sources src/NativeWindowWindows.cpp src/TimerWindows.cpp)
else()
  list(APPEND soundor_vst3_sources src/NativeWindowLinux.cpp src/X11.cpp)
endif()

add_library(soundor_vst3 STATIC ${soundor_vst3_sources} ${SOUNDOR_VST3_SDK_SOURCES})
target_include_directories(soundor_vst3 PRIVATE include src)
target_include_directories(soundor_vst3 SYSTEM PRIVATE "${SOUNDOR_VST3_SDK_DIR}")
# The engine's headers and definitions (its ABI namespace, DevTools), and its
# internal binding helpers (js/Bindings.h); nothing of it is archived here.
target_link_libraries(soundor_vst3 PRIVATE soundor::runtime_internal)
target_compile_definitions(soundor_vst3 PRIVATE $<IF:$<CONFIG:Debug>,DEVELOPMENT=1,RELEASE=1>)
set(SOUNDOR_VST3_RUNTIME_VERSION "0.0.0" CACHE STRING "The @soundor/vst3-runtime version the adapter is built for")
target_compile_definitions(soundor_vst3 PRIVATE "SOUNDOR_VST3_RUNTIME_VERSION=\"${SOUNDOR_VST3_RUNTIME_VERSION}\"")
# Reproducible: no build paths in what it compiles (Clang, GCC).
if(NOT MSVC)
  target_compile_options(soundor_vst3 PRIVATE "-ffile-prefix-map=${CMAKE_SOURCE_DIR}=soundor-vst3"
                                              "-ffile-prefix-map=${CMAKE_BINARY_DIR}=soundor-vst3-build")
endif()
soundor_configure_target(soundor_vst3)
if(APPLE)
  # As the engine's Objective-C++.
  target_compile_options(soundor_vst3 PRIVATE $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc -Wno-old-style-cast>)
endif()
# Upstream code: compiled with the adapter, linted and warned about by nobody.
set_source_files_properties(${SOUNDOR_VST3_SDK_SOURCES} PROPERTIES SKIP_LINTING ON
                                                                COMPILE_OPTIONS "$<IF:$<CXX_COMPILER_ID:MSVC>,/w,-w>")
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  # The X11 headers, for types only: the editor loads libX11 at run time.
  find_path(SOUNDOR_X11_INCLUDE_DIR X11/Xlib.h REQUIRED)
  target_include_directories(soundor_vst3 SYSTEM PRIVATE "${SOUNDOR_X11_INCLUDE_DIR}")
endif()

# The archive as `soundor build vst3` finds it in the published package:
# prebuilt/<target>-<variant>/ (scripts/adapter.ts stages it). lib/ for
# every configuration (the generator expression keeps Visual Studio from
# adding one of its own).
set_target_properties(soundor_vst3 PROPERTIES ARCHIVE_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/lib$<0:>")
configure_file("${SOUNDOR_VST3_SDK_LICENSE}" "${CMAKE_BINARY_DIR}/licenses/vst3sdk/LICENSE.txt" COPYONLY)

if(SOUNDOR_VST3_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
