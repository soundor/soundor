cmake_minimum_required(VERSION 3.22)
# Fails when two of ARCHIVES define the same C symbol. Linked into one plugin,
# the linker keeps one of them and every caller gets that one, whichever
# library it was built with (or the link fails, once both are needed). Hidden
# visibility does not help: it only keeps a symbol out of the plugin's exports.
#
#   cmake -DARCHIVES=<a;b;...> -DNM=<nm> -DAPPLE=<bool> -P CheckSharedDefinitions.cmake
#
# C++ names are left out: the same inline function or template instantiation
# in two archives is what the linker merges by design.
if(APPLE)
  set(nm_args -g -U)
else()
  set(nm_args -g --defined-only)
endif()

set(duplicates "")
foreach(archive IN LISTS ARCHIVES)
  execute_process(
    COMMAND ${NM} ${nm_args} ${archive}
    OUTPUT_VARIABLE output
    ERROR_QUIET
    RESULT_VARIABLE status)
  if(NOT status EQUAL 0)
    message(FATAL_ERROR "${NM} failed on ${archive}")
  endif()
  get_filename_component(name "${archive}" NAME)
  # One definition per line: "<address> <type> <symbol>". Strong definitions
  # only (code, data, bss, read-only); weak and common ones are merged.
  string(REGEX MATCHALL "[0-9a-fA-F]+ [TDBRS] [^\n]+" lines "${output}")
  set(symbols "")
  foreach(line IN LISTS lines)
    string(REGEX REPLACE "^[0-9a-fA-F]+ . " "" symbol "${line}")
    # Mach-O names carry one extra leading underscore (C++ ones start "__Z").
    # One only: REGEX REPLACE would strip "^_" again after each match.
    if(APPLE AND symbol MATCHES "^_(.*)$")
      set(symbol "${CMAKE_MATCH_1}")
    endif()
    if(symbol MATCHES "^_Z")
      continue()
    endif()
    list(APPEND symbols "${symbol}")
  endforeach()
  list(REMOVE_DUPLICATES symbols)
  foreach(symbol IN LISTS symbols)
    string(MAKE_C_IDENTIFIER "${symbol}" key)
    if(DEFINED defined_in_${key})
      list(APPEND duplicates "${symbol} (${defined_in_${key}}, ${name})")
    else()
      set(defined_in_${key} "${name}")
    endif()
  endforeach()
endforeach()

if(duplicates)
  list(LENGTH duplicates count)
  list(SORT duplicates)
  list(JOIN duplicates "\n  " report)
  message(FATAL_ERROR "${count} C symbols defined in more than one archive:\n  ${report}")
endif()
message(STATUS "No C symbol is defined in more than one of: ${ARCHIVES}")
