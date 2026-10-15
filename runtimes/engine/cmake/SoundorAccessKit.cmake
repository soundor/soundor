# AccessKit (accesskit-c) as the private imported target `soundor_accesskit`:
# what presents Soundor's semantic tree to Windows (UI Automation) and Linux
# (AT-SPI). Not used on Apple platforms, which have Soundor's own bridge.
#
# The library is the official prebuilt one, from the accesskit-c release
# archive (pinned, SHA-256 verified): building it needs Rust, which Soundor
# does not ask plugin developers to install. The archive is downloaded once
# per machine into Soundor's cache directory (SOUNDOR_CACHE), and only this
# platform's static library and the header are kept.
#
# Releases ship static libraries for Windows (x64, arm64; MSVC), Linux x64 and
# Android, but not Linux arm64: there, and wherever SOUNDOR_ACCESSKIT is OFF,
# the runtime builds without platform accessibility (SOUNDOR_HAS_ACCESSKIT 0).
#
#   SOUNDOR_ACCESSKIT       use AccessKit where a prebuilt library exists (ON)
#   SOUNDOR_ACCESSKIT_DIR   an extracted accesskit-c release to use instead
#
# The library is linked PRIVATE and its symbols are kept out of a plugin's
# exports (--exclude-libs on ELF platforms; Windows exports nothing unasked).
# accesskit.h is only included by src/a11y/accesskit/.

include_guard(GLOBAL)

include(${CMAKE_CURRENT_LIST_DIR}/SoundorDependencies.cmake)

option(SOUNDOR_ACCESSKIT "Present accessibility through AccessKit on Windows and Linux" ON)
set(SOUNDOR_ACCESSKIT_DIR "" CACHE PATH "An extracted accesskit-c release; empty: download the pinned one")

set(SOUNDOR_HAS_ACCESSKIT OFF)
set(soundor_accesskit_platform "")
string(TOLOWER "${CMAKE_SYSTEM_PROCESSOR}" soundor_accesskit_cpu)
if(SOUNDOR_ACCESSKIT AND NOT APPLE)
  if(WIN32 AND MSVC)
    if(CMAKE_VS_PLATFORM_NAME)
      string(TOLOWER "${CMAKE_VS_PLATFORM_NAME}" soundor_accesskit_cpu)
    endif()
    if(soundor_accesskit_cpu MATCHES "^(x64|amd64|x86_64)$")
      set(soundor_accesskit_platform "windows/x86_64/msvc")
    elseif(soundor_accesskit_cpu MATCHES "^(arm64|aarch64)$")
      set(soundor_accesskit_platform "windows/arm64/msvc")
    endif()
  elseif(ANDROID AND ANDROID_ABI MATCHES "^(arm64-v8a|x86_64)$")
    set(soundor_accesskit_platform "android/${ANDROID_ABI}")
  elseif(CMAKE_SYSTEM_NAME STREQUAL "Linux" AND soundor_accesskit_cpu MATCHES "^(x86_64|amd64)$")
    set(soundor_accesskit_platform "linux/x86_64")
  endif()
endif()

