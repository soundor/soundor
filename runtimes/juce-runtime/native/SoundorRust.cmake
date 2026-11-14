# The plugin's Rust processor (its native/ crate, compiled by soundor dev and
# soundor build into a static library), linked into a target.
#
# A Rust static library carries Rust's standard library and compiler
# builtins, and so does AccessKit's (the engine's accessibility on Linux and
# Windows): linked side by side, their symbols collide. On Linux the
# processor is linked into one relocatable object first, and every symbol
# but its C ABI (soundor_processor_*) made local, so that it shares nothing
# with any other library, in this plugin or in another one in the process.
include_guard(GLOBAL)

function(soundor_link_rust_processor target library)
  if(NOT library)
    message(FATAL_ERROR "soundor_link_rust_processor: no library to link")
  endif()
  if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    if(NOT CMAKE_OBJCOPY)
      find_program(CMAKE_OBJCOPY NAMES objcopy llvm-objcopy REQUIRED)
    endif()
    set(object "${CMAKE_CURRENT_BINARY_DIR}/${target}_rust_processor.o")
    add_custom_command(OUTPUT "${object}"
      COMMAND "${CMAKE_LINKER}" -r --whole-archive "${library}" -o "${object}"
      # A release ships no debug information (Rust's standard library has it).
      COMMAND "${CMAKE_OBJCOPY}" --wildcard "--keep-global-symbol=soundor_processor_*"
        "$<$<NOT:$<CONFIG:Debug>>:--strip-debug>" "${object}"
      DEPENDS "${library}"
      COMMENT "Isolating the Rust processor's symbols"
      COMMAND_EXPAND_LISTS
      VERBATIM)
    add_custom_target(${target}_rust_processor DEPENDS "${object}")
    add_dependencies(${target} ${target}_rust_processor)
    target_link_libraries(${target} PRIVATE "${object}")
    find_package(Threads REQUIRED)
    # What Rust's standard library needs from the platform.
    target_link_libraries(${target} PRIVATE Threads::Threads ${CMAKE_DL_LIBS} m rt util)
  elseif(WIN32)
    target_link_libraries(${target} PRIVATE "${library}" kernel32 advapi32 ntdll userenv ws2_32 dbghelp bcrypt)
    # Rust links the release C runtime (static with /MT, as soundor builds
    # it); a Debug target links the debug one.
    if(MSVC)
      target_link_options(${target} PUBLIC
        $<$<CONFIG:Debug>:/NODEFAULTLIB:libcmt.lib> $<$<CONFIG:Debug>:/NODEFAULTLIB:msvcrt.lib>)
    endif()
  else()
    target_link_libraries(${target} PRIVATE "${library}")
  endif()
endfunction()
