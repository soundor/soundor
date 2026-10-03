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
