# Steinberg's VST3 SDK, for the adapter.
#
# | Part           | Version        | License | Used for                                   |
# | -------------- | -------------- | ------- | ------------------------------------------ |
# | pluginterfaces | 3.8.1 build 84 | MIT     | the VST3 interfaces                        |
# | base           | 3.8.1 build 84 | MIT     | FObject, streams (the plugin base classes) |
# | public.sdk     | 3.8.1 build 84 | MIT     | plugin base classes, factory, entry points |
#
# The same pins as @soundor/vst3-host's (hosts/vst3-host/cmake/Vst3HostDependencies.cmake):
# each part fetched from its repository's v3.8.1_build_84 commit, verified by
# SHA-256, and kept in the user cache (SOUNDOR_CACHE, else ~/.cache/soundor),
# so a new build directory downloads nothing. VST3 SDK 3.8 is the first
# release under the MIT license; its notice ships with the adapter
# (licenses/vst3sdk/LICENSE.txt). Offline:
# -DFETCHCONTENT_SOURCE_DIR_SOUNDOR_VST3_<PART>=<checkout>.
#
# The SDK's sources are compiled into the adapter's own archive, with hidden
# visibility: nothing of it is exported from a plugin but its three entry
# points, so plugins built with other copies of it share a host safely.

include_guard(GLOBAL)
include(FetchContent)

set(SOUNDOR_VST3_SDK_VERSION "3.8.1")
set(SOUNDOR_VST3_PLUGINTERFACES_REVISION "4f547e8e102b47de4a8b8aaf343c73b700786372")
set(SOUNDOR_VST3_PLUGINTERFACES_SHA256 "ee70777eebb8450fc04fae2a6dd452f723d12bfb8222af443b8c1f8a9259089a")
set(SOUNDOR_VST3_PUBLIC_SDK_REVISION "586dc5e6c8012c3e4b01c79389375cbe96bdb1da")
set(SOUNDOR_VST3_PUBLIC_SDK_SHA256 "71319491b771068b8e2c5374c22830a339677e9d54c4cd33af4a0aa210e4c838")
set(SOUNDOR_VST3_BASE_REVISION "fcf9da0bd27a16f7f03773a3a39822f28f5c8477")
set(SOUNDOR_VST3_BASE_SHA256 "3753d45a79b5e324c2843d74a18c8f1117fe0b1118fa9312658aecf6360ec603")

if(DEFINED ENV{SOUNDOR_CACHE} AND NOT "$ENV{SOUNDOR_CACHE}" STREQUAL "")
  set(soundor_vst3_cache "$ENV{SOUNDOR_CACHE}")
elseif(DEFINED ENV{XDG_CACHE_HOME} AND NOT "$ENV{XDG_CACHE_HOME}" STREQUAL "")
  set(soundor_vst3_cache "$ENV{XDG_CACHE_HOME}/soundor")
else()
  set(soundor_vst3_cache "$ENV{HOME}/.cache/soundor")
endif()
file(TO_CMAKE_PATH "${soundor_vst3_cache}" soundor_vst3_cache)

# The parts side by side under one root, as the SDK's umbrella repository has
# them: its sources include "pluginterfaces/...", "base/..." and "public.sdk/...".
set(SOUNDOR_VST3_SDK_DIR "${CMAKE_BINARY_DIR}/_deps/vst3sdk")

function(soundor_vst3_sdk_part name repository directory revision sha256)
  FetchContent_Declare(
    ${name}
    URL "https://github.com/steinbergmedia/${repository}/archive/${revision}.tar.gz"
    URL_HASH "SHA256=${sha256}"
    DOWNLOAD_NAME "${repository}-${revision}.tar.gz"
    DOWNLOAD_DIR "${soundor_vst3_cache}/vst3-sdk/downloads"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    SOURCE_DIR "${SOUNDOR_VST3_SDK_DIR}/${directory}"
    # Populate only: the adapter compiles the files it uses itself.
    SOURCE_SUBDIR "soundor-populate-only")
  FetchContent_MakeAvailable(${name})
endfunction()

soundor_vst3_sdk_part(soundor_vst3_pluginterfaces vst3_pluginterfaces pluginterfaces
  ${SOUNDOR_VST3_PLUGINTERFACES_REVISION} ${SOUNDOR_VST3_PLUGINTERFACES_SHA256})
soundor_vst3_sdk_part(soundor_vst3_base vst3_base base
  ${SOUNDOR_VST3_BASE_REVISION} ${SOUNDOR_VST3_BASE_SHA256})
soundor_vst3_sdk_part(soundor_vst3_public_sdk vst3_public_sdk public.sdk
  ${SOUNDOR_VST3_PUBLIC_SDK_REVISION} ${SOUNDOR_VST3_PUBLIC_SDK_SHA256})

set(sdk "${SOUNDOR_VST3_SDK_DIR}")
# What a plugin made of the SDK's base classes compiles (as the SDK's own
# sdk and sdk_common targets, on Linux), the module entry points included.
set(SOUNDOR_VST3_SDK_SOURCES
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
  "${sdk}/public.sdk/source/main/linuxmain.cpp"
  "${sdk}/public.sdk/source/main/moduleinit.cpp"
  "${sdk}/public.sdk/source/vst/vstaudioeffect.cpp"
  "${sdk}/public.sdk/source/vst/vstbus.cpp"
  "${sdk}/public.sdk/source/vst/vstcomponent.cpp"
  "${sdk}/public.sdk/source/vst/vstcomponentbase.cpp"
  "${sdk}/public.sdk/source/vst/vsteditcontroller.cpp"
  "${sdk}/public.sdk/source/vst/vstinitiids.cpp"
  "${sdk}/public.sdk/source/vst/vstparameters.cpp")
set(SOUNDOR_VST3_SDK_LICENSE "${sdk}/pluginterfaces/LICENSE.txt")
