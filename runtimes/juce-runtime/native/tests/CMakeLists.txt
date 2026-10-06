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
  a11y/SemanticsTests.cpp
  js/ContextTests.cpp
  js/ErrorTests.cpp
  js/JobTests.cpp
  js/LifecycleTests.cpp
  js/ModuleTests.cpp
  js/RuntimeTests.cpp
  native/NativeModuleTests.cpp
  parameters/ParametersTests.cpp
  runtime/DevSessionTests.cpp
  runtime/ResourcesTests.cpp
  ui/SurfaceTests.cpp
  ui/PrimitivesTests.cpp
  ui/RendererTests.cpp
  ui/UiModuleTests.cpp
  web/FetchTests.cpp
  web/GlobalsTests.cpp
  web/PlatformModulesTests.cpp
  web/UrlTests.cpp
  web/WebApiTests.cpp
  # Golden output of the soundor:native generator (see src/native-codegen.test.ts).
  generated/soundor/native/SoundorNative.cpp)
target_include_directories(soundor_runtime_tests PRIVATE ${PROJECT_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/generated)
# Tests exercise internal seams (native modules), so they may see QuickJS.
target_link_libraries(soundor_runtime_tests PRIVATE soundor::runtime soundor_quickjs soundor_doctest)
soundor_configure_target(soundor_runtime_tests)

# Generated code is checked by its generator's tests, not linted.
set_source_files_properties(generated/soundor/native/SoundorNative.cpp PROPERTIES SKIP_LINTING ON)

soundor_embed_directory(soundor_runtime_tests fixtureUi ${CMAKE_CURRENT_SOURCE_DIR}/fixtures/ui)
target_compile_definitions(soundor_runtime_tests PRIVATE SOUNDOR_TEST_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/fixtures")

add_test(NAME soundor_runtime_tests COMMAND soundor_runtime_tests)

# soundor_embed_directory() called from another project's scope (as setup.cmake
# does) must still find its script.
add_test(
  NAME soundor_embed_from_consumer_scope
  COMMAND ${CMAKE_COMMAND} -E env --unset=CMAKE_GENERATOR
          ${CMAKE_CTEST_COMMAND}
          --build-and-test ${CMAKE_CURRENT_SOURCE_DIR}/embed-scope ${CMAKE_CURRENT_BINARY_DIR}/embed-scope
          --build-generator ${CMAKE_GENERATOR}
          --build-target embed_scope_check
          --build-options -DSOUNDOR_NATIVE_DIR=${PROJECT_SOURCE_DIR}
                          -DFETCHCONTENT_BASE_DIR=${FETCHCONTENT_BASE_DIR}
                          -DCMAKE_BUILD_TYPE=Debug)

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

  if(APPLE)
    # Negative control for the Objective-C class check.
    enable_language(OBJCXX)
    add_library(soundor_objc_class_probe MODULE symbols/ObjcClassProbe.mm)
    target_link_libraries(soundor_objc_class_probe PRIVATE "-framework Foundation")
    add_test(
      NAME soundor_exported_symbols_detects_objc_classes
      COMMAND ${CMAKE_COMMAND}
        -DLIBRARY=$<TARGET_FILE:soundor_objc_class_probe>
        -DNM=${SOUNDOR_NM_EXE}
        -DAPPLE=${APPLE}
        -DALLOWED=soundor_probe_entry
        -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckExportedSymbols.cmake)
    set_tests_properties(soundor_exported_symbols_detects_objc_classes PROPERTIES
      PASS_REGULAR_EXPRESSION "Objective-C classes defined(.|\n)*UnprefixedProbeClass")
  endif()
endif()

# Coexistence: two plugin-shaped libraries, each with its own copy of the
# runtime under its own ABI namespace (as two plugins built from different
# plugin ids), loaded into one process by a host program.
add_library(soundor_runtime_other STATIC ${SOUNDOR_RUNTIME_SOURCES})
# The embedded JavaScript, generated for soundor_runtime, compiled again here.
get_target_property(soundor_runtime_all_sources soundor_runtime SOURCES)
list(FILTER soundor_runtime_all_sources INCLUDE REGEX "soundor-embedded/")
target_sources(soundor_runtime_other PRIVATE ${soundor_runtime_all_sources})
add_dependencies(soundor_runtime_other soundor_runtime)
soundor_configure_runtime(soundor_runtime_other p_coexist)
# Same sources as soundor_runtime under another ABI namespace; linting them
# twice only doubles the clang-tidy time.
set_target_properties(soundor_runtime_other PROPERTIES CXX_CLANG_TIDY "")

add_library(soundor_coexist_a MODULE coexistence/Plugin.cpp)
target_link_libraries(soundor_coexist_a PRIVATE soundor::runtime)
target_compile_definitions(soundor_coexist_a PRIVATE SOUNDOR_COEXIST_COLOR="red")
soundor_configure_target(soundor_coexist_a)

add_library(soundor_coexist_b MODULE coexistence/Plugin.cpp)
target_link_libraries(soundor_coexist_b PRIVATE soundor_runtime_other)
target_compile_definitions(soundor_coexist_b PRIVATE SOUNDOR_COEXIST_COLOR="blue")
soundor_configure_target(soundor_coexist_b)

add_executable(soundor_coexistence_host coexistence/Host.cpp)
target_compile_features(soundor_coexistence_host PRIVATE cxx_std_20)
target_link_libraries(soundor_coexistence_host PRIVATE ${CMAKE_DL_LIBS})
if(SOUNDOR_ENABLE_SANITIZERS)
  target_compile_definitions(soundor_coexistence_host PRIVATE SOUNDOR_COEXIST_KEEP_LOADED=1)
endif()
soundor_configure_target(soundor_coexistence_host)
add_dependencies(soundor_coexistence_host soundor_coexist_a soundor_coexist_b)
add_test(
  NAME soundor_coexistence
  COMMAND soundor_coexistence_host $<TARGET_FILE:soundor_coexist_a> $<TARGET_FILE:soundor_coexist_b>)
if(NOT WIN32 AND NOT SOUNDOR_ENABLE_SANITIZERS)
  foreach(module soundor_coexist_a soundor_coexist_b)
    add_test(
      NAME ${module}_exports
      COMMAND ${CMAKE_COMMAND}
        -DLIBRARY=$<TARGET_FILE:${module}>
        -DNM=${SOUNDOR_NM_EXE}
        -DAPPLE=${APPLE}
        "-DALLOWED=soundor_coexist_create$<SEMICOLON>soundor_coexist_click$<SEMICOLON>soundor_coexist_pixel$<SEMICOLON>soundor_coexist_destroy"
        -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckExportedSymbols.cmake)
  endforeach()
endif()

