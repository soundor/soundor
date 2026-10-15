cmake_minimum_required(VERSION 3.25)
project(SoundorEngineAbiChecks LANGUAGES CXX)
# The configuration the engine archive was built in: matching consumers are
# compiled in it, and a consumer of the other configuration must not link.
if(NOT ENGINE_CONFIG)
  set(ENGINE_CONFIG Debug)
endif()
set(CMAKE_TRY_COMPILE_CONFIGURATION ${ENGINE_CONFIG})
file(READ "${ENGINE_ABI_HEADER}" header)
file(MAKE_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/matching/soundor" "${CMAKE_CURRENT_BINARY_DIR}/wrong/soundor")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/matching/soundor/Abi.h" "${header}")
string(REPLACE "#define SOUNDOR_ABI_NAMESPACE " "#define SOUNDOR_ABI_NAMESPACE incompatible_" wrong_header "${header}")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/wrong/soundor/Abi.h" "${wrong_header}")
file(WRITE "${CMAKE_CURRENT_BINARY_DIR}/consumer.cpp"
  "#include <soundor/Abi.h>\nint main() { soundor::requireEngineAbi(static_cast<soundor::EngineAbi*>(nullptr)); }\n")
foreach(case matching namespace configuration features)
  set(include "${CMAKE_CURRENT_BINARY_DIR}/matching")
  set(definitions -DSOUNDOR_DEVTOOLS=${ENGINE_DEVTOOLS})
  if(case STREQUAL namespace)
    set(include "${CMAKE_CURRENT_BINARY_DIR}/wrong")
  elseif(case STREQUAL configuration AND ENGINE_CONFIG STREQUAL "Debug")
    list(APPEND definitions -DNDEBUG)
  elseif(case STREQUAL configuration)
    list(APPEND definitions -UNDEBUG)
  elseif(case STREQUAL features)
    if(ENGINE_DEVTOOLS)
      set(definitions -DSOUNDOR_DEVTOOLS=0)
    else()
      set(definitions -DSOUNDOR_DEVTOOLS=1)
    endif()
  endif()
  try_compile(linked "${CMAKE_CURRENT_BINARY_DIR}/${case}-build"
    SOURCES "${CMAKE_CURRENT_BINARY_DIR}/consumer.cpp"
    CMAKE_FLAGS "-DINCLUDE_DIRECTORIES=${include}" "-DCMAKE_CXX_STANDARD=20" "-DCMAKE_BUILD_TYPE=${ENGINE_CONFIG}"
    COMPILE_DEFINITIONS ${definitions}
    LINK_LIBRARIES "${ENGINE_ARCHIVE}"
    OUTPUT_VARIABLE output)
  if(case STREQUAL matching AND NOT linked)
    message(FATAL_ERROR "Matching engine ABI did not link:\n${output}")
  elseif(NOT case STREQUAL matching AND linked)
    message(FATAL_ERROR "Incompatible ${case} ABI linked successfully")
  endif()
endforeach()
