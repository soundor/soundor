# The adapter's unit tests: its JSON, expressions, state and documents,
# without a plugin (the VST3 classes are tested through real plugins, in
# the VST3 host and pluginval: tests/plugin.ts).
# doctest, at the engine's pin (its SoundorDependencies.cmake, included once,
# in the engine's scope).
file(STRINGS "${engine_dir}/cmake/SoundorDependencies.cmake" doctest_pins REGEX "^set\\(SOUNDOR_DOCTEST_(REVISION|SHA256) ")
foreach(pin IN LISTS doctest_pins)
  string(REGEX REPLACE "^set\\((SOUNDOR_DOCTEST_[A-Z0-9]+) \"([0-9a-f]+)\"\\)$" "\\1;\\2" pair "${pin}")
  list(GET pair 0 name)
  list(GET pair 1 value)
  set(${name} "${value}")
endforeach()
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
target_compile_definitions(soundor_vst3_tests PRIVATE
  "SOUNDOR_VST3_EXPRESSION_CORPUS=\"${CMAKE_CURRENT_SOURCE_DIR}/generated/expression-corpus.json\""
  "SOUNDOR_VST3_TEST_DESCRIPTOR=\"${CMAKE_CURRENT_SOURCE_DIR}/generated/descriptor.json\"")
soundor_configure_target(soundor_vst3_tests)
add_test(NAME soundor_vst3_tests COMMAND soundor_vst3_tests)
