# The WebAssembly core: the engine's platform-independent sources
# (SoundorCoreSources.cmake, the same the native runtime compiles) and its
# Yoga, as one standalone module (no Emscripten JavaScript; web/src/engine.ts
# instantiates it). Configured by the engine's CMakeLists.txt with
# Emscripten's toolchain: `cmake --workflow --preset wasm`.

# The pinned Emscripten (emscripten.json, which CI's emsdk action installs and
# the module's input fingerprint covers): another compiler makes another
# module than the published one.
file(READ "${CMAKE_CURRENT_LIST_DIR}/emscripten.json" soundor_emscripten_pin)
string(JSON soundor_emscripten_version GET "${soundor_emscripten_pin}" version)
if(NOT EMSCRIPTEN_VERSION VERSION_EQUAL soundor_emscripten_version)
  message(FATAL_ERROR "The WebAssembly core is built with Emscripten ${soundor_emscripten_version} "
                      "(wasm/emscripten.json), not ${EMSCRIPTEN_VERSION}: "
                      "emsdk install ${soundor_emscripten_version} && emsdk activate ${soundor_emscripten_version}")
endif()
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_LIST_DIR}/emscripten.json")

include(SoundorYoga)
include(SoundorCoreSources)

set(soundor_wasm_sources ${SOUNDOR_CORE_SOURCES} src/render/NoVectorScene.cpp)
list(TRANSFORM soundor_wasm_sources PREPEND "${SoundorEngine_SOURCE_DIR}/")

add_executable(soundor_wasm ${soundor_wasm_sources} Engine.cpp Exports.cpp)
set_target_properties(soundor_wasm PROPERTIES
  OUTPUT_NAME soundor-core
  SUFFIX ".wasm"
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/web")
target_compile_features(soundor_wasm PRIVATE cxx_std_20)
target_include_directories(soundor_wasm PRIVATE
  ${SoundorEngine_SOURCE_DIR}/include ${SoundorEngine_BINARY_DIR}/generated ${SoundorEngine_SOURCE_DIR}/src)
target_compile_definitions(soundor_wasm PRIVATE SOUNDOR_DEVTOOLS=0)
target_link_libraries(soundor_wasm PRIVATE soundor_yoga)
soundor_configure_target(soundor_wasm)

# C++ exceptions are the engine's errors (Surface throws on misuse), caught at
# the exports: WebAssembly's own exception handling, without JavaScript.
set(soundor_wasm_exceptions -fwasm-exceptions)
target_compile_options(soundor_wasm PRIVATE ${soundor_wasm_exceptions})
target_compile_options(soundor_yoga PRIVATE ${soundor_wasm_exceptions})
target_link_options(soundor_wasm PRIVATE
  ${soundor_wasm_exceptions}
  # A plain module: its imports are WASI's few and the text measurement
  # (module "soundor"), its exports the soundor_engine_* functions.
  -sSTANDALONE_WASM
  --no-entry
  -sFILESYSTEM=0
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=1MB
  -sSTACK_SIZE=128KB
  -sERROR_ON_UNDEFINED_SYMBOLS=0
  -sWARN_ON_UNDEFINED_SYMBOLS=0)
