# QuickJS-NG as a private, static, hidden-visibility target.
#
# Only the engine itself is compiled (quickjs.c + its regexp/unicode/dtoa
# helpers). quickjs-libc — the generic `std`/`os` modules, file and process
# access — and the qjs/qjsc executables are deliberately left out: they are not
# part of the Soundor runtime and must never become reachable from plugin
# JavaScript. The target is linked PRIVATE by soundor_runtime, so quickjs.h never
# reaches a consumer's include path.

include_guard(GLOBAL)

include(${CMAKE_CURRENT_LIST_DIR}/SoundorDependencies.cmake)

soundor_fetch_source(
  SOUNDOR_QUICKJS
  quickjs-ng/quickjs
  ${SOUNDOR_QUICKJS_REVISION}
  ${SOUNDOR_QUICKJS_SHA256})

add_library(soundor_quickjs STATIC
  ${SOUNDOR_QUICKJS_SOURCE_DIR}/dtoa.c
  ${SOUNDOR_QUICKJS_SOURCE_DIR}/libregexp.c
  ${SOUNDOR_QUICKJS_SOURCE_DIR}/libunicode.c
  ${SOUNDOR_QUICKJS_SOURCE_DIR}/quickjs.c)

set_target_properties(soundor_quickjs PROPERTIES
  C_STANDARD 11
  C_STANDARD_REQUIRED ON
  C_EXTENSIONS ON
  C_VISIBILITY_PRESET hidden
  POSITION_INDEPENDENT_CODE ON
  # Upstream code: Soundor's warning policy and clang-tidy do not apply.
  C_CLANG_TIDY "")

# SYSTEM keeps upstream header warnings out of Soundor's own -Wall builds.
target_include_directories(soundor_quickjs SYSTEM PUBLIC ${SOUNDOR_QUICKJS_SOURCE_DIR})

target_compile_definitions(soundor_quickjs PRIVATE _GNU_SOURCE QUICKJS_NG_BUILD)

if(MSVC)
  target_compile_definitions(soundor_quickjs PRIVATE WIN32_LEAN_AND_MEAN _WIN32_WINNT=0x0601)
  target_compile_options(soundor_quickjs PRIVATE /experimental:c11atomics /W0)
else()
  # Mirrors upstream's flags: QuickJS-NG is developed and tested with unsigned
  # chars on every platform.
  target_compile_options(soundor_quickjs PRIVATE -funsigned-char -w)
endif()

if(NOT WIN32)
  target_link_libraries(soundor_quickjs PRIVATE m)
endif()
find_package(Threads REQUIRED)
target_link_libraries(soundor_quickjs PRIVATE Threads::Threads ${CMAKE_DL_LIBS})
