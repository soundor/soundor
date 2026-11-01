include(SoundorDependencies)

soundor_fetch_source(
  SOUNDOR_DOCTEST
  doctest/doctest
  ${SOUNDOR_DOCTEST_REVISION}
  ${SOUNDOR_DOCTEST_SHA256})

add_library(soundor_doctest INTERFACE)
target_include_directories(soundor_doctest SYSTEM INTERFACE ${SOUNDOR_DOCTEST_SOURCE_DIR})

# The document foundation also runs in Release (without Hermes's compiler).
# Skia is private; prebuilt consumer tests exercise it through Image instead.
if(NOT SOUNDOR_ENGINE_PREBUILT)
  add_executable(soundor_svg_tests main.cpp render/SvgDocumentTests.cpp render/SvgImageTests.cpp)
  target_include_directories(soundor_svg_tests PRIVATE ${SoundorEngine_SOURCE_DIR}/src)
  target_link_libraries(soundor_svg_tests PRIVATE Soundor::Engine soundor_skia soundor_doctest)
  if(WIN32)
    # The shared test main includes WindowsCrashDiagnostics, as the runtime tests do.
    target_link_libraries(soundor_svg_tests PRIVATE dbghelp)
  endif()
  soundor_configure_target(soundor_svg_tests)
  add_test(NAME soundor_svg_tests COMMAND soundor_svg_tests)
  set_tests_properties(soundor_svg_tests PROPERTIES TIMEOUT 30)
endif()

