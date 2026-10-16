# Embeds text files (the JavaScript of runtime-provided modules) into C++.
#
# soundor_embed_text(<target> <symbol> <input>) compiles a source defining
#   const std::string_view soundor::<abi>::embedded::<symbol>
# with the contents of <input>, regenerated whenever <input> changes.

include_guard(GLOBAL)

# Both functions may be called from any directory scope (a plugin project calls
# them after add_subdirectory()), so they locate their scripts themselves.

function(soundor_embed_text target symbol input)
  set(script "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/SoundorEmbedText.cmake")
  get_filename_component(input "${input}" ABSOLUTE)
  set(output "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded/${symbol}.cpp")
  add_custom_command(
    OUTPUT "${output}"
    COMMAND ${CMAKE_COMMAND} -DINPUT=${input} -DOUTPUT=${output} -DSYMBOL=${symbol} -P "${script}"
    DEPENDS "${input}" "${script}"
    COMMENT "Embedding ${input}"
    VERBATIM)
  target_sources(${target} PRIVATE "${output}")
  set_source_files_properties("${output}" PROPERTIES SKIP_LINTING ON) # generated
endfunction()

# soundor_embed_directory(<target> <function> <directory>) compiles every file
# under <directory> into <target> and defines
#   std::span<const soundor::<abi>::platform::EmbeddedFile>
#   soundor::<abi>::embedded::<function>()
# listing them by relative path. Regenerated when files are added, removed or
# changed.

function(soundor_embed_directory target function directory)
  set(script "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/SoundorEmbedDirectory.cmake")
  get_filename_component(directory "${directory}" ABSOLUTE)
  file(GLOB_RECURSE files CONFIGURE_DEPENDS LIST_DIRECTORIES false "${directory}/*")
  set(output "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded/${function}.cpp")
  add_custom_command(
    OUTPUT "${output}"
    COMMAND ${CMAKE_COMMAND} -DDIRECTORY=${directory} -DOUTPUT=${output} -DFUNCTION=${function}
            -P "${script}"
    DEPENDS ${files} "${script}"
    COMMENT "Embedding ${directory}"
    VERBATIM)
  target_sources(${target} PRIVATE "${output}")
  set_source_files_properties("${output}" PROPERTIES SKIP_LINTING ON) # generated
endfunction()

# Whether JavaScript is compiled to Hermes bytecode while building: hermesc is
# part of this build (SoundorHermes.cmake), and the build can run it.
function(soundor_precompiles_js out)
  if(SOUNDOR_PRECOMPILE_JS AND TARGET soundor_hermesc AND NOT CMAKE_CROSSCOMPILING)
    set(${out} TRUE PARENT_SCOPE)
  else()
    set(${out} FALSE PARENT_SCOPE)
  endif()
endfunction()

# Node, which lowers the runtime's modules (soundor_lower_js_command()). A
# plugin build gets the one running the CLI.
find_program(SOUNDOR_NODE_EXE NAMES node)

# Lowers the ES module <input> to <output>, in the runtime's module form
# (SoundorLowerJs.mjs, with @soundor/core's toNativeModule()). <name> is the
# file name problems are reported under.
function(soundor_lower_js_command input output name)
  if(NOT SOUNDOR_NODE_EXE)
    message(FATAL_ERROR "Soundor needs Node to build its runtime's JavaScript modules: put node on PATH, "
                        "or set SOUNDOR_NODE_EXE")
  endif()
  set(script "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/SoundorLowerJs.mjs")
  set(depends "${input}" "${script}")
  # The lowering itself (source in the workspace, JS in an installed package).
  set(lowering "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/../scripts/native-module.ts")
  if(NOT EXISTS "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/../../../pnpm-workspace.yaml")
    set(lowering "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/../dist/native-module.mjs")
  endif()
  if(EXISTS "${lowering}")
    list(APPEND depends "${lowering}")
  endif()
  get_filename_component(directory "${output}" DIRECTORY)
  add_custom_command(
    OUTPUT "${output}"
    COMMAND ${CMAKE_COMMAND} -E make_directory "${directory}"
    COMMAND "${SOUNDOR_NODE_EXE}" "${script}" "${input}" "${output}" "${name}"
    DEPENDS ${depends}
    COMMENT "Lowering ${input}"
    VERBATIM)
endfunction()

