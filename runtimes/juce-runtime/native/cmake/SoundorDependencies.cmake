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
# | doctest    | v2.5.3  | MIT     | native unit tests (tests)   |

include_guard(GLOBAL)

include(FetchContent)

set(SOUNDOR_QUICKJS_VERSION "0.17.0")
set(SOUNDOR_QUICKJS_REVISION "6d46d07d04041b40f4f49eaa7fdebe44c314c699")
set(SOUNDOR_QUICKJS_SHA256 "a62cf1ff7d6d2f82b90a2d247a57e9eb56b81c03feb1f372a53923426e358cb0")

set(SOUNDOR_DOCTEST_VERSION "2.5.3")
set(SOUNDOR_DOCTEST_REVISION "2d0a9359a60c51affe2a9bebb1be1dca47868151")
set(SOUNDOR_DOCTEST_SHA256 "e64542c4ea68e9f381ccf6eae924cfdd652567c87c142d76fe92644fb4608149")

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
