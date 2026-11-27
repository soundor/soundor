# The engine built from this package's sources (the default, and what the
# prebuilt archives are staged from): Hermes, Skia and ANGLE
# from the Soundor cache (built there once per machine), ada and Yoga, and the
# runtime library itself. Included by CMakeLists.txt in its directory scope.

include_guard(GLOBAL)

if(SOUNDOR_ENABLE_DEVTOOLS AND NOT CMAKE_CONFIGURATION_TYPES AND NOT CMAKE_BUILD_TYPE STREQUAL "Debug")
  message(FATAL_ERROR "Soundor DevTools requires a Debug build. Disable SOUNDOR_ENABLE_DEVTOOLS for production.")
endif()

include(SoundorHermes)
include(SoundorAda)
include(SoundorYoga)
include(SoundorSkia)
include(SoundorAngle)
include(SoundorCoreSources)

# The VM the runtime links: with its compiler or bytecode only.
add_library(soundor_hermes INTERFACE)
if(SOUNDOR_JS_SOURCE)
  target_link_libraries(soundor_hermes INTERFACE soundor_hermes_full)
else()
  target_link_libraries(soundor_hermes INTERFACE soundor_hermes_lean)
endif()

set(SOUNDOR_RUNTIME_SOURCES
  src/runtime/Abi.cpp
  src/a11y/Platform.cpp
  src/a11y/PlatformSupport.cpp
  src/a11y/Semantics.cpp
  src/a11y/SurfaceSemantics.cpp
  src/js/Bindings.cpp
  src/js/Context.cpp
  src/js/Error.cpp
  src/js/Streams.cpp
  src/js/Events.cpp
  src/js/MemoryModuleLoader.cpp
  src/js/NativeModule.cpp
  src/js/Runtime.cpp
  src/js/RustMethods.cpp
  src/js/Value.cpp
  src/js/ValueConversion.cpp
  src/json/Json.cpp
  src/modules/midi/Midi.cpp
  src/modules/history/HistoryModule.cpp
  src/modules/parameters/ParametersModule.cpp
  src/modules/ui/CanvasModule.cpp
  src/modules/ui/UiModule.cpp
  src/modules/ui/SvgScene.cpp
  src/platform/FileLog.cpp
  src/platform/Http.cpp
  src/platform/Resources.cpp
  src/platform/ModuleResources.cpp
  src/platform/WorkerThread.cpp
  src/processor/RustController.cpp
  src/processor/RustProcessor.cpp
  src/runtime/DevSession.cpp
  src/runtime/RuntimeHost.cpp
  src/render/Canvas2D.cpp
  src/render/DrawingSurface.cpp
  src/render/Damage.cpp
  src/render/RasterCompositor.cpp
  src/render/Renderer.cpp
  src/render/SkiaText.cpp
  src/render/SvgDocument.cpp
  src/render/VectorScene.cpp
  src/render/AnimationRenderer.cpp
  src/render/ViewRenderer.cpp
  src/web/Encoding.cpp
  src/web/Files.cpp
  src/web/Host.cpp
  src/web/Http.cpp
  src/web/Random.cpp
  src/web/Url.cpp
  src/web/Web.cpp)
# The core the WebAssembly engine is built from too.
list(APPEND SOUNDOR_RUNTIME_SOURCES ${SOUNDOR_CORE_SOURCES})
# Apple runtime classes, accessibility and macOS input (Objective-C++, ARC).
if(APPLE)
  enable_language(OBJCXX)
  list(APPEND SOUNDOR_RUNTIME_SOURCES src/a11y/apple/AppleShared.mm src/platform/apple/RuntimeClass.mm
       src/platform/apple/UrlSessionHttpClient.mm src/platform/apple/Clipboard.mm)
  if(IOS)
    list(APPEND SOUNDOR_RUNTIME_SOURCES src/a11y/apple/IosPlatform.mm)
  else()
    list(APPEND SOUNDOR_RUNTIME_SOURCES src/a11y/apple/MacPlatform.mm src/input/apple/MacInput.mm)
  endif()
