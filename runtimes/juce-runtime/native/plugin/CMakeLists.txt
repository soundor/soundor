cmake_minimum_required(VERSION 3.22)

project(${SOUNDOR_PLUGIN_TARGET} LANGUAGES C CXX)

# The CLI generates the contract in the project and keeps the host in this package.
if(NOT EXISTS "${SOUNDOR_GENERATED_DIR}/setup.cmake")
  message(FATAL_ERROR "Missing generated JUCE contract. Build with soundor dev or soundor build.")
endif()
include("${SOUNDOR_GENERATED_DIR}/setup.cmake")
target_sources(${PROJECT_NAME} PRIVATE Plugin.cpp)
