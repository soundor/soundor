cmake_minimum_required(VERSION 3.24)
project(soundor_js_bench LANGUAGES C CXX)

# The QuickJS-NG sources and flags the plugin runtime used before Hermes,
# without Skia, ANGLE or JUCE. This executable only evaluates JavaScript.
include("${CMAKE_CURRENT_LIST_DIR}/QuickJS.cmake")
add_executable(soundor_bench_js QuickJs.cpp)
target_compile_features(soundor_bench_js PRIVATE cxx_std_20)
target_link_libraries(soundor_bench_js PRIVATE soundor_quickjs)