# Everything below up to the coexistence test evaluates JavaScript source:
# not for an engine without Hermes's compiler (a release prebuilt), which the
# coexistence and ABI tests check.
if(SOUNDOR_JS_SOURCE)
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
    render/CompositorTests.cpp
    render/AnimationFrameTests.cpp
    render/FrameTests.cpp
    render/RegionTests.cpp
    runtime/DevSessionTests.cpp
    runtime/ResourcesTests.cpp
    runtime/StatisticsTests.cpp
    runtime/BytecodeTests.cpp
    runtime/TimeLimitTests.cpp
    ui/AnimationModuleTests.cpp
    ui/AnimationTests.cpp
    ui/SurfaceTests.cpp
    ui/PrimitivesTests.cpp
    ui/RendererTests.cpp
    ui/CanvasTests.cpp
    ui/UiModuleTests.cpp
    web/FetchTests.cpp
    web/GlobalsTests.cpp
    web/PlatformModulesTests.cpp
    web/UrlTests.cpp
    web/WebApiTests.cpp
    # Golden output of the soundor:native generator (see src/native-codegen.test.ts).
    generated/soundor/native/SoundorNative.cpp)
  target_include_directories(soundor_runtime_tests PRIVATE ${SoundorEngine_SOURCE_DIR}/src ${CMAKE_CURRENT_SOURCE_DIR}/generated)
  # Tests exercise internal seams (native modules), so they may see Hermes.
  target_link_libraries(soundor_runtime_tests PRIVATE Soundor::Engine soundor_hermes soundor_doctest)
  if(NOT SOUNDOR_ENGINE_PREBUILT)
    target_link_libraries(soundor_runtime_tests PRIVATE soundor_skia)
    target_compile_definitions(soundor_runtime_tests PRIVATE SOUNDOR_TEST_SVG=1)
  endif()
  if(WIN32)
    target_link_libraries(soundor_runtime_tests PRIVATE dbghelp)
  endif()
  soundor_configure_target(soundor_runtime_tests)
  if(SOUNDOR_ENABLE_DEVTOOLS)
    target_sources(soundor_runtime_tests PRIVATE debug/InspectorTests.cpp debug/DiagnosticsTests.cpp debug/CommandTests.cpp debug/InputTests.cpp debug/CaptureTests.cpp)
  endif()

  # Generated code is checked by its generator's tests, not linted.
  set_source_files_properties(generated/soundor/native/SoundorNative.cpp PROPERTIES SKIP_LINTING ON)

  soundor_embed_directory(soundor_runtime_tests fixtureUi ${CMAKE_CURRENT_SOURCE_DIR}/fixtures/ui)
  # The same, with its modules compiled to bytecode (where the build can).
  soundor_embed_ui(soundor_runtime_tests fixtureUiCompiled ${CMAKE_CURRENT_SOURCE_DIR}/fixtures/ui)
  # A bundle that never returns, compiled as a plugin's: its bytecode must stop
  # at the time limit.
  soundor_embed_ui(soundor_runtime_tests fixtureRunawayCompiled ${CMAKE_CURRENT_SOURCE_DIR}/fixtures/runaway)
  soundor_precompiles_js(soundor_tests_precompile)
  if(soundor_tests_precompile)
    target_compile_definitions(soundor_runtime_tests PRIVATE SOUNDOR_TESTS_PRECOMPILE_JS=1)
    # Override Context.cpp in this test executable with an incompatible marker.
    # All its other code and embedded modules come from the normal runtime.
    # This exercises an actual constructor failure, without a test hook in the API.
    add_executable(soundor_context_init_failure js/ContextInitFailure.cpp ${SoundorEngine_SOURCE_DIR}/src/js/Context.cpp)
    target_include_directories(soundor_context_init_failure PRIVATE ${SoundorEngine_SOURCE_DIR}/src)
    target_link_libraries(soundor_context_init_failure PRIVATE Soundor::Engine soundor_hermes)
    target_compile_definitions(soundor_context_init_failure PRIVATE SOUNDOR_HERMES_REVISION="incompatible-test-revision")
    soundor_configure_target(soundor_context_init_failure)
    add_test(NAME soundor_context_init_failure COMMAND soundor_context_init_failure)
    set_tests_properties(soundor_context_init_failure PROPERTIES TIMEOUT 30)
  endif()
  target_compile_definitions(soundor_runtime_tests PRIVATE SOUNDOR_TEST_FIXTURES="${CMAKE_CURRENT_SOURCE_DIR}/fixtures")

  if(SOUNDOR_HAS_GPU)
    target_compile_definitions(soundor_runtime_tests PRIVATE SOUNDOR_TEST_GPU=1)
    # Three.js, unmodified, from npm: its build/ is loaded as the tests' UI files.
    FetchContent_Declare(
      SOUNDOR_THREE
      URL "https://registry.npmjs.org/three/-/three-${SOUNDOR_THREE_VERSION}.tgz"
      URL_HASH "SHA256=${SOUNDOR_THREE_SHA256}"
      DOWNLOAD_EXTRACT_TIMESTAMP TRUE
      SOURCE_SUBDIR "soundor-populate-only")
    FetchContent_MakeAvailable(SOUNDOR_THREE)
    # In the runtime's module form, as a plugin's bundle would have it: lowered
    # by @soundor/core's toNativeModule() (with Node, at build time).
    set(soundor_three_dir "${CMAKE_CURRENT_BINARY_DIR}/three")
    set(soundor_three_outputs "")
    foreach(file three.module.js three.core.js)
      soundor_lower_js_command("${soundor_three_SOURCE_DIR}/build/${file}" "${soundor_three_dir}/${file}" "${file}")
      list(APPEND soundor_three_outputs "${soundor_three_dir}/${file}")
    endforeach()
    add_custom_target(soundor_three_modules DEPENDS ${soundor_three_outputs})
    add_dependencies(soundor_runtime_tests soundor_three_modules)
    target_compile_definitions(soundor_runtime_tests PRIVATE SOUNDOR_THREE_DIR="${soundor_three_dir}")
    target_sources(soundor_runtime_tests PRIVATE gpu/CompositorTests.cpp gpu/DeviceTests.cpp gpu/PresentationTests.cpp
      gpu/WebGLTests.cpp gpu/ZeroCopyTests.cpp gpu/ThreeTests.cpp)
    if(APPLE)
      target_sources(soundor_runtime_tests PRIVATE gpu/TestWindow.mm)
    else()
      target_sources(soundor_runtime_tests PRIVATE gpu/TestWindow.cpp)
    endif()
    target_link_libraries(soundor_runtime_tests PRIVATE soundor_angle)
  endif()

  if(SOUNDOR_HAS_ACCESSKIT)
    target_sources(soundor_runtime_tests PRIVATE a11y/AccessKitTests.cpp)
    target_link_libraries(soundor_runtime_tests PRIVATE soundor_accesskit)
    target_compile_definitions(soundor_runtime_tests PRIVATE SOUNDOR_HAS_ACCESSKIT=1)
  endif()

  if(APPLE AND NOT IOS)
    target_sources(soundor_runtime_tests PRIVATE apple/MacBridgeTests.mm)
    target_link_libraries(soundor_runtime_tests PRIVATE "-framework AppKit")
    set_target_properties(soundor_runtime_tests PROPERTIES OBJCXX_STANDARD 20 OBJCXX_STANDARD_REQUIRED ON)
    target_compile_options(soundor_runtime_tests PRIVATE $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc -Wno-old-style-cast>)
  endif()

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
            --build-options -DSOUNDOR_NATIVE_DIR=${SoundorEngine_SOURCE_DIR}
                            -DFETCHCONTENT_BASE_DIR=${FETCHCONTENT_BASE_DIR}
                            -DSOUNDOR_ENGINE_PREBUILT_DEBUG_DIR=${SOUNDOR_ENGINE_PREBUILT_DEBUG_DIR}
                            -DCMAKE_BUILD_TYPE=Debug)
