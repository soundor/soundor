# cmake -DHERMESC=<hermesc> -DINPUT=<module.js> -DOUTPUT=<bytecode> -DNAME=<module name>
#       -DREVISION=<Hermes revision> [-DFLAGS=<hermesc options>] -P SoundorCompileJs.cmake
#
# Compiles a module (in the runtime's module form, native/README.md "Modules") to Hermes
# bytecode for the VM of the same Hermes build: NAME, the name the runtime
# loads it under ("/bundle.js", "soundor:ui"), is the file name its stack
# traces show (a sourceURL comment), and the bytecode ends with an epilogue
# naming REVISION, which the runtime checks (src/js/Bytecode.h). The bytecode
# keeps line and column numbers, not the source text, and always has the
# checks that let the runtime stop it at its time limit (whatever FLAGS
# says). Fails, saying why, when the module does not compile.

foreach(required HERMESC INPUT OUTPUT NAME REVISION)
  if(NOT DEFINED ${required} OR "${${required}}" STREQUAL "")
    message(FATAL_ERROR "SoundorCompileJs.cmake: ${required} is required")
  endif()
endforeach()
if(NOT EXISTS "${HERMESC}")
  message(FATAL_ERROR "hermesc not found at ${HERMESC}: configure the build again (its Hermes build is gone)")
endif()
if(NOT DEFINED FLAGS)
  set(FLAGS "-O -fno-inline")
endif()
separate_arguments(flags NATIVE_COMMAND "${FLAGS}")

get_filename_component(directory "${OUTPUT}" DIRECTORY)
file(MAKE_DIRECTORY "${directory}")
file(READ "${INPUT}" source)
set(named "${OUTPUT}.js")
file(WRITE "${named}" "${source}\n//# sourceURL=${NAME}\n")
execute_process(
  COMMAND "${HERMESC}" ${flags} -emit-async-break-check -Wno-undefined-variable -emit-binary "-out=${OUTPUT}.tmp"
          "${named}"
  RESULT_VARIABLE status
  OUTPUT_VARIABLE output
  ERROR_VARIABLE output)
file(REMOVE "${named}")
if(NOT status EQUAL 0)
  file(REMOVE "${OUTPUT}.tmp")
  message(FATAL_ERROR "Compiling ${INPUT} (${NAME}) failed:\n${output}")
endif()
file(APPEND "${OUTPUT}.tmp" "\nsoundor-hermes ${REVISION}\n")
file(RENAME "${OUTPUT}.tmp" "${OUTPUT}")
