# Yoga (flexbox layout) as a private, static, hidden-visibility target.
#
# Only the layout engine (yoga/) is compiled. Its C API is patched to hidden
# visibility (see SoundorYogaPatch.cmake) so no YG* symbol leaves a plugin.

include_guard(GLOBAL)

include(${CMAKE_CURRENT_LIST_DIR}/SoundorDependencies.cmake)

FetchContent_Declare(
  SOUNDOR_YOGA
  URL "https://github.com/facebook/yoga/archive/${SOUNDOR_YOGA_REVISION}.tar.gz"
  URL_HASH "SHA256=${SOUNDOR_YOGA_SHA256}"
  DOWNLOAD_EXTRACT_TIMESTAMP TRUE
  PATCH_COMMAND ${CMAKE_COMMAND} -DFILE=<SOURCE_DIR>/yoga/YGMacros.h -P
                ${CMAKE_CURRENT_LIST_DIR}/SoundorYogaPatch.cmake
  SOURCE_SUBDIR "soundor-populate-only")
FetchContent_MakeAvailable(SOUNDOR_YOGA)

file(GLOB_RECURSE soundor_yoga_sources CONFIGURE_DEPENDS ${soundor_yoga_SOURCE_DIR}/yoga/*.cpp)
add_library(soundor_yoga STATIC ${soundor_yoga_sources})
target_compile_features(soundor_yoga PUBLIC cxx_std_20)
target_include_directories(soundor_yoga SYSTEM PUBLIC ${soundor_yoga_SOURCE_DIR})
set_target_properties(soundor_yoga PROPERTIES
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN ON
  POSITION_INDEPENDENT_CODE ON
  CXX_CLANG_TIDY "")
if(MSVC)
  target_compile_options(soundor_yoga PRIVATE /W0 /utf-8)
else()
  target_compile_options(soundor_yoga PRIVATE -w)
endif()
