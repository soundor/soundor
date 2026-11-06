# soundor-vst3-host: the native executable of @soundor/vst3-host.
#
#   cmake --workflow --preset dev        Debug, tests, -Werror      → build/dev
#   cmake --workflow --preset release    the shipped configuration  → build/release
#
# The version comes from package.json and the protocol from protocol.json,
# so the executable and the Node client agree on both. Nothing here depends
# on JUCE, the Soundor engine or any other workspace package.
cmake_minimum_required(VERSION 3.25)

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/package.json" soundor_package)
string(JSON SOUNDOR_VST3_HOST_VERSION GET "${soundor_package}" version)
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/protocol.json" soundor_protocol)
string(JSON SOUNDOR_VST3_HOST_PROTOCOL GET "${soundor_protocol}" version)
string(JSON SOUNDOR_VST3_HOST_MAX_HEADER GET "${soundor_protocol}" maxHeaderBytes)
string(JSON SOUNDOR_VST3_HOST_MAX_PAYLOAD GET "${soundor_protocol}" defaultMaxPayloadBytes)
string(REGEX MATCH "^[0-9]+\\.[0-9]+\\.[0-9]+" soundor_numeric_version "${SOUNDOR_VST3_HOST_VERSION}")

# The oldest macOS the host runs on, in any build. CMake wants it before project().
if(APPLE AND NOT DEFINED CMAKE_OSX_DEPLOYMENT_TARGET AND NOT DEFINED ENV{MACOSX_DEPLOYMENT_TARGET})
  set(CMAKE_OSX_DEPLOYMENT_TARGET 12.0 CACHE STRING "The oldest macOS the host runs on")
endif()

project(SoundorVst3Host VERSION ${soundor_numeric_version} LANGUAGES C CXX)
if(APPLE)
  enable_language(OBJCXX)
endif()

option(SOUNDOR_VST3_HOST_BUILD_TESTS "Build the self-test and the fixture plugins" OFF)
option(SOUNDOR_VST3_HOST_WARNINGS_AS_ERRORS "Treat warnings in the host's own sources as errors" OFF)
option(SOUNDOR_VST3_HOST_STATIC_RUNTIME "Link the C++ runtime statically on Linux, for what is published" OFF)
option(SOUNDOR_VST3_HOST_SANITIZERS "Build with AddressSanitizer and UndefinedBehaviorSanitizer" OFF)
option(SOUNDOR_VST3_HOST_CLANG_TIDY "Check the host's own sources with clang-tidy" OFF)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_OBJCXX_STANDARD 20)
set(CMAKE_CXX_VISIBILITY_PRESET hidden)
set(CMAKE_OBJCXX_VISIBILITY_PRESET hidden)
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
# A self-contained executable: no Visual C++ redistributable needed.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)

find_package(Threads REQUIRED)
include(cmake/Vst3HostDependencies.cmake)

if(SOUNDOR_VST3_HOST_SANITIZERS AND NOT MSVC)
  add_compile_options(-fsanitize=address,undefined -fno-omit-frame-pointer -fno-sanitize-recover=undefined)
  add_link_options(-fsanitize=address,undefined)
endif()

# ── The SDK's hosting helpers ───────────────────────────────────────────────

set(sdk "${SOUNDOR_VST3_SDK_DIR}")
add_library(soundor_vst3_sdk_hosting STATIC
  "${sdk}/pluginterfaces/base/conststringtable.cpp"
  "${sdk}/pluginterfaces/base/coreiids.cpp"
  "${sdk}/pluginterfaces/base/funknown.cpp"
  "${sdk}/pluginterfaces/base/ustring.cpp"
  "${sdk}/public.sdk/source/common/commoniids.cpp"
  "${sdk}/public.sdk/source/common/commonstringconvert.cpp"
  "${sdk}/public.sdk/source/common/memorystream.cpp"
  "${sdk}/public.sdk/source/vst/hosting/connectionproxy.cpp"
  "${sdk}/public.sdk/source/vst/hosting/eventlist.cpp"
  "${sdk}/public.sdk/source/vst/hosting/hostclasses.cpp"
  "${sdk}/public.sdk/source/vst/hosting/module.cpp"
  "${sdk}/public.sdk/source/vst/hosting/parameterchanges.cpp"
  "${sdk}/public.sdk/source/vst/hosting/pluginterfacesupport.cpp"
  "${sdk}/public.sdk/source/vst/utility/stringconvert.cpp"
  "${sdk}/public.sdk/source/vst/vstinitiids.cpp")
if(WIN32)
  target_sources(soundor_vst3_sdk_hosting PRIVATE
    "${sdk}/public.sdk/source/vst/hosting/module_win32.cpp"
    "${sdk}/public.sdk/source/common/threadchecker_win32.cpp")
  target_link_libraries(soundor_vst3_sdk_hosting PUBLIC ole32 shell32)
  # Written for C++17, where u8string() returns std::string.
  set_source_files_properties("${sdk}/public.sdk/source/vst/hosting/module_win32.cpp"
    PROPERTIES COMPILE_OPTIONS "$<$<CXX_COMPILER_ID:MSVC>:/Zc:char8_t->")
  target_compile_definitions(soundor_vst3_sdk_hosting PUBLIC UNICODE _UNICODE NOMINMAX)
elseif(APPLE)
  target_sources(soundor_vst3_sdk_hosting PRIVATE
    "${sdk}/public.sdk/source/vst/hosting/module_mac.mm"
    "${sdk}/public.sdk/source/common/threadchecker_mac.mm")
  target_link_libraries(soundor_vst3_sdk_hosting PUBLIC "-framework CoreFoundation" "-framework Foundation")
  # The SDK's Objective-C++ needs ARC; the host's own (EditorWindowMac.mm,
  # EventLoopMac.mm) manages references itself.
  set_source_files_properties("${sdk}/public.sdk/source/vst/hosting/module_mac.mm"
    PROPERTIES COMPILE_OPTIONS -fobjc-arc)
