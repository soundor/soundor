# cmake -DLIBRARY=<engine archive> -DNM=<nm> -P CheckNoDevTools.cmake
# An engine built without DevTools has none of its code: no inspector, no
# diagnostics overlay.
execute_process(COMMAND "${NM}" -C "${LIBRARY}" OUTPUT_VARIABLE symbols ERROR_QUIET RESULT_VARIABLE status)
if(NOT status EQUAL 0)
  message(FATAL_ERROR "${NM} could not read ${LIBRARY}")
endif()
string(REGEX MATCHALL "[^\n]*::debug::(Inspector|Diagnostics)[^\n]*|[^\n]*::DebugOverlay[^\n]*" found "${symbols}")
if(found)
  list(SUBLIST found 0 5 found)
  list(JOIN found "\n" found)
  message(FATAL_ERROR "The engine has DevTools code although it was built without DevTools:\n${found}")
endif()
message(STATUS "No DevTools code in ${LIBRARY}")
