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
include(SoundorQuickJS)
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
  src/render/ViewRenderer.cpp
  src/ui/Color.cpp
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
foreach(module fs host parameters storage ui)
  soundor_embed_text(soundor_runtime ${module}Module src/modules/${module}/${module}.js)
endforeach()
foreach(module abort blob clone console crypto encoding events fetch inspect timers url web)
  soundor_embed_text(soundor_runtime ${module}Module src/web/js/${module}.js)
endforeach()
soundor_embed_text(soundor_runtime formDataModule src/web/js/form-data.js)
soundor_embed_text(soundor_runtime uiFramesModule src/modules/ui/frames.js)
soundor_embed_text(soundor_runtime uiCanvasModule src/modules/ui/canvas.js)
soundor_embed_text(soundor_runtime uiWebGLModule src/gpu/webgl/webgl.js)
soundor_embed_text(soundor_runtime uiWebGLGeneratedModule src/gpu/webgl/generated/webgl-generated.js)

# Everything a runtime library is besides its sources: `namespace` is the
# inline ABI namespace its symbols are mangled into.
function(soundor_configure_runtime target namespace)
  target_compile_features(${target} PUBLIC cxx_std_20)
  target_compile_definitions(${target} PUBLIC SOUNDOR_ABI_NAMESPACE=${namespace})
  target_include_directories(${target}
    PUBLIC ${PROJECT_SOURCE_DIR}/include
    PRIVATE ${PROJECT_SOURCE_DIR}/src)
  # PRIVATE: QuickJS is an implementation detail; its headers never reach consumers.
  target_link_libraries(${target} PRIVATE soundor_quickjs soundor_ada soundor_yoga soundor_skia Threads::Threads)
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
target_link_libraries(soundor_runtime_internal INTERFACE soundor_runtime soundor_quickjs)

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
