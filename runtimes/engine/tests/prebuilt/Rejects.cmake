# cmake -DENGINE=<engine package> -DARCHIVE=<extracted prebuilt> -DVARIANT=<debug|release>
#       -DGENERATOR=<generator> -DWORK=<scratch directory> -P Rejects.cmake
#
# A prebuilt engine is checked before anything links it: a copy of ARCHIVE's
# soundor-engine.json, with its libraries as empty files (configuring only
# checks that they exist), configures; each wrong copy fails, saying why.

cmake_minimum_required(VERSION 3.22)
file(READ "${ARCHIVE}/soundor-engine.json" original)
string(TOUPPER "${VARIANT}" upper)
if(VARIANT STREQUAL "debug")
  set(config Debug)
  set(other release)
else()
  set(config Release)
  set(other debug)
endif()
string(JSON os GET "${original}" target os)
if(os STREQUAL "linux")
  set(wrong_os windows)
else()
  set(wrong_os linux)
endif()

# <name>|<expected message, - for success>|<member path, dot separated>|<JSON value>
set(cases
  "valid|-|-|-"
  "format|reads format 1|format|2"
  "version|is for @soundor/engine 9.9.9|engine.version|\"9.9.9\""
  "namespace|is for ABI namespace v9_9_9|engine.abiNamespace|\"v9_9_9\""
  "variant|is for the variant ${other}|variant|\"${other}\""
  "hermes|is for Hermes 0000|hermes.revision|\"0000\""
  "platform|is for the platform ${wrong_os}|target.os|\"${wrong_os}\""
  "architecture|has no|target.architectures|[\"riscv64\"]"
  "missing|is incomplete|link.engine.1|\"lib/missing.a\"")

function(touch path)
  get_filename_component(directory "${path}" DIRECTORY)
  file(MAKE_DIRECTORY "${directory}")
  file(TOUCH "${path}")
endfunction()

set(failures 0)
foreach(case IN LISTS cases)
  string(REPLACE "|" ";" fields "${case}")
  list(GET fields 0 name)
  list(GET fields 1 expected)
  list(GET fields 2 path)
  list(GET fields 3 value)
  set(json "${original}")
  if(NOT path STREQUAL "-")
    string(REPLACE "." ";" path "${path}")
    string(JSON json SET "${json}" ${path} "${value}")
  endif()

  set(fake "${WORK}/${name}/archive")
  file(REMOVE_RECURSE "${WORK}/${name}")
  file(MAKE_DIRECTORY "${fake}")
  file(WRITE "${fake}/soundor-engine.json" "${json}")
  foreach(group engine hermes skia angle accessKit)
    string(JSON count LENGTH "${original}" link ${group})
    if(count GREATER 0)
      math(EXPR last "${count} - 1")
      foreach(index RANGE ${last})
        string(JSON file GET "${original}" link ${group} ${index})
        touch("${fake}/${file}")
      endforeach()
    endif()
  endforeach()
  string(JSON compiler GET "${original}" hermes compiler)
  touch("${fake}/${compiler}")
  foreach(directory hermes/include angle/include accesskit/include)
    file(MAKE_DIRECTORY "${fake}/${directory}")
  endforeach()

  execute_process(
    COMMAND ${CMAKE_COMMAND} -S "${ENGINE}" -B "${WORK}/${name}/build" -G "${GENERATOR}"
            -DCMAKE_BUILD_TYPE=${config} -DSOUNDOR_BUILD_TESTS=OFF
            "-DSOUNDOR_ENGINE_PREBUILT_${upper}_DIR=${fake}"
    RESULT_VARIABLE status
    OUTPUT_VARIABLE output
    ERROR_VARIABLE output)
  if(expected STREQUAL "-")
    if(NOT status EQUAL 0)
      message(SEND_ERROR "The unchanged prebuilt engine was rejected:\n${output}")
      math(EXPR failures "${failures} + 1")
    endif()
  elseif(status EQUAL 0)
    message(SEND_ERROR "A prebuilt engine with the wrong ${name} was accepted")
    math(EXPR failures "${failures} + 1")
  else()
    string(REPLACE "\n" " " flat "${output}")
    string(REGEX REPLACE " +" " " flat "${flat}")
    string(FIND "${flat}" "${expected}" found)
    if(found EQUAL -1)
      message(SEND_ERROR "A prebuilt engine with the wrong ${name} failed without saying \"${expected}\":\n${output}")
      math(EXPR failures "${failures} + 1")
    endif()
  endif()
  file(REMOVE_RECURSE "${WORK}/${name}")
endforeach()
if(failures EQUAL 0)
  message(STATUS "Wrong prebuilt engines are rejected")
endif()
