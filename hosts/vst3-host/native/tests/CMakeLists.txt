# The self-test (framing, JSON, binary architectures) and the fixture plugins
# the Node integration tests load (tests/native). Built with
# SOUNDOR_VST3_HOST_BUILD_TESTS; never shipped.

add_executable(soundor_vst3_host_selftest
  selftest/SelfTest.cpp
  ../src/Bundle.cpp
  ../src/Ipc.cpp
  ../src/Json.cpp)
target_include_directories(soundor_vst3_host_selftest PRIVATE ../src)
target_link_libraries(soundor_vst3_host_selftest PRIVATE Threads::Threads)
soundor_vst3_host_warnings(soundor_vst3_host_selftest)
add_test(NAME soundor_vst3_host_selftest COMMAND soundor_vst3_host_selftest)

# ── SoundorHostFixtures.vst3 ─────────────────────────────────────────────────

set(sdk "${SOUNDOR_VST3_SDK_DIR}")
set(SOUNDOR_VST3_HOST_FIXTURES_DIR "${CMAKE_BINARY_DIR}/fixtures" CACHE INTERNAL "")
set(bundle "${SOUNDOR_VST3_HOST_FIXTURES_DIR}/SoundorHostFixtures.vst3")

add_library(soundor_vst3_sdk_plugin STATIC
  "${sdk}/pluginterfaces/base/conststringtable.cpp"
  "${sdk}/pluginterfaces/base/coreiids.cpp"
  "${sdk}/pluginterfaces/base/funknown.cpp"
  "${sdk}/pluginterfaces/base/ustring.cpp"
  "${sdk}/base/source/baseiids.cpp"
  "${sdk}/base/source/fbuffer.cpp"
  "${sdk}/base/source/fdebug.cpp"
  "${sdk}/base/source/fobject.cpp"
  "${sdk}/base/source/fstreamer.cpp"
  "${sdk}/base/source/fstring.cpp"
  "${sdk}/base/source/timer.cpp"
  "${sdk}/base/source/updatehandler.cpp"
  "${sdk}/base/thread/source/fcondition.cpp"
  "${sdk}/base/thread/source/flock.cpp"
  "${sdk}/public.sdk/source/common/commoniids.cpp"
  "${sdk}/public.sdk/source/common/commonstringconvert.cpp"
  "${sdk}/public.sdk/source/common/pluginview.cpp"
  "${sdk}/public.sdk/source/main/pluginfactory.cpp"
  "${sdk}/public.sdk/source/vst/vstaudioeffect.cpp"
  "${sdk}/public.sdk/source/vst/vstbus.cpp"
  "${sdk}/public.sdk/source/vst/vstcomponent.cpp"
  "${sdk}/public.sdk/source/vst/vstcomponentbase.cpp"
  "${sdk}/public.sdk/source/vst/vstinitiids.cpp"
  "${sdk}/public.sdk/source/vst/vstparameters.cpp"
  # Includes vsteditcontroller.cpp.
  "${sdk}/public.sdk/source/vst/vstsinglecomponenteffect.cpp")
target_include_directories(soundor_vst3_sdk_plugin SYSTEM PUBLIC "${sdk}")
target_compile_definitions(soundor_vst3_sdk_plugin PUBLIC $<IF:$<CONFIG:Debug>,DEVELOPMENT=1,RELEASE=1>)
target_link_libraries(soundor_vst3_sdk_plugin PUBLIC Threads::Threads)
if(WIN32)
  target_compile_definitions(soundor_vst3_sdk_plugin PUBLIC UNICODE _UNICODE NOMINMAX)
elseif(APPLE)
  target_link_libraries(soundor_vst3_sdk_plugin PUBLIC "-framework CoreFoundation" "-framework Foundation")
endif()
if(MSVC)
  target_compile_options(soundor_vst3_sdk_plugin PRIVATE /W0)
else()
  target_compile_options(soundor_vst3_sdk_plugin PRIVATE -w)
endif()

add_library(SoundorHostFixtures MODULE fixtures/Fixtures.cpp fixtures/FixtureSynth.cpp)
target_link_libraries(SoundorHostFixtures PRIVATE soundor_vst3_sdk_plugin)
if(WIN32)
  target_sources(SoundorHostFixtures PRIVATE fixtures/FixtureNativeWindows.cpp "${sdk}/public.sdk/source/main/dllmain.cpp")
  target_link_libraries(SoundorHostFixtures PRIVATE user32 gdi32)
  if(CMAKE_SYSTEM_PROCESSOR MATCHES "ARM64|arm64|aarch64")
    set(architecture arm64-win)
  else()
    set(architecture x86_64-win)
  endif()
  set_target_properties(SoundorHostFixtures PROPERTIES PREFIX "" SUFFIX ".vst3")
  soundor_vst3_host_output(SoundorHostFixtures LIBRARY "${bundle}/Contents/${architecture}")
  soundor_vst3_host_output(SoundorHostFixtures RUNTIME "${bundle}/Contents/${architecture}")
elseif(APPLE)
  target_sources(SoundorHostFixtures PRIVATE fixtures/FixtureNativeMac.mm "${sdk}/public.sdk/source/main/macmain.cpp")
  target_link_libraries(SoundorHostFixtures PRIVATE "-framework Cocoa" "-framework QuartzCore")
  set_target_properties(SoundorHostFixtures PROPERTIES
    BUNDLE TRUE
    BUNDLE_EXTENSION vst3
    MACOSX_BUNDLE_GUI_IDENTIFIER dev.soundor.vst3-host.fixtures
    MACOSX_BUNDLE_BUNDLE_NAME SoundorHostFixtures)
  soundor_vst3_host_output(SoundorHostFixtures LIBRARY "${SOUNDOR_VST3_HOST_FIXTURES_DIR}")
else()
  find_package(X11 REQUIRED)
  target_sources(SoundorHostFixtures PRIVATE fixtures/FixtureNativeX11.cpp "${sdk}/public.sdk/source/main/linuxmain.cpp")
  target_link_libraries(SoundorHostFixtures PRIVATE X11::X11)
  # Every symbol resolved at link time, except under sanitizers, whose
  # runtime the host executable provides.
  if(NOT SOUNDOR_VST3_HOST_SANITIZERS)
    target_link_options(SoundorHostFixtures PRIVATE -Wl,--no-undefined)
  endif()
  set_target_properties(SoundorHostFixtures PROPERTIES PREFIX "" SUFFIX ".so")
  soundor_vst3_host_output(SoundorHostFixtures LIBRARY "${bundle}/Contents/${CMAKE_SYSTEM_PROCESSOR}-linux")
endif()
soundor_vst3_host_warnings(SoundorHostFixtures)
# The SDK's module entry points are compiled into the bundle, but are not ours to lint.
get_target_property(fixture_sources SoundorHostFixtures SOURCES)
list(FILTER fixture_sources INCLUDE REGEX "public\\.sdk")
set_source_files_properties(${fixture_sources} PROPERTIES SKIP_LINTING ON COMPILE_OPTIONS "$<IF:$<CXX_COMPILER_ID:MSVC>,/W0,-w>")

if(UNIX AND NOT APPLE)
  add_executable(soundor_vst3_host_window_test window/X11Window.cpp)
  target_link_libraries(soundor_vst3_host_window_test PRIVATE X11::X11 X11::Xtst X11::Xext)
  soundor_vst3_host_output(soundor_vst3_host_window_test RUNTIME "${CMAKE_BINARY_DIR}/bin")
  soundor_vst3_host_warnings(soundor_vst3_host_window_test)
endif()
