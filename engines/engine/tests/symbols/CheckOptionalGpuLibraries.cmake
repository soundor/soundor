# An offline audio host must load the plugin without a display stack installed.
execute_process(COMMAND "${READELF}" -d "${LIBRARY}"
  OUTPUT_VARIABLE dynamic RESULT_VARIABLE result)
if(NOT result EQUAL 0)
  message(FATAL_ERROR "Could not inspect ${LIBRARY}")
endif()
if(dynamic MATCHES "Shared library: \\[lib(X11|Xext|xcb[^.]*|EGL|GL[^.]*|vulkan|wayland[^.]*)\\.")
  message(FATAL_ERROR "The engine acquired a mandatory display/GPU dependency:\n${dynamic}")
endif()
