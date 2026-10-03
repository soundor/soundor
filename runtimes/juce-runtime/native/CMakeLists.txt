cmake_minimum_required(VERSION 3.22)

# The Soundor native runtime: the embedded JavaScript engine and everything
# around it. Standalone it builds the library and its tests; a generated plugin
# project will add_subdirectory() it and link `soundor::runtime`.
#
# This library is backend-independent: it never includes JUCE. JUCE adapters
# live in their own targets so the core stays testable without a plugin host.
project(SoundorRuntime VERSION 0.1.0 LANGUAGES C CXX)

if(PROJECT_IS_TOP_LEVEL)
  set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
endif()

list(APPEND CMAKE_MODULE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/cmake)

include(SoundorCompilerOptions)
include(SoundorQuickJS)

# Inline namespace that every Soundor-native C++ symbol is mangled into. A
# plugin build sets it to a value derived from its stable plugin identifier so
# two Soundor plugins in one host process never share a C++ symbol name; the
# source-level API stays `soundor::...` either way.
set(SOUNDOR_ABI_NAMESPACE "v0" CACHE STRING "Inline ABI namespace for Soundor-native symbols")
if(NOT SOUNDOR_ABI_NAMESPACE MATCHES "^[A-Za-z_][A-Za-z0-9_]*$")
  message(FATAL_ERROR "SOUNDOR_ABI_NAMESPACE must be a C++ identifier, got '${SOUNDOR_ABI_NAMESPACE}'")
endif()

add_library(soundor_runtime STATIC
  src/js/Context.cpp
  src/js/Error.cpp
  src/js/MemoryModuleLoader.cpp
  src/js/NativeModule.cpp
  src/js/Runtime.cpp
  src/js/Value.cpp
  src/js/ValueConversion.cpp)
add_library(soundor::runtime ALIAS soundor_runtime)

target_compile_features(soundor_runtime PUBLIC cxx_std_20)
target_compile_definitions(soundor_runtime PUBLIC SOUNDOR_ABI_NAMESPACE=${SOUNDOR_ABI_NAMESPACE})
target_include_directories(soundor_runtime
  PUBLIC ${CMAKE_CURRENT_SOURCE_DIR}/include
  PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/src)
# PRIVATE: QuickJS is an implementation detail; its headers never reach consumers.
target_link_libraries(soundor_runtime PRIVATE soundor_quickjs)
soundor_configure_target(soundor_runtime)

option(SOUNDOR_BUILD_TESTS "Build the Soundor native runtime tests" ${PROJECT_IS_TOP_LEVEL})
if(SOUNDOR_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
endif()
