# The VST3 SDK, the host's one third-party dependency.
#
# Its parts are fetched at configure time from exact upstream commits,
# verified by SHA-256, and compiled into private static targets (the SDK's own
# CMake project is not used). The archives are kept in the user cache
# (SOUNDOR_CACHE, else ~/.cache/soundor, ~/Library/Caches/Soundor or
# %LOCALAPPDATA%\Soundor\cache), so a new build directory does not download
# them again.
#
# | Dependency                   | Version         | License | Used for                          |
# | ---------------------------- | --------------- | ------- | --------------------------------- |
# | VST3 SDK pluginterfaces      | 3.8.1 build 84  | MIT     | VST3 interfaces (host, fixtures)  |
# | VST3 SDK public.sdk          | 3.8.1 build 84  | MIT     | hosting helpers (host), plugin base classes (fixtures) |
# | VST3 SDK base                | 3.8.1 build 84  | MIT     | plugin base classes (fixtures only) |
#
# The tag v3.8.1_build_84 of each repository: VST3 SDK 3.8 is the first
# release under the MIT license. Offline: -DFETCHCONTENT_SOURCE_DIR_SOUNDOR_VST3_<PART>=<checkout>.

include_guard(GLOBAL)
include(FetchContent)

set(SOUNDOR_VST3_SDK_VERSION "3.8.1")
set(SOUNDOR_VST3_PLUGINTERFACES_REVISION "4f547e8e102b47de4a8b8aaf343c73b700786372")
set(SOUNDOR_VST3_PLUGINTERFACES_SHA256 "ee70777eebb8450fc04fae2a6dd452f723d12bfb8222af443b8c1f8a9259089a")
set(SOUNDOR_VST3_PUBLIC_SDK_REVISION "586dc5e6c8012c3e4b01c79389375cbe96bdb1da")
set(SOUNDOR_VST3_PUBLIC_SDK_SHA256 "71319491b771068b8e2c5374c22830a339677e9d54c4cd33af4a0aa210e4c838")
set(SOUNDOR_VST3_BASE_REVISION "fcf9da0bd27a16f7f03773a3a39822f28f5c8477")
set(SOUNDOR_VST3_BASE_SHA256 "3753d45a79b5e324c2843d74a18c8f1117fe0b1118fa9312658aecf6360ec603")

function(soundor_vst3_host_cache_root out)
  if(DEFINED ENV{SOUNDOR_CACHE} AND NOT "$ENV{SOUNDOR_CACHE}" STREQUAL "")
    set(root "$ENV{SOUNDOR_CACHE}")
  elseif(WIN32)
    set(root "$ENV{LOCALAPPDATA}/Soundor/cache")
  elseif(APPLE)
    set(root "$ENV{HOME}/Library/Caches/Soundor")
  elseif(DEFINED ENV{XDG_CACHE_HOME} AND NOT "$ENV{XDG_CACHE_HOME}" STREQUAL "")
    set(root "$ENV{XDG_CACHE_HOME}/soundor")
  else()
    set(root "$ENV{HOME}/.cache/soundor")
  endif()
  file(TO_CMAKE_PATH "${root}" root)
  set(${out} "${root}" PARENT_SCOPE)
endfunction()

# The SDK's sources include each other as "pluginterfaces/...",
# "public.sdk/source/..." and "base/source/...": the parts are laid out
# side by side under one root, as the SDK's umbrella repository does.
set(SOUNDOR_VST3_SDK_DIR "${CMAKE_BINARY_DIR}/_deps/vst3sdk")
soundor_vst3_host_cache_root(soundor_cache)
set(soundor_downloads "${soundor_cache}/vst3-host/downloads")

function(soundor_vst3_sdk_part name repository directory revision sha256)
  FetchContent_Declare(
    ${name}
    URL "https://github.com/steinbergmedia/${repository}/archive/${revision}.tar.gz"
    URL_HASH "SHA256=${sha256}"
    DOWNLOAD_NAME "${repository}-${revision}.tar.gz"
    DOWNLOAD_DIR "${soundor_downloads}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    SOURCE_DIR "${SOUNDOR_VST3_SDK_DIR}/${directory}")
  FetchContent_GetProperties(${name})
  if(NOT ${name}_POPULATED)
    FetchContent_Populate(${name})
  endif()
endfunction()

soundor_vst3_sdk_part(soundor_vst3_pluginterfaces vst3_pluginterfaces pluginterfaces
  ${SOUNDOR_VST3_PLUGINTERFACES_REVISION} ${SOUNDOR_VST3_PLUGINTERFACES_SHA256})
soundor_vst3_sdk_part(soundor_vst3_public_sdk vst3_public_sdk public.sdk
  ${SOUNDOR_VST3_PUBLIC_SDK_REVISION} ${SOUNDOR_VST3_PUBLIC_SDK_SHA256})
if(SOUNDOR_VST3_HOST_BUILD_TESTS)
  soundor_vst3_sdk_part(soundor_vst3_base vst3_base base
    ${SOUNDOR_VST3_BASE_REVISION} ${SOUNDOR_VST3_BASE_SHA256})
endif()

# The notice every distributed host executable carries.
configure_file("${SOUNDOR_VST3_SDK_DIR}/pluginterfaces/LICENSE.txt"
  "${CMAKE_BINARY_DIR}/licenses/vst3sdk/LICENSE.txt" COPYONLY)
