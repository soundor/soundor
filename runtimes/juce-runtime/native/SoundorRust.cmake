# The plugin's lib/ crate, built by Cargo into a static library.
# Plugin export controls keep its Rust runtime private, like the C++ engine:
# --exclude-libs,ALL and the VST3 version script on Linux, explicit exports
# on Windows, and hidden symbols on macOS. No archive symbol rewriting is needed.
include_guard(GLOBAL)

function(soundor_link_rust_processor target library)
  if(NOT library)
    message(FATAL_ERROR "soundor_link_rust_processor: no library to link")
  endif()
  target_link_libraries(${target} PRIVATE "${library}")
  if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    find_package(Threads REQUIRED)
    target_link_libraries(${target} PRIVATE Threads::Threads ${CMAKE_DL_LIBS} m rt util)
    # Rust's precompiled standard library carries debug sections even when
    # the processor is built without them. Release plugins ship none.
    target_link_options(${target} PUBLIC $<$<CONFIG:Release>:-Wl,--strip-debug>)
  elseif(WIN32)
    target_link_libraries(${target} PRIVATE kernel32 advapi32 ntdll userenv ws2_32 dbghelp bcrypt)
    # Rust links the release C runtime (static with /MT, as soundor builds
    # it); a Debug target links the debug one.
    if(MSVC)
      target_link_options(${target} PUBLIC
        $<$<CONFIG:Debug>:/NODEFAULTLIB:libcmt.lib> $<$<CONFIG:Debug>:/NODEFAULTLIB:msvcrt.lib>)
    endif()
  endif()
endfunction()
