# Builds the Hermes that Soundor runs JavaScript with and installs it into OUT.
#
#   cmake -DOUT=<dir> -DREVISION=<sha> -DSHA256=<archive hash> -DFILES=<cmake/hermes>
#         [-DUNICODE_REVISION=<sha> -DUNICODE_SHA256=<hash>]   (Linux)
#         [-DCC=<c compiler> -DCXX=<c++ compiler>] [-DGENERATOR=<name>]
#         [-DOSX_ARCHITECTURES=<a;b>] [-DOSX_DEPLOYMENT_TARGET=<version>]
#         [-DMSVC_RUNTIME=<MultiThreaded...>] [-DLTO=ON] -P SoundorHermesBuild.cmake
#
# Hermes is fetched as GitHub's archive of REVISION (verified by SHA256),
# patched (SoundorHermesPatch.cmake) and built in Release by its own CMake,
# through cmake/hermes/CMakeLists.txt: the interpreter only (no JIT, no
# debugger or inspector, no Intl), hidden symbols, position-independent.
# On Linux, Unicode comes from QuickJS-NG's tables (UNICODE_*), not ICU.
# OUT gets:
#
#   include/            hermes/hermes.h, hermes/SoundorHermes.h,
#                       hermes/Public/, jsi/
#   lib/full/           the VM with its compiler: evaluates source and bytecode
#   lib/lean/           the VM alone: bytecode only
#   lib/*/libraries.txt their static libraries, in link order
#   system.txt          the system libraries they need
#   bin/hermesc         the bytecode compiler (a build tool, never shipped)
#   hermes.txt          the revision and bytecode version
#
# OUT appears only once the build succeeded (built aside, then renamed).

cmake_minimum_required(VERSION 3.22)

foreach(required OUT REVISION SHA256 FILES)
  if(NOT DEFINED ${required} OR "${${required}}" STREQUAL "")
    message(FATAL_ERROR "SoundorHermesBuild.cmake: ${required} is required")
  endif()
endforeach()

set(work "${OUT}.partial")
file(REMOVE_RECURSE "${work}")
file(MAKE_DIRECTORY "${work}")

function(run)
  execute_process(COMMAND ${ARGN} RESULT_VARIABLE status)
  if(NOT status EQUAL 0)
    list(JOIN ARGN " " command)
    message(FATAL_ERROR "Building Hermes failed: ${command}")
  endif()
endfunction()

# Downloads and extracts a pinned GitHub archive; sets <out> to its directory.
function(fetch out repository revision sha256)
  string(REPLACE "/" "-" name "${repository}")
  set(archive "${work}/${name}.tar.gz")
  message(STATUS "Hermes: fetching ${repository} ${revision}")
  file(DOWNLOAD "https://github.com/${repository}/archive/${revision}.tar.gz" "${archive}"
    EXPECTED_HASH "SHA256=${sha256}" STATUS status TLS_VERIFY ON)
  list(GET status 0 code)
  if(NOT code EQUAL 0)
    list(GET status 1 reason)
    message(FATAL_ERROR "Downloading ${repository} ${revision} failed: ${reason}")
  endif()
  file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${work}/${name}")
  file(GLOB directory LIST_DIRECTORIES true "${work}/${name}/*")
  set(${out} "${directory}" PARENT_SCOPE)
endfunction()

fetch(source facebook/hermes "${REVISION}" "${SHA256}")
set(unicode OFF)
set(unicode_source "")
if(DEFINED UNICODE_REVISION AND NOT UNICODE_REVISION STREQUAL "")
  set(unicode ON)
  fetch(unicode_source quickjs-ng/quickjs "${UNICODE_REVISION}" "${UNICODE_SHA256}")
endif()

run(${CMAKE_COMMAND} -DSOURCE=${source} -DFILES=${FILES} -DUNICODE=${unicode}
    -P "${CMAKE_CURRENT_LIST_DIR}/SoundorHermesPatch.cmake")

set(build "${work}/build")
set(configure
  -S "${FILES}" -B "${build}"
  -DCMAKE_BUILD_TYPE=Release
  "-DHERMES_SOURCE=${source}"
  "-DSOUNDOR_UNICODE_SOURCE=${unicode_source}")
if(DEFINED GENERATOR AND NOT GENERATOR STREQUAL "")
  list(APPEND configure -G "${GENERATOR}")
endif()
if(DEFINED CC AND NOT CC STREQUAL "")
  list(APPEND configure "-DCMAKE_C_COMPILER=${CC}" "-DCMAKE_CXX_COMPILER=${CXX}")