endif()

# Symbol isolation: a plugin-shaped shared library that links the runtime must
# export only its own entry point — never Hermes or Soundor internals.
# Sanitizer builds export their own instrumentation markers, so the check runs
# on regular builds only.
if(NOT WIN32 AND NOT SOUNDOR_ENABLE_SANITIZERS)
  find_program(SOUNDOR_NM_EXE NAMES nm llvm-nm REQUIRED)
  if(SOUNDOR_JS_SOURCE)
    add_library(soundor_symbol_probe MODULE symbols/Probe.cpp)
    target_link_libraries(soundor_symbol_probe PRIVATE Soundor::Engine)
    soundor_configure_target(soundor_symbol_probe)
    # The probe renders on the GPU too, so ANGLE is linked in and checked.
    target_include_directories(soundor_symbol_probe PRIVATE ${SoundorEngine_SOURCE_DIR}/src)
    if(SOUNDOR_HAS_GPU)
      target_link_libraries(soundor_symbol_probe PRIVATE soundor_angle)
      target_compile_definitions(soundor_symbol_probe PRIVATE SOUNDOR_HAS_GPU=1)
    else()
      target_compile_definitions(soundor_symbol_probe PRIVATE SOUNDOR_HAS_GPU=0)
    endif()
    add_test(
      NAME soundor_exported_symbols
      COMMAND ${CMAKE_COMMAND}
        -DLIBRARY=$<TARGET_FILE:soundor_symbol_probe>
        -DNM=${SOUNDOR_NM_EXE}
        -DAPPLE=${APPLE}
        -DALLOWED=soundor_probe_entry
        -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckExportedSymbols.cmake)
  endif()

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

    # ... and for the Objective-C category check.
    add_library(soundor_objc_category_probe MODULE symbols/ObjcCategoryProbe.mm)
    target_link_libraries(soundor_objc_category_probe PRIVATE "-framework Foundation")
    add_test(
      NAME soundor_exported_symbols_detects_objc_categories
      COMMAND ${CMAKE_COMMAND}
        -DLIBRARY=$<TARGET_FILE:soundor_objc_category_probe>
        -DNM=${SOUNDOR_NM_EXE}
        -DAPPLE=${APPLE}
        -DALLOWED=soundor_probe_entry
        -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckExportedSymbols.cmake)
    set_tests_properties(soundor_exported_symbols_detects_objc_categories PROPERTIES
      PASS_REGULAR_EXPRESSION "Objective-C categories defined(.|\n)*UnprefixedProbeCategory")
  endif()