endif()
if(WIN32)
  list(APPEND SOUNDOR_RUNTIME_SOURCES src/a11y/windows/Uia.cpp src/input/windows/WindowsInput.cpp src/input/windows/Translation.cpp
       src/platform/windows/WinHttpClient.cpp src/platform/windows/Clipboard.cpp)
endif()
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  list(APPEND SOUNDOR_RUNTIME_SOURCES src/a11y/linux/AtSpi.cpp src/a11y/linux/Mapping.cpp src/a11y/linux/Platform.cpp)
endif()
# Native input: Windows (Win32), macOS (AppKit), Linux (X11 and XInput 2), and the
# plugin framework's elsewhere (see src/input/Platform.cpp).
list(APPEND SOUNDOR_RUNTIME_SOURCES src/input/Platform.cpp src/input/ClickCounter.cpp src/input/KeyCodes.cpp src/input/PointerLock.cpp)
# A plugin's view: what every runtime's editor does with the engine (editor/Editor.h).
list(APPEND SOUNDOR_RUNTIME_SOURCES src/editor/Layout.cpp src/editor/Editor.cpp)
if(APPLE AND NOT IOS)
  list(APPEND SOUNDOR_RUNTIME_SOURCES src/input/apple/Translation.cpp)
endif()
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  # Only their headers: native input and clipboard load the X11 libraries
  # on demand, so an engine needs no X11 to load.
  find_package(X11)
  if(NOT X11_FOUND OR NOT X11_Xi_INCLUDE_PATH OR NOT X11_Xkb_INCLUDE_PATH)
    message(FATAL_ERROR "Soundor's Linux input needs the X11 and XInput 2 headers (libx11-dev and libxi-dev on Debian and Ubuntu, libX11-devel and libXi-devel on Fedora).")
  endif()
  if(NOT X11_xcb_INCLUDE_PATH)
    message(FATAL_ERROR "Soundor's Linux clipboard needs the XCB headers (libxcb1-dev on Debian and Ubuntu, libxcb-devel on Fedora).")
  endif()
  list(APPEND SOUNDOR_RUNTIME_SOURCES src/input/linux/Keys.cpp src/input/linux/Scroll.cpp src/input/linux/X11Input.cpp
       src/platform/linux/CurlHttpClient.cpp src/platform/linux/Clipboard.cpp)
