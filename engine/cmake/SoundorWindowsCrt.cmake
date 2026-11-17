# Which C runtime a Windows build links, from CMAKE_MSVC_RUNTIME_LIBRARY, as
# everything linked into a plugin has to agree on it:
#
#   DLL (CMake's default)  /MD, /MDd  dependency flavours md, mdd; archives debug, release
#   static                 /MT, /MTd  dependency flavours mt, mtd; archives debug-static, release-static
#
# Skia, ANGLE and Hermes are built for the two flavours of the one in use. The
# JUCE runtime sets it from juceRuntime({ windows: { crt } }).

include_guard(GLOBAL)

set(SOUNDOR_WINDOWS_STATIC_CRT OFF)
set(SOUNDOR_WINDOWS_CRT_RELEASE md)
set(SOUNDOR_WINDOWS_CRT_DEBUG mdd)
# Added to an archive's variant: its name, and what its metadata says.
set(SOUNDOR_WINDOWS_CRT_SUFFIX "")
if(WIN32 AND CMAKE_MSVC_RUNTIME_LIBRARY AND NOT CMAKE_MSVC_RUNTIME_LIBRARY MATCHES "DLL")
  set(SOUNDOR_WINDOWS_STATIC_CRT ON)
  set(SOUNDOR_WINDOWS_CRT_RELEASE mt)
  set(SOUNDOR_WINDOWS_CRT_DEBUG mtd)
  set(SOUNDOR_WINDOWS_CRT_SUFFIX "-static")
endif()
