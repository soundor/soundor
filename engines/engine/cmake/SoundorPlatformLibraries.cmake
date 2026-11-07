# What each native dependency needs from the platform when it is linked: the
# same for a source build (the dependency modules) and a prebuilt engine
# (SoundorEnginePrebuilt.cmake), which links the same archives.

include_guard(GLOBAL)

find_package(Threads REQUIRED)

if(IOS)
  set(SOUNDOR_RUNTIME_SYSTEM_LIBRARIES "-framework UIKit" Threads::Threads)
elseif(APPLE)
  set(SOUNDOR_RUNTIME_SYSTEM_LIBRARIES "-framework AppKit" Threads::Threads)
elseif(WIN32)
  set(SOUNDOR_RUNTIME_SYSTEM_LIBRARIES bcrypt Threads::Threads) # crypto.getRandomValues
else()
  set(SOUNDOR_RUNTIME_SYSTEM_LIBRARIES Threads::Threads)
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

if(WIN32)
  # The libraries the Rust standard library and UI Automation need; comctl32
  # for the window subclass Soundor installs.
  set(SOUNDOR_ACCESSKIT_SYSTEM_LIBRARIES
    bcrypt ntdll propsys runtimeobject uiautomationcore userenv ws2_32 comctl32)
else()
  # The archive's symbols have default visibility: hide every one of them
  # in whatever shared library links it. A flag in the link line (not a
  # link option) so it reaches the plugin through static libraries.
  set(SOUNDOR_ACCESSKIT_SYSTEM_LIBRARIES "-Wl,--exclude-libs,libaccesskit.a" m ${CMAKE_DL_LIBS} Threads::Threads)
  if(ANDROID)
    list(APPEND SOUNDOR_ACCESSKIT_SYSTEM_LIBRARIES android log)
  endif()
endif()
