# Finishes the bundles of a plugin made with
# juce_add_plugin(<target> ... VST3_AUTO_MANIFEST FALSE), so nothing changes a
# bundle after it is signed.
#
# soundor_finalize_plugin(<target>) appends to the POST_BUILD steps of each
# format target:
#   1. VST3: write moduleinfo.json (juce_enable_vst3_manifest_step);
#   2. macOS: sign the bundle with SOUNDOR_MACOS_SIGNING_IDENTITY, then verify
#      the signature, so a broken one fails the build rather than a host scan.
#
# JUCE writes the manifest after its own ad-hoc signature, which seals the
# bundle without it (soundor/soundor#63); signing last fixes that. The
# generated setup.cmake defers the call to the end of the project's
# CMakeLists.txt, so steps a project adds itself also run before signing.

include_guard(GLOBAL)

set(SOUNDOR_MACOS_SIGNING_IDENTITY "-" CACHE STRING
  "codesign identity for macOS bundles: a certificate name or SHA-1 hash; '-' signs ad-hoc")
set(SOUNDOR_MACOS_KEYCHAIN "" CACHE FILEPATH
  "A keychain codesign searches for SOUNDOR_MACOS_SIGNING_IDENTITY")

function(soundor_finalize_plugin target)
  if(TARGET ${target}_VST3)
    juce_enable_vst3_manifest_step(${target})
  endif()

  if(NOT APPLE)
    return()
  endif()

  set(sign --force --sign "${SOUNDOR_MACOS_SIGNING_IDENTITY}")
  if(SOUNDOR_MACOS_KEYCHAIN)
    list(APPEND sign --keychain "${SOUNDOR_MACOS_KEYCHAIN}")
  endif()
  if(NOT SOUNDOR_MACOS_SIGNING_IDENTITY STREQUAL "-")
    # Notarization requires the hardened runtime and a secure timestamp.
    list(APPEND sign --options runtime --timestamp)
  endif()

  get_target_property(format_targets ${target} JUCE_ACTIVE_PLUGIN_TARGETS)
  foreach(format_target IN LISTS format_targets)
    get_target_property(artefact ${format_target} JUCE_PLUGIN_ARTEFACT_FILE)
    if(NOT artefact)
      continue()
    endif()
    add_custom_command(TARGET ${format_target} POST_BUILD
      COMMAND codesign ${sign} "${artefact}"
      COMMAND codesign --verify --deep --strict "${artefact}"
      COMMENT "Signing ${format_target} (${SOUNDOR_MACOS_SIGNING_IDENTITY})"
      VERBATIM)
  endforeach()
endfunction()
