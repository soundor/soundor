# ada (WHATWG URL parser, as used by Node.js) as a private, static,
# hidden-visibility target, built from its single-header release.

include_guard(GLOBAL)

include(${CMAKE_CURRENT_LIST_DIR}/SoundorDependencies.cmake)

FetchContent_Declare(
  SOUNDOR_ADA
  URL "https://github.com/ada-url/ada/releases/download/v${SOUNDOR_ADA_VERSION}/singleheader.zip"
  URL_HASH "SHA256=${SOUNDOR_ADA_SHA256}"
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  SOURCE_SUBDIR "soundor-populate-only")
FetchContent_MakeAvailable(SOUNDOR_ADA)

add_library(soundor_ada STATIC ${soundor_ada_SOURCE_DIR}/ada.cpp)
target_compile_features(soundor_ada PUBLIC cxx_std_20)
target_include_directories(soundor_ada SYSTEM PUBLIC ${soundor_ada_SOURCE_DIR})
set_target_properties(soundor_ada PROPERTIES
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN ON
  POSITION_INDEPENDENT_CODE ON
  CXX_CLANG_TIDY "")
if(MSVC)
  target_compile_options(soundor_ada PRIVATE /W0 /utf-8)
else()
  target_compile_options(soundor_ada PRIVATE -w)
endif()
