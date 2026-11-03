# Selection and staging use the same identity, including dirty/untracked source
# files and the installed lowering dependency graph. Tests/docs are excluded.
include_guard(GLOBAL)
find_program(SOUNDOR_NODE_EXE NAMES node REQUIRED)
execute_process(COMMAND "${SOUNDOR_NODE_EXE}" "${SoundorEngine_SOURCE_DIR}/scripts/engine-inputs.mjs"
                        "${SoundorEngine_SOURCE_DIR}"
  OUTPUT_VARIABLE soundor_inputs_json OUTPUT_STRIP_TRAILING_WHITESPACE COMMAND_ERROR_IS_FATAL ANY)
string(JSON SOUNDOR_ENGINE_FINGERPRINT GET "${soundor_inputs_json}" fingerprint)
string(JSON soundor_inputs_count LENGTH "${soundor_inputs_json}" files)
math(EXPR soundor_inputs_last "${soundor_inputs_count} - 1")
foreach(index RANGE ${soundor_inputs_last})
  string(JSON path GET "${soundor_inputs_json}" files ${index})
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${path}")
endforeach()
if(EXISTS "${SoundorEngine_SOURCE_DIR}/../../pnpm-lock.yaml")
  set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${SoundorEngine_SOURCE_DIR}/../../pnpm-lock.yaml")
endif()
# Detect additions/deletions as well as edits when building an existing tree.
file(GLOB_RECURSE soundor_input_paths CONFIGURE_DEPENDS
  "${SoundorEngine_SOURCE_DIR}/src/*" "${SoundorEngine_SOURCE_DIR}/include/*"
  "${SoundorEngine_SOURCE_DIR}/cmake/*" "${SoundorEngine_SOURCE_DIR}/scripts/*")
