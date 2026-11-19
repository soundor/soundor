# The adapter's unit tests: its expressions, state and documents,
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

# Plugins in one process (Instances.cpp): a host of the SDK's hosting helpers,
# run by tests/plugin.test.ts on the built test plugin.
set(sdk "${SOUNDOR_VST3_SDK_DIR}")
add_executable(soundor_vst3_instances
  Instances.cpp
  "${sdk}/pluginterfaces/base/coreiids.cpp"
  "${sdk}/pluginterfaces/base/funknown.cpp"
  "${sdk}/pluginterfaces/base/ustring.cpp"
  "${sdk}/public.sdk/source/common/commoniids.cpp"
  "${sdk}/public.sdk/source/common/memorystream.cpp"
  "${sdk}/public.sdk/source/vst/hosting/hostclasses.cpp"
  "${sdk}/public.sdk/source/vst/hosting/parameterchanges.cpp"
  "${sdk}/public.sdk/source/vst/hosting/pluginterfacesupport.cpp"
  "${sdk}/public.sdk/source/common/commonstringconvert.cpp"
  "${sdk}/public.sdk/source/vst/utility/stringconvert.cpp"
  "${sdk}/public.sdk/source/vst/vstinitiids.cpp")
target_include_directories(soundor_vst3_instances SYSTEM PRIVATE "${sdk}")
target_compile_definitions(soundor_vst3_instances PRIVATE RELEASE=1)
target_link_libraries(soundor_vst3_instances PRIVATE ${CMAKE_DL_LIBS})
set_source_files_properties(Instances.cpp PROPERTIES COMPILE_OPTIONS "-Wno-old-style-cast")
get_target_property(instances_sources soundor_vst3_instances SOURCES)
list(FILTER instances_sources INCLUDE REGEX "vst3sdk")
set_source_files_properties(${instances_sources} PROPERTIES SKIP_LINTING ON COMPILE_OPTIONS "-w")
