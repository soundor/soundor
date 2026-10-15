# The engine's C++ ABI identity: the inline namespace every symbol is mangled
# into, derived from the exact @soundor/engine package version (0.2.1 ->
# v0_2_1). Consumers cannot choose a different one.

# soundor_abi_namespace(<version> <out>): the namespace of <version>.
# Prerelease and build suffixes are hex-encoded (injective), not punctuation
# replaced: 1.0.0-beta.1 -> v1_0_0_p2d626574612e31.
function(soundor_abi_namespace version out)
  if(NOT version MATCHES "^([0-9]+)[.]([0-9]+)[.]([0-9]+)(.*)$")
    message(FATAL_ERROR "Invalid engine package version: ${version}")
  endif()
  set(namespace "v${CMAKE_MATCH_1}_${CMAKE_MATCH_2}_${CMAKE_MATCH_3}")
  # An empty group leaves CMAKE_MATCH_4 undefined: compare its quoted value.
  set(suffix "${CMAKE_MATCH_4}")
  if(NOT "${suffix}" STREQUAL "")
    string(HEX "${suffix}" suffix)
    string(APPEND namespace "_p${suffix}")
  endif()
  set(${out} "${namespace}" PARENT_SCOPE)
endfunction()

if(CMAKE_SCRIPT_MODE_FILE)
  return() # included by a script for soundor_abi_namespace() alone (tests/abi/Namespace.cmake)
endif()
if(DEFINED SOUNDOR_ABI_NAMESPACE)
  message(FATAL_ERROR "SOUNDOR_ABI_NAMESPACE is owned by @soundor/engine; remove the consumer override (or delete a build directory created by an older runtime)")
endif()
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_LIST_DIR}/../package.json")
file(READ "${CMAKE_CURRENT_LIST_DIR}/../package.json" soundor_package)
string(JSON SOUNDOR_ENGINE_VERSION GET "${soundor_package}" version)
soundor_abi_namespace("${SOUNDOR_ENGINE_VERSION}" SOUNDOR_ABI_NAMESPACE)
configure_file("${CMAKE_CURRENT_LIST_DIR}/SoundorAbi.h.in" "${CMAKE_CURRENT_BINARY_DIR}/generated/soundor/Abi.h" @ONLY)
