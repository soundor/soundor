# A consumer project, like a generated plugin: it add_subdirectory()s the
# runtime and calls soundor_embed_directory() and soundor_embed_ui() (which
# compiles bytecode) from its own directory scope.
cmake_minimum_required(VERSION 3.22)
project(SoundorEmbedScopeCheck CXX)

set(SOUNDOR_BUILD_TESTS OFF)
add_subdirectory(${SOUNDOR_NATIVE_DIR} soundor-runtime)

add_library(embed_scope_check OBJECT check.cpp)
target_compile_features(embed_scope_check PRIVATE cxx_std_20)
target_link_libraries(embed_scope_check PRIVATE Soundor::Engine)
soundor_embed_directory(embed_scope_check consumerUi ${SOUNDOR_NATIVE_DIR}/tests/fixtures/ui)
soundor_embed_ui(embed_scope_check consumerCompiledUi ${SOUNDOR_NATIVE_DIR}/tests/fixtures/ui)