else()
  target_sources(soundor_vst3_sdk_hosting PRIVATE
    "${sdk}/public.sdk/source/vst/hosting/module_linux.cpp"
    "${sdk}/public.sdk/source/common/threadchecker_linux.cpp")
  target_link_libraries(soundor_vst3_sdk_hosting PUBLIC ${CMAKE_DL_LIBS})
endif()
target_include_directories(soundor_vst3_sdk_hosting SYSTEM PUBLIC "${sdk}")
target_compile_definitions(soundor_vst3_sdk_hosting PUBLIC $<IF:$<CONFIG:Debug>,DEVELOPMENT=1,RELEASE=1>)
target_link_libraries(soundor_vst3_sdk_hosting PUBLIC Threads::Threads)
# Upstream code: its warnings are not ours to fix.
if(MSVC)
  target_compile_options(soundor_vst3_sdk_hosting PRIVATE /W0)
else()
  target_compile_options(soundor_vst3_sdk_hosting PRIVATE -w)
endif()

# ── Warnings for the host's own sources ─────────────────────────────────────

function(soundor_vst3_host_warnings target)
  if(MSVC)
    # Warnings are errors with Clang and GCC (the dev, release and tidy
    # presets); MSVC's /W4 reports, but does not fail, the build.
    target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8)
  else()
    target_compile_options(${target} PRIVATE -Wall -Wextra -Wno-unused-parameter)
    if(SOUNDOR_VST3_HOST_WARNINGS_AS_ERRORS)
      target_compile_options(${target} PRIVATE -Werror)
    endif()
  endif()
  if(SOUNDOR_VST3_HOST_CLANG_TIDY)
    find_program(SOUNDOR_CLANG_TIDY_EXE NAMES clang-tidy-18 clang-tidy REQUIRED)
    set_target_properties(${target} PROPERTIES
      CXX_CLANG_TIDY "${SOUNDOR_CLANG_TIDY_EXE};--warnings-as-errors=*")
  endif()
endfunction()

# Every configuration's outputs in one place (Visual Studio adds a
# per-configuration directory otherwise).
function(soundor_vst3_host_output target kind directory)
  set_target_properties(${target} PROPERTIES ${kind}_OUTPUT_DIRECTORY "${directory}")
  foreach(config IN ITEMS Debug Release RelWithDebInfo MinSizeRel)
    string(TOUPPER ${config} upper)
    set_target_properties(${target} PROPERTIES ${kind}_OUTPUT_DIRECTORY_${upper} "${directory}")
  endforeach()
endfunction()

# ── The executable ──────────────────────────────────────────────────────────

configure_file(native/src/Version.h.in "${CMAKE_BINARY_DIR}/generated/Version.h" @ONLY)

add_executable(soundor-vst3-host
  native/src/Bundle.cpp
  native/src/HostContext.cpp
  native/src/HostInterface.cpp
  native/src/HostWindow.cpp
  native/src/Ipc.cpp
  native/src/Json.cpp
  native/src/LiveAudio.cpp
  native/src/Main.cpp
  native/src/Plugin.cpp
  native/src/Session.cpp
  native/src/Settings.cpp
  "${SOUNDOR_VST3_HOST_FONTS_SOURCE}")
if(WIN32)
  target_sources(soundor-vst3-host PRIVATE native/src/EventLoopWindows.cpp native/src/EditorWindowWindows.cpp
                                           native/src/EditorAreaWindows.cpp)
  target_link_libraries(soundor-vst3-host PRIVATE user32 gdi32)
elseif(APPLE)
  target_sources(soundor-vst3-host PRIVATE native/src/EventLoopMac.mm native/src/EditorWindowMac.mm
                                           native/src/EditorAreaMac.mm)
  target_link_libraries(soundor-vst3-host PRIVATE "-framework Cocoa")
else()
  # Xlib's headers only: the library is loaded in UI mode (X11Library.cpp).
  find_path(SOUNDOR_X11_INCLUDE_DIR X11/Xlib.h REQUIRED)
  target_include_directories(soundor-vst3-host SYSTEM PRIVATE "${SOUNDOR_X11_INCLUDE_DIR}")
  target_sources(soundor-vst3-host PRIVATE native/src/EventLoopLinux.cpp native/src/EditorAreaX11.cpp
                                           native/src/X11Library.cpp)
  # The C++ runtime inside what is published: it runs on distributions with an
  # older libstdc++ than the build machine's. Not by default, as a local build
  # runs where it was built, and not every distribution installs the static
  # library with its compiler (Fedora has it in libstdc++-static).
  if(SOUNDOR_VST3_HOST_STATIC_RUNTIME)
    target_link_options(soundor-vst3-host PRIVATE -static-libstdc++ -static-libgcc)
  endif()
endif()
target_include_directories(soundor-vst3-host PRIVATE native/src "${CMAKE_BINARY_DIR}/generated")
target_link_libraries(soundor-vst3-host PRIVATE soundor_vst3_sdk_hosting soundor_imgui SDL3::SDL3-static)
# A large generated array: nothing to lint.
set_source_files_properties("${SOUNDOR_VST3_HOST_FONTS_SOURCE}" PROPERTIES SKIP_LINTING ON)
soundor_vst3_host_warnings(soundor-vst3-host)
soundor_vst3_host_output(soundor-vst3-host RUNTIME "${CMAKE_BINARY_DIR}/bin")

if(SOUNDOR_VST3_HOST_BUILD_TESTS)
  enable_testing()
  add_subdirectory(native/tests)
endif()
