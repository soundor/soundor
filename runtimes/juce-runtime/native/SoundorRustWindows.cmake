# A Rust Windows staticlib also contains short import records. Objcopy cannot
# process those, so replace only COFF object members that mention the symbol.
# Let the archiver rebuild the library's symbol indexes and preserve its imports.
cmake_minimum_required(VERSION 3.22)

function(run)
  execute_process(COMMAND ${ARGV} WORKING_DIRECTORY "${work}"
    RESULT_VARIABLE status ERROR_VARIABLE error)
  if(NOT status EQUAL 0)
    message(FATAL_ERROR "Rust symbol isolation failed: ${error}")
  endif()
endfunction()

set(work "${OUTPUT}.objects")
file(REMOVE_RECURSE "${work}")
file(MAKE_DIRECTORY "${work}")
run("${AR}" x "${INPUT}")
file(GLOB members "${work}/*")
set(replacements "")
foreach(member IN LISTS members)
  # AMD64/ARM64 COFF objects, or bigobj (version 2); short import objects
  # instead start with 0000ffff0000 and must remain byte-for-byte intact.
  file(READ "${member}" header LIMIT 8 HEX)
  if(NOT header MATCHES "^(6486|64aa|0000ffff0200)")
    continue()
  endif()
  file(STRINGS "${member}" references REGEX "rust_eh_personality" LIMIT_COUNT 1)
  if(NOT references)
    continue()
  endif()
  run("${OBJCOPY}"
    --redefine-sym rust_eh_personality=soundor_processor_rust_eh_personality
    "${member}")
  # LLVM response files use backslash escapes, including in quoted paths.
  string(REPLACE "\\" "/" member "${member}")
  string(APPEND replacements "\"${member}\"\n")
endforeach()
file(COPY_FILE "${INPUT}" "${OUTPUT}")
if(replacements)
  file(WRITE "${work}/replace.rsp" "${replacements}")
  run("${AR}" r "${OUTPUT}" "@${work}/replace.rsp")
endif()
file(REMOVE_RECURSE "${work}")
