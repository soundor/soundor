# Embeds text files (the JavaScript of runtime-provided modules) into C++.
#
# soundor_embed_text(<target> <symbol> <input>) compiles a source defining
#   const std::string_view soundor::<abi>::embedded::<symbol>
# with the contents of <input>, regenerated whenever <input> changes.

include_guard(GLOBAL)

set(SOUNDOR_EMBED_SCRIPT "${CMAKE_CURRENT_LIST_DIR}/SoundorEmbedText.cmake")

function(soundor_embed_text target symbol input)
  get_filename_component(input "${input}" ABSOLUTE)
  set(output "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded/${symbol}.cpp")
  add_custom_command(
    OUTPUT "${output}"
    COMMAND ${CMAKE_COMMAND} -DINPUT=${input} -DOUTPUT=${output} -DSYMBOL=${symbol} -P "${SOUNDOR_EMBED_SCRIPT}"
    DEPENDS "${input}" "${SOUNDOR_EMBED_SCRIPT}"
    COMMENT "Embedding ${input}"
    VERBATIM)
  target_sources(${target} PRIVATE "${output}")
endfunction()

# soundor_embed_directory(<target> <function> <directory>) compiles every file
# under <directory> into <target> and defines
#   std::span<const soundor::<abi>::platform::EmbeddedFile>
#   soundor::<abi>::embedded::<function>()
# listing them by relative path. Regenerated when files are added, removed or
# changed.

set(SOUNDOR_EMBED_DIRECTORY_SCRIPT "${CMAKE_CURRENT_LIST_DIR}/SoundorEmbedDirectory.cmake")

function(soundor_embed_directory target function directory)
  get_filename_component(directory "${directory}" ABSOLUTE)
  file(GLOB_RECURSE files CONFIGURE_DEPENDS LIST_DIRECTORIES false "${directory}/*")
  set(output "${CMAKE_CURRENT_BINARY_DIR}/soundor-embedded/${function}.cpp")
  add_custom_command(
    OUTPUT "${output}"
    COMMAND ${CMAKE_COMMAND} -DDIRECTORY=${directory} -DOUTPUT=${output} -DFUNCTION=${function}
            -P "${SOUNDOR_EMBED_DIRECTORY_SCRIPT}"
    DEPENDS ${files} "${SOUNDOR_EMBED_DIRECTORY_SCRIPT}"
    COMMENT "Embedding ${directory}"
    VERBATIM)
  target_sources(${target} PRIVATE "${output}")
endfunction()
