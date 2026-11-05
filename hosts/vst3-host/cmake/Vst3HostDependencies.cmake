# The host's third-party dependencies.
#
# Each is fetched at configure time from an exact upstream commit or release,
# verified by SHA-256, and compiled into a private static target. The archives
# are kept in the user cache (SOUNDOR_CACHE, else ~/.cache/soundor,
# ~/Library/Caches/Soundor or %LOCALAPPDATA%\Soundor\cache), so a new build
# directory does not download them again.
#
# | Dependency                   | Version         | License  | Used for                          |
# | ---------------------------- | --------------- | -------- | --------------------------------- |
# | VST3 SDK pluginterfaces      | 3.8.1 build 84  | MIT      | VST3 interfaces (host, fixtures)  |
# | VST3 SDK public.sdk          | 3.8.1 build 84  | MIT      | hosting helpers (host), plugin base classes (fixtures) |
# | VST3 SDK base                | 3.8.1 build 84  | MIT      | plugin base classes (fixtures only) |
# | SDL                          | 3.4.18          | zlib     | the host window, live audio, file dialogs |
# | Dear ImGui                   | 1.92.9b         | MIT      | the host interface                |
# | Inter                        | 4.1             | OFL-1.1  | the host interface's font         |
#
# SDL is the one built by its own CMake project (as a static library, with only
# the subsystems the host uses): its platform configuration is not worth
# reproducing. ImGui and Inter are compiled and embedded by the host's CMake.
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

# ── The host interface: SDL, Dear ImGui, Inter ──────────────────────────────

set(SOUNDOR_SDL_VERSION "3.4.18")
set(SOUNDOR_SDL_SHA256 "9c75cf16330322c217dedd2e0609f1124f1b54b8633e763467b4684d0f4334a3")
set(SOUNDOR_IMGUI_VERSION "1.92.9b")
set(SOUNDOR_IMGUI_SHA256 "21d8a0a565e85dce943e375db00812c2f3f0ab21f3f0f7964e364a63422d7f99")
set(SOUNDOR_INTER_VERSION "4.1")
set(SOUNDOR_INTER_SHA256 "9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e")