endif()

# Third-party code bundled twice: no two of the engine's dependency archives
# may define the same C symbol (Skia and ANGLE each bundle Chromium's zlib;
# ANGLE is built to use Skia's). Source builds only: a prebuilt engine stages
# these same archives.
if(NOT WIN32)
  find_program(SOUNDOR_NM_EXE NAMES nm llvm-nm REQUIRED)
  set(soundor_dependency_archives "")
  foreach(dependency soundor_skia soundor_angle soundor_accesskit)
    if(TARGET ${dependency})
      get_target_property(imported ${dependency} IMPORTED)
      get_target_property(type ${dependency} TYPE)
      if(imported AND type STREQUAL "STATIC_LIBRARY")
        list(APPEND soundor_dependency_archives $<TARGET_FILE:${dependency}>)
      endif()
    endif()
  endforeach()
  list(LENGTH soundor_dependency_archives count)
  if(count GREATER 1)
    add_test(
      NAME soundor_dependencies_share_no_symbols
      COMMAND ${CMAKE_COMMAND}
        "-DARCHIVES=${soundor_dependency_archives}"
        -DNM=${SOUNDOR_NM_EXE}
        -DAPPLE=${APPLE}
        -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckSharedDefinitions.cmake)
  endif()

  # Negative control: proves the check really fails on a symbol defined twice.
  add_library(soundor_duplicate_probe_a STATIC symbols/DuplicateProbe.cpp)
  add_library(soundor_duplicate_probe_b STATIC symbols/DuplicateProbe.cpp)
  add_test(
    NAME soundor_dependencies_share_no_symbols_detects_duplicates
    COMMAND ${CMAKE_COMMAND}
      "-DARCHIVES=$<TARGET_FILE:soundor_duplicate_probe_a>;$<TARGET_FILE:soundor_duplicate_probe_b>"
      -DNM=${SOUNDOR_NM_EXE}
      -DAPPLE=${APPLE}
      -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckSharedDefinitions.cmake)
  set_tests_properties(soundor_dependencies_share_no_symbols_detects_duplicates PROPERTIES
    PASS_REGULAR_EXPRESSION "defined in more than one archive(.|\n)*soundor_duplicate_probe ")

  # Skia's copies of libjpeg-turbo, libpng and libwebp define only soundor_*
  # names (cmake/skia/SoundorSkiaPrefix.h), so a plugin can contain JUCE's
  # copies too.
  set(soundor_skia_library_members "^lib(jpeg|jpeg12|jpeg16|png|webp|expat)(_[a-z0-9]+)?\\.")
  if(TARGET soundor_skia)
    get_target_property(imported soundor_skia IMPORTED)
    get_target_property(type soundor_skia TYPE)
    if(imported AND type STREQUAL "STATIC_LIBRARY")
      add_test(
        NAME soundor_skia_prefixes_bundled_libraries
        COMMAND ${CMAKE_COMMAND}
          -DARCHIVE=$<TARGET_FILE:soundor_skia>
          "-DMEMBERS=${soundor_skia_library_members}"
          -DPREFIX=soundor_
          -DNM=${SOUNDOR_NM_EXE}
          -DAPPLE=${APPLE}
          -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckPrefixed.cmake)
    endif()
  endif()

  # Negative control: an object named like libpng's defines an unprefixed name.
  add_library(soundor_prefix_probe STATIC symbols/libpng.PrefixProbe.cpp)
  add_test(
    NAME soundor_skia_prefixes_bundled_libraries_detects_unprefixed
    COMMAND ${CMAKE_COMMAND}
      -DARCHIVE=$<TARGET_FILE:soundor_prefix_probe>
      "-DMEMBERS=${soundor_skia_library_members}"
      -DPREFIX=soundor_
      -DNM=${SOUNDOR_NM_EXE}
      -DAPPLE=${APPLE}
      -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckPrefixed.cmake)
  set_tests_properties(soundor_skia_prefixes_bundled_libraries_detects_unprefixed PROPERTIES
    PASS_REGULAR_EXPRESSION "lack the soundor_ prefix(.|\n)*png_prefix_probe ")
