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
