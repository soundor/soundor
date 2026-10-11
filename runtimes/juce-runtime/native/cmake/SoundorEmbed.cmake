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

# Whether JavaScript is compiled to QuickJS bytecode while building: the
# compiler is part of this build, and the build can run it.
function(soundor_precompiles_js out)
  if(SOUNDOR_PRECOMPILE_JS AND TARGET soundor_compile_js AND NOT CMAKE_CROSSCOMPILING)
    set(${out} TRUE PARENT_SCOPE)
  else()
    set(${out} FALSE PARENT_SCOPE)
  endif()
endfunction()

# soundor_embed_module(<target> <symbol> <input> <name>) embeds a runtime
# module, defining
#   const soundor::<abi>::embedded::ModuleCode soundor::<abi>::embedded::<symbol>
# (src/modules/Embedded.h): its bytecode, compiled by soundor_compile_js under
# the module name <name>, or its source where the build cannot compile it.
function(soundor_embed_module target symbol input name)
  set(script "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/SoundorEmbedModule.cmake")
  get_filename_component(input "${input}" ABSOLUTE)
  set(directory "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded")
  set(output "${directory}/${symbol}.cpp")
  soundor_precompiles_js(precompile)
  if(precompile)
    set(compiled "${directory}/${symbol}.qjsbc")
    add_custom_command(
      OUTPUT "${compiled}"
      COMMAND soundor_compile_js "${input}" "${compiled}" "${name}"
      DEPENDS "${input}" soundor_compile_js
      COMMENT "Compiling ${input}"
      VERBATIM)
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
# to bytecode where the build can: "bundle.js" is embedded as
# "bundle.js.qjsbc", which the runtime reads instead (ResourceModuleLoader).
function(soundor_embed_ui target function directory)
  set(script "${CMAKE_CURRENT_FUNCTION_LIST_DIR}/SoundorEmbedDirectory.cmake")
  get_filename_component(directory "${directory}" ABSOLUTE)
  file(GLOB_RECURSE files CONFIGURE_DEPENDS LIST_DIRECTORIES false RELATIVE "${directory}" "${directory}/*")
  set(output "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded/${function}.cpp")
  set(compiledDirectory "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded/${function}")
  set(inputs "")
  set(compiled "")
  soundor_precompiles_js(precompile)
  foreach(file IN LISTS files)
    list(APPEND inputs "${directory}/${file}")
    if(precompile AND file MATCHES "\\.m?js$")
      set(bytecode "${compiledDirectory}/${file}.qjsbc")
      get_filename_component(bytecodeDirectory "${bytecode}" DIRECTORY)
      add_custom_command(
        OUTPUT "${bytecode}"
        COMMAND ${CMAKE_COMMAND} -E make_directory "${bytecodeDirectory}"
        COMMAND soundor_compile_js "${directory}/${file}" "${bytecode}" "/${file}"
        DEPENDS "${directory}/${file}" soundor_compile_js
        COMMENT "Compiling ${file}"
        VERBATIM)
      list(APPEND compiled "${bytecode}")
    endif()
  endforeach()
  if(NOT precompile)
    set(compiledDirectory "")
  endif()
  add_custom_command(
    OUTPUT "${output}"
    COMMAND ${CMAKE_COMMAND} -DDIRECTORY=${directory} -DCOMPILED=${compiledDirectory} -DOUTPUT=${output}
            -DFUNCTION=${function} -P "${script}"
    DEPENDS ${inputs} ${compiled} "${script}"
    COMMENT "Embedding ${directory}"
    VERBATIM)
  target_sources(${target} PRIVATE "${output}")
  set_source_files_properties("${output}" PROPERTIES SKIP_LINTING ON) # generated
endfunction()