endif()

# Coexistence: two plugin-shaped libraries link the same engine archive and
# package ABI namespace, loaded into one process by a host program. Each
# embeds its own UI bundle, as a plugin does: a box in its color that logs
# its click count.
foreach(plugin a:red b:blue)
  string(REPLACE ":" ";" plugin "${plugin}")
  list(GET plugin 0 name)
  list(GET plugin 1 color)
  file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/coexist-${name}/bundle.js" "\
(function (exports, require) {
  const { root, createView } = require('soundor:ui');
  let count = 0;
  const box = createView({ width: 64, height: 64, backgroundColor: '${color}' });
  box.addEventListener('click', () => { count += 1; console.log('count=' + count); });
  root.appendChild(box);
});
")
  add_library(soundor_coexist_${name} MODULE coexistence/Plugin.cpp)
  target_link_libraries(soundor_coexist_${name} PRIVATE Soundor::Engine)
  target_compile_definitions(soundor_coexist_${name} PRIVATE SOUNDOR_COEXIST_COLOR="${color}")
  soundor_embed_ui(soundor_coexist_${name} coexistUi "${CMAKE_CURRENT_BINARY_DIR}/coexist-${name}")
  soundor_configure_target(soundor_coexist_${name})
endforeach()

# Each "plugin" drives the GPU through the runtime's own ANGLE, linked into it.
foreach(module soundor_coexist_a soundor_coexist_b)
  target_include_directories(${module} PRIVATE ${SoundorEngine_SOURCE_DIR}/src)
  if(SOUNDOR_HAS_GPU)
    target_link_libraries(${module} PRIVATE soundor_angle)
    target_compile_definitions(${module} PRIVATE SOUNDOR_HAS_GPU=1)
  else()
    target_compile_definitions(${module} PRIVATE SOUNDOR_HAS_GPU=0)
  endif()
endforeach()

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
if(WIN32)
  # A crashed runtime or a loader-lock deadlock must fail the job rather than
  # prevent its subsequent crash diagnostics from ever running.
  set_tests_properties(soundor_coexistence PROPERTIES TIMEOUT 180)
  if(SOUNDOR_JS_SOURCE)
    set_tests_properties(soundor_runtime_tests PROPERTIES TIMEOUT 180)
  endif()
endif()
# The macOS accessibility bridge in a plugin host: two plugin binaries with
# their own runtimes (and so their own element classes), loaded together,
# destroyed and unloaded while an element is still held.
if(APPLE AND NOT IOS AND SOUNDOR_JS_SOURCE)
  foreach(variant a b)
    add_library(soundor_apple_module_${variant} MODULE apple/Module.mm)
    target_include_directories(soundor_apple_module_${variant} PRIVATE ${SoundorEngine_SOURCE_DIR}/src)
    target_link_libraries(soundor_apple_module_${variant} PRIVATE "-framework AppKit")
    set_target_properties(soundor_apple_module_${variant} PROPERTIES
      OBJCXX_STANDARD 20 OBJCXX_VISIBILITY_PRESET hidden VISIBILITY_INLINES_HIDDEN ON)
    target_compile_options(soundor_apple_module_${variant} PRIVATE -fobjc-arc)
  endforeach()
  target_link_libraries(soundor_apple_module_a PRIVATE Soundor::Engine)
  target_link_libraries(soundor_apple_module_b PRIVATE Soundor::Engine)

  add_executable(soundor_apple_host apple/AppleHost.mm)
  target_link_libraries(soundor_apple_host PRIVATE "-framework AppKit" ${CMAKE_DL_LIBS})
  target_compile_options(soundor_apple_host PRIVATE -fobjc-arc)
  add_dependencies(soundor_apple_host soundor_apple_module_a soundor_apple_module_b)
  add_test(
    NAME soundor_apple_coexistence
    COMMAND soundor_apple_host $<TARGET_FILE:soundor_apple_module_a> $<TARGET_FILE:soundor_apple_module_b>)