endif()
# The GPU: ANGLE's devices and contexts, the GPU compositor and where it
# presents (see SoundorAngle.cmake).
if(SOUNDOR_HAS_GPU)
  list(APPEND SOUNDOR_RUNTIME_SOURCES
    src/gpu/DrawingContext.cpp
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
    list(APPEND SOUNDOR_RUNTIME_SOURCES src/gpu/linux/ChildWindowPresentation.cpp)
  endif()
else()
  list(APPEND SOUNDOR_RUNTIME_SOURCES src/gpu/NoGpuCompositor.cpp src/gpu/webgl/NoWebGL.cpp)
endif()
list(TRANSFORM SOUNDOR_RUNTIME_SOURCES PREPEND "${CMAKE_CURRENT_SOURCE_DIR}/")
if(SOUNDOR_ENABLE_DEVTOOLS)
  list(APPEND SOUNDOR_RUNTIME_SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/src/debug/Inspector.cpp
        ${CMAKE_CURRENT_SOURCE_DIR}/src/debug/Commands.cpp ${CMAKE_CURRENT_SOURCE_DIR}/src/debug/Input.cpp
        ${CMAKE_CURRENT_SOURCE_DIR}/src/debug/Bridge.cpp
        ${CMAKE_CURRENT_SOURCE_DIR}/src/debug/Capture.cpp ${CMAKE_CURRENT_SOURCE_DIR}/src/render/Png.cpp
        ${CMAKE_CURRENT_SOURCE_DIR}/src/debug/Diagnostics.cpp ${CMAKE_CURRENT_SOURCE_DIR}/src/render/DebugOverlay.cpp)
endif()

add_library(soundor_runtime STATIC ${SOUNDOR_RUNTIME_SOURCES})
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  target_include_directories(soundor_runtime SYSTEM PRIVATE ${X11_INCLUDE_DIR} ${X11_Xi_INCLUDE_PATH} ${X11_xcb_INCLUDE_PATH})
endif()
# Each with the name it is registered under, which its bytecode carries,
# lowered from src/ while building (soundor_embed_module()).
soundor_embed_module(soundor_runtime languageModule src/js/language.js soundor:internal/language)
foreach(module fs host parameters storage)
  soundor_embed_module(soundor_runtime ${module}Module src/modules/${module}/${module}.js soundor:${module})
endforeach()
soundor_embed_module(soundor_runtime midiModule src/modules/midi/midi.js soundor:midi)
soundor_embed_module(soundor_runtime uiModule src/modules/ui/ui.js soundor:ui)
soundor_embed_module(soundor_runtime nativeEventsModule src/modules/native/events.js soundor:internal/native-events)
soundor_embed_module(soundor_runtime nativeStreamsModule src/modules/native/streams.js soundor:internal/native-streams)
foreach(module abort base64 blob clone console crypto encoding events fetch inspect timers url)
  soundor_embed_module(soundor_runtime ${module}Module src/web/js/${module}.js soundor:internal/web/${module})
endforeach()
soundor_embed_module(soundor_runtime webModule src/web/js/web.js soundor:internal/web)
soundor_embed_module(soundor_runtime formDataModule src/web/js/form-data.js soundor:internal/web/form-data)
soundor_embed_module(soundor_runtime domExceptionModule src/web/js/dom-exception.js
                     soundor:internal/web/dom-exception)
soundor_embed_module(soundor_runtime uiFramesModule src/modules/ui/frames.js soundor:internal/ui/frames)
soundor_embed_module(soundor_runtime uiResizeModule src/modules/ui/resize.js soundor:internal/ui/resize)
soundor_embed_module(soundor_runtime uiLongPressModule src/modules/ui/longPress.js soundor:internal/ui/long-press)
soundor_embed_module(soundor_runtime uiCanvasModule src/modules/ui/canvas.js soundor:internal/ui/canvas)
soundor_embed_module(soundor_runtime uiWebGLModule src/gpu/webgl/webgl.js soundor:internal/ui/webgl)
soundor_embed_module(soundor_runtime uiWebGLGeneratedModule src/gpu/webgl/generated/webgl-generated.js
                     soundor:internal/ui/webgl-generated)

# Everything a runtime library is besides its sources: `namespace` is the
# inline ABI namespace its symbols are mangled into.
function(soundor_configure_runtime target)
  target_compile_definitions(${target} PRIVATE SOUNDOR_HAS_GANESH=$<AND:$<BOOL:${SOUNDOR_ENABLE_GANESH}>,$<BOOL:${SOUNDOR_HAS_GPU}>>)
  target_compile_features(${target} PUBLIC cxx_std_20)
  
  target_compile_definitions(${target} PUBLIC SOUNDOR_DEVTOOLS=$<AND:$<BOOL:${SOUNDOR_ENABLE_DEVTOOLS}>,$<CONFIG:Debug>>)
  # Bytecode is only run by the Hermes it was compiled for (src/js/Bytecode.h).
  target_compile_definitions(${target} PRIVATE SOUNDOR_HERMES_REVISION="${SOUNDOR_HERMES_REVISION}")
  target_include_directories(${target}
    PUBLIC ${SoundorEngine_SOURCE_DIR}/include ${CMAKE_CURRENT_BINARY_DIR}/generated
    PRIVATE ${SoundorEngine_SOURCE_DIR}/src)
  # PRIVATE: Hermes is an implementation detail; its headers never reach consumers.
  target_link_libraries(${target} PRIVATE soundor_hermes soundor_ada soundor_yoga soundor_skia
                                           ${SOUNDOR_RUNTIME_SYSTEM_LIBRARIES})
  if(SOUNDOR_HAS_GPU)
    target_link_libraries(${target} PRIVATE soundor_angle)
    target_compile_definitions(${target} PRIVATE SOUNDOR_HAS_GPU=1)
  else()
    target_compile_definitions(${target} PRIVATE SOUNDOR_HAS_GPU=0)
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

soundor_configure_runtime(soundor_runtime)
