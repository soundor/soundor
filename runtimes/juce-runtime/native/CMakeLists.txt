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
include(SoundorEmbed)
include(SoundorHermes)
include(SoundorAda)
include(SoundorYoga)
include(SoundorSkia)
include(SoundorAngle)
include(SoundorAccessKit)
include(SoundorPluginBundle)

# Inline namespace that every Soundor-native C++ symbol is mangled into. A
# plugin build sets it to a value derived from its stable plugin identifier so
# two Soundor plugins in one host process never share a C++ symbol name; the
# source-level API stays `soundor::...` either way.
set(SOUNDOR_ABI_NAMESPACE "v0" CACHE STRING "Inline ABI namespace for Soundor-native symbols")
if(NOT SOUNDOR_ABI_NAMESPACE MATCHES "^[A-Za-z_][A-Za-z0-9_]*$")
  message(FATAL_ERROR "SOUNDOR_ABI_NAMESPACE must be a C++ identifier, got '${SOUNDOR_ABI_NAMESPACE}'")
endif()

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
# -fno-inline keeps every function's frame in stack traces: measured, inlining
# saved no time (examples/benchmark) and 315 bytes of a 1.1 MB bundle.
set(SOUNDOR_HERMESC_FLAGS "-O -fno-inline" CACHE STRING "hermesc's options for the bytecode the build compiles")
# `cmake -DINPUT=<module.js> -DOUTPUT=<bytecode> -DNAME=<module name> -P <this>`
# compiles a module like the build does (examples/benchmark's `pnpm bench`).
configure_file(cmake/SoundorCompileJsTool.cmake.in ${CMAKE_BINARY_DIR}/soundor-compile-js.cmake @ONLY)

# The VM the runtime links: with its compiler or bytecode only.
add_library(soundor_hermes INTERFACE)
if(SOUNDOR_JS_SOURCE)
  target_link_libraries(soundor_hermes INTERFACE soundor_hermes_full)
else()
  target_link_libraries(soundor_hermes INTERFACE soundor_hermes_lean)
endif()

set(SOUNDOR_RUNTIME_SOURCES
  src/a11y/Platform.cpp
  src/a11y/PlatformSupport.cpp
  src/a11y/Semantics.cpp
  src/a11y/SurfaceSemantics.cpp
  src/js/Bindings.cpp
  src/js/Context.cpp
  src/js/Error.cpp
  src/js/MemoryModuleLoader.cpp
  src/js/NativeModule.cpp
  src/js/Runtime.cpp
  src/js/Value.cpp
  src/js/ValueConversion.cpp
  src/modules/parameters/ParametersModule.cpp
  src/modules/ui/CanvasModule.cpp
  src/modules/ui/UiModule.cpp
  src/platform/FileLog.cpp
  src/platform/Resources.cpp
  src/platform/WorkerThread.cpp
  src/runtime/DevSession.cpp
  src/runtime/RuntimeHost.cpp
  src/render/Canvas2D.cpp
  src/render/Damage.cpp
  src/render/Frame.cpp
  src/render/RasterCompositor.cpp
  src/render/Renderer.cpp
  src/render/SkiaText.cpp
  src/render/AnimationRenderer.cpp
  src/render/ViewRenderer.cpp
  src/ui/Color.cpp
  src/ui/Animation.cpp
  src/ui/Surface.cpp
  src/ui/Text.cpp
  src/web/Encoding.cpp
  src/web/Files.cpp
  src/web/Host.cpp
  src/web/Http.cpp
  src/web/Random.cpp
  src/web/Url.cpp
  src/web/Web.cpp)
# macOS and iOS: Soundor's own accessibility bridges (Objective-C++, ARC).
if(APPLE)
  enable_language(OBJCXX)
  list(APPEND SOUNDOR_RUNTIME_SOURCES src/a11y/apple/AppleShared.mm)
  if(IOS)
    list(APPEND SOUNDOR_RUNTIME_SOURCES src/a11y/apple/IosPlatform.mm)
  else()
    list(APPEND SOUNDOR_RUNTIME_SOURCES src/a11y/apple/MacPlatform.mm)
  endif()
endif()
if(SOUNDOR_HAS_ACCESSKIT)
  list(APPEND SOUNDOR_RUNTIME_SOURCES
    src/a11y/accesskit/AccessKitPlatform.cpp
    src/a11y/accesskit/Mapping.cpp)
endif()
# The GPU: ANGLE's devices and contexts, the GPU compositor and where it
# presents (see SoundorAngle.cmake).
if(SOUNDOR_HAS_GPU)
  list(APPEND SOUNDOR_RUNTIME_SOURCES
    src/gpu/Context.cpp
    src/gpu/Device.cpp
    src/gpu/GpuCompositor.cpp
    src/gpu/LayerRenderer.cpp
    src/gpu/OffscreenCompositor.cpp
    src/gpu/webgl/WebGLContext.cpp
    src/gpu/webgl/WebGLModule.cpp)
  if(APPLE)
    list(APPEND SOUNDOR_RUNTIME_SOURCES src/gpu/apple/LayerPresentation.mm)
  elseif(WIN32)
    list(APPEND SOUNDOR_RUNTIME_SOURCES src/gpu/win/ChildWindowPresentation.cpp)
  else()
    list(APPEND SOUNDOR_RUNTIME_SOURCES src/gpu/NoPresentation.cpp)
  endif()
else()
  list(APPEND SOUNDOR_RUNTIME_SOURCES src/gpu/webgl/NoWebGL.cpp)
endif()
list(TRANSFORM SOUNDOR_RUNTIME_SOURCES PREPEND "${CMAKE_CURRENT_SOURCE_DIR}/")