endif()

# The iOS bridge, built for the iOS simulator: there is no iOS plugin build
# yet, so this keeps it compiling (it cannot run here).
if(APPLE AND NOT IOS)
  add_test(
    NAME soundor_ios_bridge_builds
    COMMAND ${CMAKE_COMMAND} -E env --unset=CMAKE_GENERATOR
            ${CMAKE_CTEST_COMMAND}
            --build-and-test ${CMAKE_CURRENT_SOURCE_DIR}/ios ${CMAKE_CURRENT_BINARY_DIR}/ios
            --build-generator ${CMAKE_GENERATOR}
            --build-options -DCMAKE_SYSTEM_NAME=iOS
                            -DCMAKE_OSX_SYSROOT=iphonesimulator
                            -DCMAKE_OSX_ARCHITECTURES=arm64
                            -DCMAKE_OSX_DEPLOYMENT_TARGET=15.0
                            -DSOUNDOR_NATIVE_DIR=${SoundorEngine_SOURCE_DIR})
endif()

if(NOT WIN32 AND NOT SOUNDOR_ENABLE_SANITIZERS)
  foreach(module soundor_coexist_a soundor_coexist_b)
    add_test(
      NAME ${module}_exports
      COMMAND ${CMAKE_COMMAND}
        -DLIBRARY=$<TARGET_FILE:${module}>
        -DNM=${SOUNDOR_NM_EXE}
        -DAPPLE=${APPLE}
        "-DALLOWED=soundor_coexist_create$<SEMICOLON>soundor_coexist_click$<SEMICOLON>soundor_coexist_pixel$<SEMICOLON>soundor_coexist_gpu_pixel$<SEMICOLON>soundor_coexist_destroy"
        -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckExportedSymbols.cmake)
  endforeach()
endif()


# soundor_run_ui: a UI bundle run headless on the GPU (see tools/RunUi.cpp).
if(SOUNDOR_HAS_GPU AND SOUNDOR_JS_SOURCE)
  add_executable(soundor_run_ui tools/RunUi.cpp)
  target_include_directories(soundor_run_ui PRIVATE ${SoundorEngine_SOURCE_DIR}/src)
  target_link_libraries(soundor_run_ui PRIVATE Soundor::Engine soundor_angle)
  soundor_configure_target(soundor_run_ui)
endif()

foreach(consumer soundor_runtime_tests soundor_symbol_probe soundor_coexist_a soundor_coexist_b soundor_apple_module_a soundor_apple_module_b soundor_run_ui soundor_context_init_failure)
  if(TARGET ${consumer})
    soundor_attach_plugin_shim(${consumer})
  endif()
endforeach()

add_test(NAME soundor_engine_abi_namespace COMMAND ${CMAKE_COMMAND} -P ${CMAKE_CURRENT_SOURCE_DIR}/abi/Namespace.cmake)

# Without DevTools (production, the release prebuilt), none of its code is in
# the engine.
if(NOT WIN32 AND NOT SOUNDOR_ENABLE_DEVTOOLS AND SOUNDOR_NM_EXE)
  add_test(NAME soundor_engine_without_devtools
    COMMAND ${CMAKE_COMMAND} -DLIBRARY=$<TARGET_FILE:soundor_runtime> -DNM=${SOUNDOR_NM_EXE}
            -P ${CMAKE_CURRENT_SOURCE_DIR}/symbols/CheckNoDevTools.cmake)
