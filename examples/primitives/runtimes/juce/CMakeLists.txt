cmake_minimum_required(VERSION 3.22)

project(SoundorPrimitives)

# Soundor injects only the generated JUCE setup below (plugin identity and
# formats, parameters, the Soundor base classes). Everything else in this file
# is yours to edit.
include(${CMAKE_CURRENT_SOURCE_DIR}/../../.soundor/generated/runtimes/juce/setup.cmake)

target_sources(${PROJECT_NAME}
    PRIVATE
        PluginEditor.cpp
        PluginProcessor.cpp)