add_library(soundor_runtime STATIC ${SOUNDOR_RUNTIME_SOURCES})
add_library(soundor::runtime ALIAS soundor_runtime)
# Each with the name it is registered under, which its bytecode carries,
# lowered from src/ while building (soundor_embed_module()).
soundor_embed_module(soundor_runtime languageModule src/js/language.js soundor:internal/language)
foreach(module fs host parameters storage)
  soundor_embed_module(soundor_runtime ${module}Module src/modules/${module}/${module}.js soundor:${module})
endforeach()
soundor_embed_module(soundor_runtime uiModule src/modules/ui/ui.js soundor:ui)
foreach(module abort base64 blob clone console crypto encoding events fetch inspect timers url)
  soundor_embed_module(soundor_runtime ${module}Module src/web/js/${module}.js soundor:internal/web/${module})
endforeach()
soundor_embed_module(soundor_runtime webModule src/web/js/web.js soundor:internal/web)
soundor_embed_module(soundor_runtime formDataModule src/web/js/form-data.js soundor:internal/web/form-data)
soundor_embed_module(soundor_runtime domExceptionModule src/web/js/dom-exception.js
                     soundor:internal/web/dom-exception)
soundor_embed_module(soundor_runtime uiFramesModule src/modules/ui/frames.js soundor:internal/ui/frames)
soundor_embed_module(soundor_runtime uiCanvasModule src/modules/ui/canvas.js soundor:internal/ui/canvas)
soundor_embed_module(soundor_runtime uiWebGLModule src/gpu/webgl/webgl.js soundor:internal/ui/webgl)
soundor_embed_module(soundor_runtime uiWebGLGeneratedModule src/gpu/webgl/generated/webgl-generated.js
                     soundor:internal/ui/webgl-generated)

# Everything a runtime library is besides its sources: `namespace` is the
# inline ABI namespace its symbols are mangled into.
function(soundor_configure_runtime target namespace)
  target_compile_features(${target} PUBLIC cxx_std_20)
  target_compile_definitions(${target} PUBLIC SOUNDOR_ABI_NAMESPACE=${namespace})
  # Bytecode is only run by the Hermes it was compiled for (src/js/Bytecode.h).
  target_compile_definitions(${target} PRIVATE SOUNDOR_HERMES_REVISION="${SOUNDOR_HERMES_REVISION}")
  target_include_directories(${target}
    PUBLIC ${PROJECT_SOURCE_DIR}/include
    PRIVATE ${PROJECT_SOURCE_DIR}/src)
  # PRIVATE: Hermes is an implementation detail; its headers never reach consumers.
  target_link_libraries(${target} PRIVATE soundor_hermes soundor_ada soundor_yoga soundor_skia Threads::Threads)
  if(IOS)
    target_link_libraries(${target} PRIVATE "-framework UIKit")
  elseif(APPLE)
    target_link_libraries(${target} PRIVATE "-framework AppKit")
  endif()
  if(SOUNDOR_HAS_ACCESSKIT)
    target_link_libraries(${target} PRIVATE soundor_accesskit)
    target_compile_definitions(${target} PRIVATE SOUNDOR_HAS_ACCESSKIT=1)
  else()
    target_compile_definitions(${target} PRIVATE SOUNDOR_HAS_ACCESSKIT=0)
  endif()
  if(SOUNDOR_HAS_GPU)
    target_link_libraries(${target} PRIVATE soundor_angle)
    target_compile_definitions(${target} PRIVATE SOUNDOR_HAS_GPU=1)
  else()
    target_compile_definitions(${target} PRIVATE SOUNDOR_HAS_GPU=0)
  endif()
  if(WIN32)
    target_link_libraries(${target} PRIVATE bcrypt) # crypto.getRandomValues
  endif()
  soundor_configure_target(${target})
  # Objective-C++ (the macOS bridge): C++20 and hidden like the rest, ARC,
  # and bridged casts that look like C casts.
  set_target_properties(${target} PROPERTIES
    OBJCXX_STANDARD 20
    OBJCXX_STANDARD_REQUIRED ON
    OBJCXX_EXTENSIONS OFF
    OBJCXX_VISIBILITY_PRESET hidden)
  target_compile_options(${target} PRIVATE $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc -Wno-old-style-cast>)
endfunction()

soundor_configure_runtime(soundor_runtime ${SOUNDOR_ABI_NAMESPACE})

# For Soundor-owned code built outside this library — generated bindings and
# backend adapters — that is written against the runtime's internal headers.
# Never linked by plugin code itself.
add_library(soundor_runtime_internal INTERFACE)
add_library(soundor::runtime_internal ALIAS soundor_runtime_internal)
target_include_directories(soundor_runtime_internal INTERFACE ${CMAKE_CURRENT_SOURCE_DIR}/src)
target_link_libraries(soundor_runtime_internal INTERFACE soundor_runtime soundor_hermes)

option(SOUNDOR_BUILD_TESTS "Build the Soundor native runtime tests" ${PROJECT_IS_TOP_LEVEL})
option(SOUNDOR_JUCE_TESTS "Also build the JUCE adapter tests (needs JUCE_DIR)" OFF)
if(SOUNDOR_BUILD_TESTS)
  enable_testing()
  add_subdirectory(tests)
  if(SOUNDOR_JUCE_TESTS)
    if(NOT JUCE_DIR OR NOT EXISTS "${JUCE_DIR}/CMakeLists.txt")
      message(FATAL_ERROR "SOUNDOR_JUCE_TESTS needs JUCE_DIR to point at a JUCE checkout")
    endif()
    add_subdirectory(backend/juce/tests)
  endif()
endif()
