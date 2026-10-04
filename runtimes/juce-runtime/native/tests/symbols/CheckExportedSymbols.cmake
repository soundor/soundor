cmake_minimum_required(VERSION 3.22)

# Fails when LIBRARY exports any defined symbol other than those in ALLOWED.
#
#   cmake -DLIBRARY=<path> -DNM=<nm> -DAPPLE=<bool> -DALLOWED=<a;b> -P CheckExportedSymbols.cmake

if(APPLE)
  set(nm_args -g -U -j)
else()
  set(nm_args -D --defined-only --format=just-symbols)
endif()

execute_process(
  COMMAND ${NM} ${nm_args} ${LIBRARY}
  OUTPUT_VARIABLE output
  RESULT_VARIABLE status)
if(NOT status EQUAL 0)
  message(FATAL_ERROR "${NM} failed on ${LIBRARY}")
endif()

string(REPLACE "\n" ";" symbols "${output}")
set(unexpected "")
foreach(symbol IN LISTS symbols)
  string(STRIP "${symbol}" symbol)
  # Mach-O prefixes every symbol with one extra underscore. (Not REGEX REPLACE
  # "^_": it re-anchors after each match and strips every leading underscore.)
  set(bare "${symbol}")
  if(APPLE AND symbol MATCHES "^_")
    string(SUBSTRING "${symbol}" 1 -1 bare)
  endif()
  if(symbol STREQUAL "" OR bare IN_LIST ALLOWED)
    continue()
  endif()
  # Toolchain-provided ELF section markers, not code.
  if(bare MATCHES "^(_init|_fini|_edata|_end|__bss_start)$")
    continue()
  endif()
  # Standard-library template instantiations (std::, __gnu_cxx::, their
  # typeinfo/vtables). The standard headers force default visibility on them,
  # so every C++ shared object exports them; they are identical in every binary
  # built against the same standard library and cannot collide meaningfully.
  # Narrowing those is a job for the final plugin link (an export list).
  if(bare MATCHES "^_Z(Z?N?K?|T[ISV]N?)(St|9__gnu_cxx)")
    continue()
  endif()
  list(APPEND unexpected "${symbol}")
endforeach()

if(unexpected)
  list(JOIN unexpected "\n  " report)
  message(FATAL_ERROR "Unexpected exported symbols in ${LIBRARY}:\n  ${report}")
endif()
message(STATUS "Only allowed symbols are exported from ${LIBRARY}")
