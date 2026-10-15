cmake_minimum_required(VERSION 3.22)
project(SoundorJuceIntegration VERSION 0.1.0 LANGUAGES C CXX)
find_program(SOUNDOR_NODE_EXE NAMES node REQUIRED)
execute_process(COMMAND "${SOUNDOR_NODE_EXE}" --input-type=module -e
  "import {createRequire} from 'node:module'; console.log(createRequire(process.argv[1]).resolve('@soundor/engine/package.json'))"
  "${CMAKE_CURRENT_SOURCE_DIR}/../package.json"
  OUTPUT_VARIABLE engine_package OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
get_filename_component(engine_dir "${engine_package}" DIRECTORY)
enable_testing()
add_subdirectory("${engine_dir}" engine)
if(SOUNDOR_JUCE_TESTS)
  if(NOT JUCE_DIR AND EXISTS "/opt/JUCE/CMakeLists.txt")
    set(JUCE_DIR /opt/JUCE)
  endif()
  if(NOT EXISTS "${JUCE_DIR}/CMakeLists.txt")
    message(FATAL_ERROR "JUCE adapter tests need an installed JUCE checkout")
  endif()
  add_subdirectory(backend/juce/tests)
endif()
