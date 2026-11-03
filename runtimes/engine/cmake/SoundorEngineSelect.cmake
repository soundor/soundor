include_guard(GLOBAL)
include(SoundorDependencies)
include(SoundorEngineInputs)
soundor_cache_root(soundor_selection_cache)
execute_process(COMMAND "${SOUNDOR_NODE_EXE}" "${SoundorEngine_SOURCE_DIR}/scripts/engine-selection.mjs"
                        "${SoundorEngine_SOURCE_DIR}" "${soundor_selection_cache}" "${SOUNDOR_ENGINE_MANIFEST}"
  OUTPUT_VARIABLE soundor_selection OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
string(JSON soundor_engine_selected_mode GET "${soundor_selection}" mode)
string(JSON soundor_selection_reason GET "${soundor_selection}" reason)
message(STATUS "Soundor engine: selected ${soundor_engine_selected_mode} (${soundor_selection_reason}; ${SOUNDOR_ENGINE_VERSION}, inputs ${SOUNDOR_ENGINE_FINGERPRINT})")
if(soundor_engine_selected_mode STREQUAL "prebuilt")
  string(JSON SOUNDOR_ENGINE_MANIFEST GET "${soundor_selection}" manifest)
endif()
