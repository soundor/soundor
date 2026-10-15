# `cmake -P Namespace.cmake`: the ABI namespace of engine versions
# (cmake/SoundorAbi.cmake).
include("${CMAKE_CURRENT_LIST_DIR}/../../cmake/SoundorAbi.cmake")
foreach(case "0.1.0=v0_1_0" "0.2.1=v0_2_1" "12.30.4=v12_30_4" "1.0.0-beta.1=v1_0_0_p2d626574612e31"
             "1.0.0+build=v1_0_0_p2b6275696c64")
  string(REPLACE "=" ";" case "${case}")
  list(GET case 0 version)
  list(GET case 1 expected)
  soundor_abi_namespace("${version}" actual)
  if(NOT actual STREQUAL expected)
    message(FATAL_ERROR "Engine ${version}: namespace ${actual}, expected ${expected}")
  endif()
endforeach()
message(STATUS "Engine ABI namespaces follow their versions")
