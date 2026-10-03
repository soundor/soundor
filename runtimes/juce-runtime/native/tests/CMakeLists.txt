include(SoundorDependencies)

soundor_fetch_source(
  SOUNDOR_DOCTEST
  doctest/doctest
  ${SOUNDOR_DOCTEST_REVISION}
  ${SOUNDOR_DOCTEST_SHA256})

add_library(soundor_doctest INTERFACE)
target_include_directories(soundor_doctest SYSTEM INTERFACE ${SOUNDOR_DOCTEST_SOURCE_DIR})

add_executable(soundor_runtime_tests
  main.cpp
  js/ContextTests.cpp
  js/ErrorTests.cpp
  js/JobTests.cpp
  js/LifecycleTests.cpp
  js/ModuleTests.cpp
  js/RuntimeTests.cpp
  native/NativeModuleTests.cpp
  parameters/ParametersTests.cpp
  # Golden output of the soundor:native generator (see src/native-codegen.test.ts).
  generated/soundor/native/SoundorNative.cpp)
target_include_directories(soundor_runtime_tests PRIVATE ${PROJECT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/generated)
# Tests exercise internal seams (native modules), so they may see QuickJS.
target_link_libraries(soundor_runtime_tests PRIVATE soundor::runtime soundor_quickjs soundor_doctest)
soundor_configure_target(soundor_runtime_tests)

# Generated code is checked by its generator's tests, not linted.
set_source_files_properties(generated/soundor/native/SoundorNative.cpp PROPERTIES SKIP_LINTING ON)

add_test(NAME soundor_runtime_tests COMMAND soundor_runtime_tests)

# Symbol isolation: a plugin-shaped shared library that links the runtime must
# export only its own entry point — never QuickJS or Soundor internals.
# Sanitizer builds export their own instrumentation markers, so the check runs
# on regular builds only.
if(NOT WIN32 AND NOT SOUNDOR_ENABLE_SANITIZERS)
  add_library(soundor_symbol_probe MODULE symbols/Probe.cpp)
  target_link_libraries(soundor_symbol_probe PRIVATE soundor::runtime)
  soundor_configure_target(soundor_symbol_probe)

  find_program(SOUNDOR_NM_EXE NAMES nm llvm-nm REQUIRED)
  add_test(
    NAME soundor_exported_symbols
    COMMAND ${CMAKE_COMMAND}
      -DLIBRARY=$<TARGET_FILE:soundor_symbol_probe>
      -DNM=${SOUNDOR_NM_EXE}
      -DAPPLE=${APPLE}
      -DALLOWED=soundor_probe_entry
      -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckExportedSymbols.cmake)

  # Negative control: proves the check really fails on a leaked symbol.
  add_library(soundor_symbol_leak_probe MODULE symbols/LeakyProbe.cpp)
  add_test(
    NAME soundor_exported_symbols_detects_leaks
    COMMAND ${CMAKE_COMMAND}
      -DLIBRARY=$<TARGET_FILE:soundor_symbol_leak_probe>
      -DNM=${SOUNDOR_NM_EXE}
      -DAPPLE=${APPLE}
      -DALLOWED=soundor_probe_entry
      -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckExportedSymbols.cmake)
  set_tests_properties(soundor_exported_symbols_detects_leaks PROPERTIES
    PASS_REGULAR_EXPRESSION "Unexpected exported symbols(.|\n)*JS_LeakedEngineSymbol")
endif()
