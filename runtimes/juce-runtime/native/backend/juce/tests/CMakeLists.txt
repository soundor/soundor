# Integration tests for the JUCE adapters against a real JUCE checkout. JUCE is
# never downloaded (its license requires explicit acceptance), so these build
# only when SOUNDOR_JUCE_TESTS is ON and JUCE_DIR points at a checkout.

add_subdirectory(${JUCE_DIR} JUCE EXCLUDE_FROM_ALL)

juce_add_console_app(soundor_juce_tests)
target_sources(soundor_juce_tests
  PRIVATE
    JuceParameterHostTests.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../soundor/backend/JuceParameterHost.cpp)

juce_add_console_app(soundor_juce_platform_tests)
target_sources(soundor_juce_platform_tests
  PRIVATE
    JuceInputTests.cpp
    JucePlatformTests.cpp
    JucePresentationTests.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../soundor/backend/JuceHttpClient.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../soundor/backend/JuceInput.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../soundor/backend/JucePresentation.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../soundor/backend/JuceTransport.cpp)
target_include_directories(soundor_juce_platform_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/..)
target_compile_definitions(soundor_juce_platform_tests PRIVATE JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0)
target_link_libraries(soundor_juce_platform_tests
  PRIVATE
    soundor::runtime
    soundor_doctest
    juce::juce_audio_processors
    juce::juce_recommended_config_flags)
add_test(NAME soundor_juce_platform_tests COMMAND soundor_juce_platform_tests)
target_include_directories(soundor_juce_tests PRIVATE ${CMAKE_CURRENT_SOURCE_DIR}/..)
target_compile_definitions(soundor_juce_tests PRIVATE JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0)
target_link_libraries(soundor_juce_tests
  PRIVATE
    soundor::runtime
    soundor_doctest
    juce::juce_audio_processors
    juce::juce_recommended_config_flags)

add_test(NAME soundor_juce_tests COMMAND soundor_juce_tests)

# Two real Soundor plugins in one host process (see PluginCoexistence.cpp).
# Runs when SOUNDOR_COEXISTENCE_PLUGINS names two built .vst3 bundles.
juce_add_console_app(soundor_juce_coexistence)
target_sources(soundor_juce_coexistence PRIVATE PluginCoexistence.cpp)
target_compile_definitions(soundor_juce_coexistence
  PRIVATE JUCE_PLUGINHOST_VST3=1 JUCE_MODAL_LOOPS_PERMITTED=1 JUCE_USE_CURL=0 JUCE_WEB_BROWSER=0)
target_link_libraries(soundor_juce_coexistence
  PRIVATE
    juce::juce_audio_processors
    juce::juce_recommended_config_flags)
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
  find_package(X11 REQUIRED)
  target_link_libraries(soundor_juce_coexistence PRIVATE X11::X11)
endif()
if(SOUNDOR_COEXISTENCE_PLUGINS)
  add_test(NAME soundor_juce_coexistence COMMAND soundor_juce_coexistence ${SOUNDOR_COEXISTENCE_PLUGINS})
endif()