# Compiles <input> to <output>, Hermes bytecode for the module <name>
# (SoundorCompileJs.cmake).
function(soundor_compile_js_command input output name)
  get_property(revision GLOBAL PROPERTY SOUNDOR_HERMES_REVISION)
  add_custom_command(
    OUTPUT "${output}"
    COMMAND ${CMAKE_COMMAND} "-DHERMESC=$<TARGET_FILE:soundor_hermesc>" "-DINPUT=${input}" "-DOUTPUT=${output}"
            "-DNAME=${name}" "-DREVISION=${revision}" "-DFLAGS=${SOUNDOR_HERMESC_FLAGS}"
            -P "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/SoundorCompileJs.cmake"
    DEPENDS "${input}" soundor_hermesc "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/SoundorCompileJs.cmake"
    COMMENT "Compiling ${input}"
    VERBATIM)
endfunction()

# soundor_embed_module(<target> <symbol> <input> <name>) embeds a runtime
# module, defining
#   const soundor::<abi>::embedded::ModuleCode soundor::<abi>::embedded::<symbol>
# (src/modules/Embedded.h): its bytecode, compiled by hermesc under the module
# name <name>, or its source where the build cannot compile it. <input> is an
# ES module (src/), lowered to the runtime's module form first.
function(soundor_embed_module target symbol source name)
  set(script "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/SoundorEmbedModule.cmake")
  get_filename_component(source "${source}" ABSOLUTE)
  set(directory "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded")
  set(output "${directory}/${symbol}.cpp")
  set(input "${directory}/${symbol}.js")
  file(RELATIVE_PATH relative "${CMAKE_CURRENT_SOURCE_DIR}" "${source}")
  soundor_lower_js_command("${source}" "${input}" "${relative}")
  soundor_precompiles_js(precompile)
  if(precompile)
    set(compiled "${directory}/${symbol}.hbc")
    soundor_compile_js_command("${input}" "${compiled}" "${name}")
    add_custom_command(
      OUTPUT "${output}"
      COMMAND ${CMAKE_COMMAND} -DBYTECODE=${compiled} -DOUTPUT=${output} -DSYMBOL=${symbol} -P "${script}"
      DEPENDS "${compiled}" "${script}"
      COMMENT "Embedding ${compiled}"
      VERBATIM)
  else()
    soundor_embed_text(${target} ${symbol}Source "${input}")
    add_custom_command(
      OUTPUT "${output}"
      COMMAND ${CMAKE_COMMAND} -DSOURCE=${symbol}Source -DOUTPUT=${output} -DSYMBOL=${symbol} -P "${script}"
      DEPENDS "${script}"
      COMMENT "Embedding ${input}"
      VERBATIM)
  endif()
  target_sources(${target} PRIVATE "${output}")
  set_source_files_properties("${output}" PROPERTIES SKIP_LINTING ON) # generated
endfunction()

# soundor_embed_ui(<target> <function> <directory>) embeds a plugin's UI
# bundle like soundor_embed_directory(), with each JavaScript module compiled
# to bytecode where the build can: "bundle.js" is embedded as "bundle.js.hbc",
# which the runtime reads instead (ResourceModuleLoader). The bundle's ES
# module form for the Web ("*.mjs") and source maps are not embedded.
function(soundor_embed_ui target function directory)
  set(script "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/SoundorEmbedDirectory.cmake")
  get_filename_component(directory "${directory}" ABSOLUTE)
  file(GLOB_RECURSE files CONFIGURE_DEPENDS LIST_DIRECTORIES false RELATIVE "${directory}" "${directory}/*")
  list(FILTER files EXCLUDE REGEX "\\.(mjs|map)$")
  # Per target: targets of one directory may each embed a UI under one name.
  set(output "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded/${target}/${function}.cpp")
  set(compiledDirectory "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded/${target}/${function}")
  set(inputs "")
  set(compiled "")
  soundor_precompiles_js(precompile)
  foreach(file IN LISTS files)
    list(APPEND inputs "${directory}/${file}")
    if(precompile AND file MATCHES "\\.js$")
      set(bytecode "${compiledDirectory}/${file}.hbc")
      soundor_compile_js_command("${directory}/${file}" "${bytecode}" "/${file}")
      list(APPEND compiled "${bytecode}")
    endif()
  endforeach()
  if(NOT precompile)
    set(compiledDirectory "")
  endif()
  add_custom_command(
    OUTPUT "${output}"
    COMMAND ${CMAKE_COMMAND} -DDIRECTORY=${directory} -DCOMPILED=${compiledDirectory} -DOUTPUT=${output}
            -DFUNCTION=${function} -DUI=ON -P "${script}"
    DEPENDS ${inputs} ${compiled} "${script}"
    COMMENT "Embedding ${directory}"
    VERBATIM)
  target_sources(${target} PRIVATE "${output}")
  set_source_files_properties("${output}" PROPERTIES SKIP_LINTING ON) # generated
endfunction()