if(soundor_accesskit_platform)
  if(NOT SOUNDOR_ACCESSKIT_DIR)
    soundor_cache_root(cache_root)
    string(REPLACE "/" "-" platform_name "${soundor_accesskit_platform}")
    set(SOUNDOR_ACCESSKIT_DIR "${cache_root}/accesskit-c-${SOUNDOR_ACCESSKIT_VERSION}-${platform_name}")
    if(NOT EXISTS "${SOUNDOR_ACCESSKIT_DIR}/include/accesskit.h")
      file(MAKE_DIRECTORY "${cache_root}")
      file(LOCK "${SOUNDOR_ACCESSKIT_DIR}.lock" GUARD PROCESS TIMEOUT 1800)
      if(NOT EXISTS "${SOUNDOR_ACCESSKIT_DIR}/include/accesskit.h")
        set(archive "${cache_root}/accesskit-c-${SOUNDOR_ACCESSKIT_VERSION}.zip")
        if(NOT EXISTS "${archive}")
          message(STATUS "Downloading accesskit-c ${SOUNDOR_ACCESSKIT_VERSION} (once per machine)")
          file(DOWNLOAD "${SOUNDOR_ACCESSKIT_URL}" "${archive}.part"
            EXPECTED_HASH SHA256=${SOUNDOR_ACCESSKIT_SHA256}
            STATUS status)
          list(GET status 0 code)
          if(NOT code EQUAL 0)
            file(REMOVE "${archive}.part")
            message(FATAL_ERROR "Downloading accesskit-c failed: ${status}")
          endif()
          file(RENAME "${archive}.part" "${archive}")
        endif()
        file(SHA256 "${archive}" hash)
        if(NOT hash STREQUAL SOUNDOR_ACCESSKIT_SHA256)
          file(REMOVE "${archive}")
          message(FATAL_ERROR "${archive} does not match its pinned SHA-256; removed it, configure again")
        endif()
        set(staging "${SOUNDOR_ACCESSKIT_DIR}.staging")
        file(REMOVE_RECURSE "${staging}")
        set(root "accesskit-c-${SOUNDOR_ACCESSKIT_VERSION}")
        file(ARCHIVE_EXTRACT INPUT "${archive}" DESTINATION "${staging}"
          PATTERNS "${root}/include/*" "${root}/lib/${soundor_accesskit_platform}/static/*"
                   "${root}/LICENSE-MIT" "${root}/LICENSE-APACHE" "${root}/LICENSE.chromium")
        file(REMOVE_RECURSE "${SOUNDOR_ACCESSKIT_DIR}")
        file(RENAME "${staging}/${root}" "${SOUNDOR_ACCESSKIT_DIR}")
        file(REMOVE_RECURSE "${staging}")
        # Only one platform is kept from the archive: the next platform
        # extracts it again rather than downloading it.
      endif()
      file(LOCK "${SOUNDOR_ACCESSKIT_DIR}.lock" RELEASE)
    endif()
  endif()

  if(WIN32)
    set(soundor_accesskit_library "${SOUNDOR_ACCESSKIT_DIR}/lib/${soundor_accesskit_platform}/static/accesskit.lib")
  else()
    set(soundor_accesskit_library "${SOUNDOR_ACCESSKIT_DIR}/lib/${soundor_accesskit_platform}/static/libaccesskit.a")
  endif()
  if(NOT EXISTS "${soundor_accesskit_library}" OR NOT EXISTS "${SOUNDOR_ACCESSKIT_DIR}/include/accesskit.h")
    message(FATAL_ERROR "SOUNDOR_ACCESSKIT_DIR (${SOUNDOR_ACCESSKIT_DIR}) has no AccessKit for ${soundor_accesskit_platform}")
  endif()

  add_library(soundor_accesskit STATIC IMPORTED GLOBAL)
  set_target_properties(soundor_accesskit PROPERTIES IMPORTED_LOCATION "${soundor_accesskit_library}")
  # A system include: the header is AccessKit's, not Soundor's to lint.
  target_include_directories(soundor_accesskit SYSTEM INTERFACE "${SOUNDOR_ACCESSKIT_DIR}/include")
  if(WIN32)
    # The libraries the Rust standard library and UI Automation need; comctl32
    # for the window subclass Soundor installs.
    target_link_libraries(soundor_accesskit INTERFACE
      bcrypt ntdll propsys runtimeobject uiautomationcore userenv ws2_32 comctl32)
  else()
    # The archive's symbols have default visibility: hide every one of them
    # in whatever shared library links it. A flag in the link line (not a
    # link option) so it reaches the plugin through static libraries.
    target_link_libraries(soundor_accesskit INTERFACE
      "-Wl,--exclude-libs,libaccesskit.a" m ${CMAKE_DL_LIBS} Threads::Threads)
    if(ANDROID)
      target_link_libraries(soundor_accesskit INTERFACE android log)
    endif()
  endif()
  set(SOUNDOR_HAS_ACCESSKIT ON)
elseif(SOUNDOR_ACCESSKIT AND NOT APPLE)
  message(STATUS "No prebuilt AccessKit for ${CMAKE_SYSTEM_NAME} ${CMAKE_SYSTEM_PROCESSOR}: building without platform accessibility")
endif()
