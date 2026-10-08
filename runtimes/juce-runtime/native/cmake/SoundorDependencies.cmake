# Pinned third-party dependencies of the Soundor native runtime.
#
# Every dependency is fetched by CMake at configure time from an exact upstream
# revision, verified by SHA-256, and built privately. Developers never install
# these by hand, and nothing here floats on a branch.
#
# To build offline, point FetchContent at a local checkout of the same revision:
#   -DFETCHCONTENT_SOURCE_DIR_SOUNDOR_QUICKJS=/path/to/quickjs
#
# | Dependency | Version | License | Used for                    |
# | ---------- | ------- | ------- | --------------------------- |
# | QuickJS-NG | v0.17.0 | MIT     | JavaScript engine (shipped) |
# | ada        | v3.4.4  | MIT/Apache-2.0 | WHATWG URL parser (shipped) |
# | Yoga       | v3.2.1  | MIT     | flexbox layout (shipped)    |
# | Skia       | m144    | BSD-3-Clause | 2D rendering (shipped; built from source, see SoundorSkia.cmake) |
# | accesskit-c | 0.23.1 | MIT/Apache-2.0 | Windows/Linux accessibility (shipped; official prebuilt, see SoundorAccessKit.cmake) |
# | ANGLE      | chromium/7922 (M151) | BSD-3-Clause | OpenGL ES 3 / WebGL 2 over Metal, D3D11, Vulkan (shipped; built from source, see SoundorAngle.cmake) |
# | doctest    | v2.5.3  | MIT     | native unit tests (tests)   |

include_guard(GLOBAL)

include(FetchContent)

set(SOUNDOR_QUICKJS_VERSION "0.17.0")
set(SOUNDOR_QUICKJS_REVISION "6d46d07d04041b40f4f49eaa7fdebe44c314c699")
set(SOUNDOR_QUICKJS_SHA256 "a62cf1ff7d6d2f82b90a2d247a57e9eb56b81c03feb1f372a53923426e358cb0")

# Release asset of tag v3.4.4 (commit 8d50724a7dea209a05234a445e28f97994b0a5f6).
set(SOUNDOR_ADA_VERSION "3.4.4")
set(SOUNDOR_ADA_SHA256 "cb0dc03516129e3bfc2c23b24bff039a01fc7ccec1a7585458c425cb57bf9fcb")

set(SOUNDOR_YOGA_VERSION "3.2.1")
set(SOUNDOR_YOGA_REVISION "042f5013152eb81c1552dec945b88f7b95ca350f")
set(SOUNDOR_YOGA_SHA256 "4742f41722a16f181e3da37abf943390db1e928f00f26402cb154662ae7f110f")

# Skia's chrome/m144 branch; its third-party code at the commits Skia's DEPS pins.
set(SOUNDOR_SKIA_VERSION "m144")
set(SOUNDOR_SKIA_REVISION "ed427fd003ba3bc6eb4a8ae0337f9cdafc39e5fb")
set(SOUNDOR_SKIA_REPOSITORY "https://skia.googlesource.com/skia")
set(SOUNDOR_SKIA_DEPENDENCIES "libjpeg-turbo;libpng;libwebp;zlib")

# The official release archive (prebuilt static libraries and accesskit.h) of
# tag 0.23.1, commit-pinned by its hash.
set(SOUNDOR_ACCESSKIT_VERSION "0.23.1")
set(SOUNDOR_ACCESSKIT_URL "https://github.com/AccessKit/accesskit-c/releases/download/0.23.1/accesskit-c-0.23.1.zip")
set(SOUNDOR_ACCESSKIT_SHA256 "35b7ca8a6f1e038b5da35e1e9e5a0adaed9bfcf21e1496d29598fbbadcc7043f")

# ANGLE's chromium/7922 branch (Chrome 151); its third-party code at the
# commits ANGLE's DEPS pins. Only what the static libraries need is fetched;
# `path=dirs` fetches just those directories of a repository.
set(SOUNDOR_ANGLE_VERSION "chromium/7922")
set(SOUNDOR_ANGLE_REVISION "7e08726e32026a0bbabd6ec8a1a90f5ab533ed66")
set(SOUNDOR_ANGLE_REPOSITORY "https://chromium.googlesource.com/angle/angle")
set(SOUNDOR_ANGLE_DEPENDENCIES
  build
  buildtools
  testing
  third_party/abseil-cpp
  third_party/zlib
  third_party/jsoncpp
  third_party/rapidjson/src
  third_party/astc-encoder/src
  third_party/vulkan-deps
  third_party/vulkan-headers/src
  third_party/vulkan-loader/src
  third_party/vulkan-utility-libraries/src
  third_party/vulkan_memory_allocator
  third_party/spirv-headers/src
  third_party/spirv-tools/src
  "third_party/rust=cxx/chromium_integration")
set(SOUNDOR_ANGLE_LINUX_DEPENDENCIES third_party/libdrm/src)
# gn, as ANGLE's DEPS pins it (CIPD package gn/gn/<platform>).
set(SOUNDOR_ANGLE_GN_VERSION "git_revision:e331ddb6e93389abfc75c611690bb82f5274029e")
set(SOUNDOR_ANGLE_GN_SHA256_linux_amd64 "ce231fa54cffb078feba7a71f584a40fc6a590ffd270b7146c4eed680962dece")
set(SOUNDOR_ANGLE_GN_SHA256_linux_arm64 "77c8309d4461bf14d1cbf7b122d0f086382ac0c3a3f16f931347190963ba3f5d")
set(SOUNDOR_ANGLE_GN_SHA256_mac_amd64 "97462b6898f395c30dd033818799f4e24876cf8a2cc8efbbf846ccb63046cfdd")
set(SOUNDOR_ANGLE_GN_SHA256_mac_arm64 "790504cc8153dc1ffdeca83aae6cecf39b509f9c0b36b16dca7d7386ab476193")
set(SOUNDOR_ANGLE_GN_SHA256_windows_amd64 "bcc61349a63d26d9179c81b84a039ea03af1b0b50101eea831cff55091b29008")

set(SOUNDOR_DOCTEST_VERSION "2.5.3")
set(SOUNDOR_DOCTEST_REVISION "2d0a9359a60c51affe2a9bebb1be1dca47868151")
set(SOUNDOR_DOCTEST_SHA256 "e64542c4ea68e9f381ccf6eae924cfdd652567c87c142d76fe92644fb4608149")

# Where Soundor keeps what it builds or downloads once per machine: the
# SOUNDOR_CACHE environment variable, or the user cache directory
# (~/.cache/soundor, ~/Library/Caches/Soundor, %LOCALAPPDATA%\Soundor\cache).
function(soundor_cache_root out)
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

# Populates a pinned GitHub archive without running its own CMakeLists.txt:
# Soundor defines the targets it needs itself, so upstream build options,
# executables and install rules never leak into the consuming project.
function(soundor_fetch_source name repository revision sha256)
  FetchContent_Declare(
    ${name}
    URL "https://github.com/${repository}/archive/${revision}.tar.gz"
    URL_HASH "SHA256=${sha256}"
    DOWNLOAD_EXTRACT_TIMESTAMP TRUE
    # A directory without a CMakeLists.txt: populate only, never add_subdirectory().
    SOURCE_SUBDIR "soundor-populate-only")
  FetchContent_MakeAvailable(${name})
  string(TOLOWER "${name}" lower)
  set(${name}_SOURCE_DIR "${${lower}_SOURCE_DIR}" PARENT_SCOPE)
endfunction()
