# What each native dependency needs from the platform when it is linked: the
# same for a source build (the dependency modules) and a prebuilt engine
# (SoundorEnginePrebuilt.cmake), which links the same archives.

include_guard(GLOBAL)

find_package(Threads REQUIRED)

if(IOS)
  set(SOUNDOR_RUNTIME_SYSTEM_LIBRARIES "-framework UIKit" Threads::Threads)
elseif(APPLE)
  set(SOUNDOR_RUNTIME_SYSTEM_LIBRARIES "-framework AppKit" "-framework CoreGraphics" Threads::Threads)
elseif(WIN32)
  # crypto.getRandomValues, native UI Automation, per-HWND subclassing and
  # fetch() (WinHTTP).
  set(SOUNDOR_RUNTIME_SYSTEM_LIBRARIES bcrypt winhttp uiautomationcore ole32 oleaut32 user32 comctl32 imm32 Threads::Threads)
else()
  set(SOUNDOR_RUNTIME_SYSTEM_LIBRARIES Threads::Threads)
  if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    find_package(PkgConfig REQUIRED)
    if(NOT TARGET PkgConfig::SOUNDOR_GIO)
      pkg_check_modules(SOUNDOR_GIO REQUIRED IMPORTED_TARGET GLOBAL gio-2.0)
    endif()
    list(APPEND SOUNDOR_RUNTIME_SYSTEM_LIBRARIES PkgConfig::SOUNDOR_GIO)
  endif()
endif()

set(SOUNDOR_HERMES_SYSTEM_LIBRARIES Threads::Threads ${CMAKE_DL_LIBS})
if(APPLE)
  list(APPEND SOUNDOR_HERMES_SYSTEM_LIBRARIES "-framework CoreFoundation" "-framework Foundation")
endif()

if(APPLE)
  set(SOUNDOR_SKIA_SYSTEM_LIBRARIES
    "-framework CoreFoundation" "-framework CoreGraphics" "-framework CoreText" "-framework ImageIO")
elseif(WIN32)
  set(SOUNDOR_SKIA_SYSTEM_LIBRARIES dwrite usp10 fontsub user32 ole32 oleaut32)
else()
  find_package(PkgConfig REQUIRED)
  if(NOT TARGET PkgConfig::SOUNDOR_FONTS)
    pkg_check_modules(SOUNDOR_FONTS REQUIRED IMPORTED_TARGET GLOBAL fontconfig freetype2)
  endif()
  set(SOUNDOR_SKIA_SYSTEM_LIBRARIES PkgConfig::SOUNDOR_FONTS ${CMAKE_DL_LIBS})
endif()

# ANGLE's headers declare everything, extensions included, without dllimport
# or default visibility.
set(SOUNDOR_ANGLE_DEFINITIONS KHRONOS_STATIC ANGLE_EXPORT= GL_GLEXT_PROTOTYPES=1 EGL_EGLEXT_PROTOTYPES=1)