function(soundor_vst3_host_archive name url sha256 download_name out)
  FetchContent_Declare(
    ${name}
    URL "${url}"
    URL_HASH "SHA256=${sha256}"
    DOWNLOAD_NAME "${download_name}"
    DOWNLOAD_DIR "${soundor_downloads}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE)
  FetchContent_GetProperties(${name})
  if(NOT ${name}_POPULATED)
    FetchContent_Populate(${name})
  endif()
  set(${out} "${${name}_SOURCE_DIR}" PARENT_SCOPE)
endfunction()

soundor_vst3_host_archive(soundor_sdl
  "https://github.com/libsdl-org/SDL/releases/download/release-${SOUNDOR_SDL_VERSION}/SDL3-${SOUNDOR_SDL_VERSION}.tar.gz"
  ${SOUNDOR_SDL_SHA256} "SDL3-${SOUNDOR_SDL_VERSION}.tar.gz" SOUNDOR_SDL_DIR)
soundor_vst3_host_archive(soundor_imgui
  "https://github.com/ocornut/imgui/archive/refs/tags/v${SOUNDOR_IMGUI_VERSION}.tar.gz"
  ${SOUNDOR_IMGUI_SHA256} "imgui-${SOUNDOR_IMGUI_VERSION}.tar.gz" SOUNDOR_IMGUI_DIR)
soundor_vst3_host_archive(soundor_inter
  "https://github.com/rsms/inter/releases/download/v${SOUNDOR_INTER_VERSION}/Inter-${SOUNDOR_INTER_VERSION}.zip"
  ${SOUNDOR_INTER_SHA256} "Inter-${SOUNDOR_INTER_VERSION}.zip" SOUNDOR_INTER_DIR)

# SDL: a static library with the subsystems the host interface uses (video,
# rendering, events, audio, dialogs). On Linux, X11 only (VST3 editors are
# X11 windows), and every system library is loaded at run time, so headless
# mode needs none of them.
function(soundor_vst3_host_sdl)
  set(BUILD_SHARED_LIBS OFF)
  set(CMAKE_C_CLANG_TIDY "")
  set(CMAKE_CXX_CLANG_TIDY "")
  foreach(option IN ITEMS SDL_STATIC SDL_AUDIO SDL_VIDEO SDL_RENDER SDL_DEPS_SHARED SDL_DISABLE_INSTALL
                          SDL_X11_XSYNC)
    set(${option} ON CACHE BOOL "" FORCE)
  endforeach()
  foreach(option IN ITEMS SDL_SHARED SDL_TEST_LIBRARY SDL_TESTS SDL_EXAMPLES SDL_INSTALL SDL_GPU SDL_CAMERA
                          SDL_HAPTIC SDL_HIDAPI SDL_POWER SDL_SENSOR SDL_TRAY SDL_VULKAN SDL_RENDER_VULKAN
                          SDL_RENDER_GPU SDL_WAYLAND SDL_KMSDRM SDL_OFFSCREEN SDL_DUMMYCAMERA SDL_LIBUDEV
                          SDL_IBUS SDL_JACK SDL_SNDIO SDL_OSS SDL_DISKAUDIO SDL_OPENVR SDL_RPI SDL_ROCKCHIP
                          SDL_VIVANTE SDL_LIBURING SDL_FRIBIDI SDL_LIBTHAI SDL_CLANG_TIDY SDL_RPATH
                          SDL_X11_XSCRNSAVER SDL_X11_XSHAPE SDL_X11_XDBE SDL_X11_XTEST)
    set(${option} OFF CACHE BOOL "" FORCE)
  endforeach()
  add_subdirectory("${SOUNDOR_SDL_DIR}" "${CMAKE_BINARY_DIR}/_deps/sdl-build" EXCLUDE_FROM_ALL SYSTEM)
endfunction()
soundor_vst3_host_sdl()

add_library(soundor_imgui STATIC
  "${SOUNDOR_IMGUI_DIR}/imgui.cpp"
  "${SOUNDOR_IMGUI_DIR}/imgui_draw.cpp"
  "${SOUNDOR_IMGUI_DIR}/imgui_tables.cpp"
  "${SOUNDOR_IMGUI_DIR}/imgui_widgets.cpp"
  "${SOUNDOR_IMGUI_DIR}/backends/imgui_impl_sdl3.cpp"
  "${SOUNDOR_IMGUI_DIR}/backends/imgui_impl_sdlrenderer3.cpp")
target_include_directories(soundor_imgui SYSTEM PUBLIC "${SOUNDOR_IMGUI_DIR}" "${SOUNDOR_IMGUI_DIR}/backends")
# No demo window, no default font file, no shell or clipboard helpers the
# host does not use.
target_compile_definitions(soundor_imgui PUBLIC IMGUI_DISABLE_DEMO_WINDOWS IMGUI_DISABLE_DEBUG_TOOLS
                                                IMGUI_DISABLE_OBSOLETE_FUNCTIONS)
target_link_libraries(soundor_imgui PUBLIC SDL3::SDL3-static)
if(MSVC)
  target_compile_options(soundor_imgui PRIVATE /W0)
else()
  target_compile_options(soundor_imgui PRIVATE -w)
endif()

# Inter's regular and semibold faces, embedded as byte arrays by a small
# build-time tool (CMake's string functions are too slow for fonts).
add_executable(soundor_vst3_host_embed "${CMAKE_CURRENT_LIST_DIR}/../native/tools/Embed.cpp")
set(SOUNDOR_VST3_HOST_FONTS_SOURCE "${CMAKE_BINARY_DIR}/generated/HostFonts.cpp")
add_custom_command(
  OUTPUT "${SOUNDOR_VST3_HOST_FONTS_SOURCE}"
  COMMAND soundor_vst3_host_embed "${SOUNDOR_VST3_HOST_FONTS_SOURCE}" soundor::vst3host::fonts
          regular "${SOUNDOR_INTER_DIR}/extras/ttf/Inter-Regular.ttf"
          semibold "${SOUNDOR_INTER_DIR}/extras/ttf/Inter-SemiBold.ttf"
  DEPENDS soundor_vst3_host_embed
          "${SOUNDOR_INTER_DIR}/extras/ttf/Inter-Regular.ttf"
          "${SOUNDOR_INTER_DIR}/extras/ttf/Inter-SemiBold.ttf"
  COMMENT "Embedding the host interface's fonts"
  VERBATIM)

configure_file("${SOUNDOR_SDL_DIR}/LICENSE.txt" "${CMAKE_BINARY_DIR}/licenses/sdl/LICENSE.txt" COPYONLY)
configure_file("${SOUNDOR_IMGUI_DIR}/LICENSE.txt" "${CMAKE_BINARY_DIR}/licenses/imgui/LICENSE.txt" COPYONLY)
configure_file("${SOUNDOR_INTER_DIR}/LICENSE.txt" "${CMAKE_BINARY_DIR}/licenses/inter/LICENSE.txt" COPYONLY)