endif()

# Prebuilt mode: the release this package names is downloaded, verified,
# cached and reused offline; a wrong manifest, checksum or archive is refused.
add_test(NAME soundor_prebuilt_resolve
  COMMAND ${CMAKE_COMMAND} -DENGINE=${SoundorEngine_SOURCE_DIR} -DGENERATOR=${CMAKE_GENERATOR}
          -DWORK=${CMAKE_CURRENT_BINARY_DIR}/prebuilt-resolve -P ${CMAKE_CURRENT_SOURCE_DIR}/prebuilt/Resolve.cmake)
set_tests_properties(soundor_prebuilt_resolve PROPERTIES TIMEOUT 600)

# A prebuilt engine for another version, platform, variant... is rejected
# before anything links it, saying why.
if(SOUNDOR_ENGINE_PREBUILT)
  foreach(variant debug release)
    string(TOUPPER "${variant}" upper)
    if(SOUNDOR_ENGINE_PREBUILT_${upper}_DIR)
      add_test(NAME soundor_prebuilt_rejects_${variant}
        COMMAND ${CMAKE_COMMAND} -DENGINE=${SoundorEngine_SOURCE_DIR}
                -DARCHIVE=${SOUNDOR_ENGINE_PREBUILT_${upper}_DIR} -DVARIANT=${variant}
                -DGENERATOR=${CMAKE_GENERATOR} -DWORK=${CMAKE_CURRENT_BINARY_DIR}/prebuilt-rejects-${variant}
                -P ${CMAKE_CURRENT_SOURCE_DIR}/prebuilt/Rejects.cmake)
      set_tests_properties(soundor_prebuilt_rejects_${variant} PROPERTIES TIMEOUT 600)
    endif()
  endforeach()
endif()

if(NOT SOUNDOR_ENABLE_SANITIZERS)
  add_test(NAME soundor_engine_abi
    COMMAND ${CMAKE_COMMAND} -S ${CMAKE_CURRENT_SOURCE_DIR}/abi -B ${CMAKE_CURRENT_BINARY_DIR}/abi
      -G ${CMAKE_GENERATOR}
      -DCMAKE_CXX_COMPILER=${CMAKE_CXX_COMPILER}
      -DENGINE_ARCHIVE=$<TARGET_FILE:soundor_runtime>
      -DENGINE_ABI_HEADER=${CMAKE_CURRENT_BINARY_DIR}/../generated/soundor/Abi.h
      -DENGINE_CONFIG=$<IF:$<CONFIG:Debug>,Debug,Release>
      -DENGINE_DEVTOOLS=$<IF:$<AND:$<BOOL:${SOUNDOR_ENABLE_DEVTOOLS}>,$<CONFIG:Debug>>,1,0>)
endif()

if(APPLE AND NOT IOS AND SOUNDOR_JS_SOURCE)
  target_compile_definitions(soundor_runtime_tests PRIVATE SOUNDOR_EXPECTED_ABI="${SOUNDOR_ABI_NAMESPACE}")
  target_compile_definitions(soundor_apple_host PRIVATE SOUNDOR_EXPECTED_ABI="${SOUNDOR_ABI_NAMESPACE}")
endif()

# Before Image consumes SVG, force the parser and renderer into the real
# shared-library probes. Prebuilt consumers have no private Skia headers.
if(NOT SOUNDOR_ENGINE_PREBUILT)
  foreach(probe soundor_symbol_probe soundor_coexist_a soundor_coexist_b)
    if(TARGET ${probe})
      target_sources(${probe} PRIVATE render/SvgProbe.cpp)
      target_link_libraries(${probe} PRIVATE soundor_skia)
      target_compile_definitions(${probe} PRIVATE SOUNDOR_TEST_SVG=1)
    endif()
  endforeach()
endif()