endif()
if(DEFINED OSX_ARCHITECTURES AND NOT OSX_ARCHITECTURES STREQUAL "")
  # A list cannot cross execute_process() as one argument (run() splits it:
  # Hermes was built for the first architecture only), so it goes in an
  # initial cache instead.
  file(WRITE "${work}/architectures.cmake" "set(CMAKE_OSX_ARCHITECTURES \"${OSX_ARCHITECTURES}\" CACHE STRING \"\")\n")
  list(APPEND configure -C "${work}/architectures.cmake")
endif()
if(DEFINED OSX_DEPLOYMENT_TARGET AND NOT OSX_DEPLOYMENT_TARGET STREQUAL "")
  list(APPEND configure "-DCMAKE_OSX_DEPLOYMENT_TARGET=${OSX_DEPLOYMENT_TARGET}")
endif()
if(LTO)
  list(APPEND configure -DCMAKE_INTERPROCEDURAL_OPTIMIZATION=ON -DCMAKE_POLICY_DEFAULT_CMP0069=NEW)
  # Archives of bitcode need an archiver that reads it: llvm-ar, or GNU ar
  # with LLVM's plugin.
  if(NOT WIN32)
    find_program(lto_ar NAMES llvm-ar llvm-ar-18 ar)
    find_program(lto_ranlib NAMES llvm-ranlib llvm-ranlib-18 ranlib)
    list(APPEND configure "-DCMAKE_C_COMPILER_AR=${lto_ar}" "-DCMAKE_CXX_COMPILER_AR=${lto_ar}"
         "-DCMAKE_C_COMPILER_RANLIB=${lto_ranlib}" "-DCMAKE_CXX_COMPILER_RANLIB=${lto_ranlib}")
  endif()
endif()
if(DEFINED MSVC_RUNTIME AND NOT MSVC_RUNTIME STREQUAL "")
  list(APPEND configure -DCMAKE_POLICY_DEFAULT_CMP0091=NEW "-DCMAKE_MSVC_RUNTIME_LIBRARY=${MSVC_RUNTIME}")
endif()
message(STATUS "Hermes: configuring")
run(${CMAKE_COMMAND} ${configure})
message(STATUS "Hermes: building (once per machine; several minutes)")
run(${CMAKE_COMMAND} --build "${build}" --config Release --target hermesvm hermesvmlean hermesc)

set(stage "${work}/out")
file(MAKE_DIRECTORY "${stage}/include/hermes/Public" "${stage}/include/jsi" "${stage}/bin")
file(COPY "${source}/API/hermes/hermes.h" "${source}/API/hermes/SoundorHermes.h"
     DESTINATION "${stage}/include/hermes")
file(GLOB public_headers "${source}/public/hermes/Public/*.h")
file(COPY ${public_headers} DESTINATION "${stage}/include/hermes/Public")
file(GLOB jsi_headers "${source}/API/jsi/jsi/*.h")
file(COPY ${jsi_headers} DESTINATION "${stage}/include/jsi")
file(COPY "${source}/LICENSE" DESTINATION "${stage}")

foreach(variant full lean)
  file(STRINGS "${build}/soundor-${variant}.txt" libraries)
  file(MAKE_DIRECTORY "${stage}/lib/${variant}")
  set(names "")
  foreach(library IN LISTS libraries)
    get_filename_component(name "${library}" NAME)
    if(name IN_LIST names)
      message(FATAL_ERROR "Two Hermes libraries are named ${name}")
    endif()
    file(COPY "${library}" DESTINATION "${stage}/lib/${variant}")
    list(APPEND names "${name}")
  endforeach()
  list(JOIN names "\n" names)
  file(WRITE "${stage}/lib/${variant}/libraries.txt" "${names}\n")
endforeach()
file(COPY_FILE "${build}/soundor-system.txt" "${stage}/system.txt")

file(STRINGS "${build}/soundor-hermesc.txt" hermesc)
file(COPY "${hermesc}" DESTINATION "${stage}/bin")
get_filename_component(hermesc_name "${hermesc}" NAME)
execute_process(COMMAND "${stage}/bin/${hermesc_name}" -version OUTPUT_VARIABLE version RESULT_VARIABLE status)
string(REGEX MATCH "HBC bytecode version: ([0-9]+)" found "${version}")
if(NOT status EQUAL 0 OR NOT found)
  message(FATAL_ERROR "hermesc does not report its bytecode version:\n${version}")
endif()
file(WRITE "${stage}/hermes.txt" "revision ${REVISION}\nbytecode ${CMAKE_MATCH_1}\n")

file(REMOVE_RECURSE "${OUT}")
file(RENAME "${stage}" "${OUT}")
file(REMOVE_RECURSE "${work}")
message(STATUS "Hermes: installed into ${OUT}")
