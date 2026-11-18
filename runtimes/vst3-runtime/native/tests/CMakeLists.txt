# The adapter's unit tests: its JSON, expressions, state and documents,
# without a plugin (the VST3 classes are tested through real plugins, in
# the VST3 host and pluginval: tests/plugin.ts).
include("${engine_dir}/cmake/SoundorDependencies.cmake")
soundor_fetch_source(SOUNDOR_DOCTEST doctest/doctest ${SOUNDOR_DOCTEST_REVISION} ${SOUNDOR_DOCTEST_SHA256})

add_executable(soundor_vst3_tests
  AdapterTests.cpp
  ../src/Descriptor.cpp
  ../src/Expression.cpp
  ../src/Json.cpp
  ../src/Log.cpp
  ../src/State.cpp
  ../src/StateDocument.cpp
  TestPlugin.cpp)
target_include_directories(soundor_vst3_tests PRIVATE ../include ../src)
target_include_directories(soundor_vst3_tests SYSTEM PRIVATE "${SOUNDOR_DOCTEST_SOURCE_DIR}")
target_link_libraries(soundor_vst3_tests PRIVATE Soundor::Engine)
soundor_configure_target(soundor_vst3_tests)
add_test(NAME soundor_vst3_tests COMMAND soundor_vst3_tests)
