# Compiler policy for Soundor-owned native code. Third-party targets
# (soundor_quickjs, test frameworks) never receive these options.

include_guard(GLOBAL)

option(SOUNDOR_WARNINGS_AS_ERRORS "Treat warnings in Soundor-owned code as errors" OFF)
option(SOUNDOR_ENABLE_SANITIZERS "Build Soundor native code and tests with ASan + UBSan" OFF)
option(SOUNDOR_ENABLE_CLANG_TIDY "Run clang-tidy while compiling Soundor-owned code" OFF)

if(SOUNDOR_ENABLE_CLANG_TIDY)
  find_program(SOUNDOR_CLANG_TIDY_EXE NAMES clang-tidy-18 clang-tidy)
  if(NOT SOUNDOR_CLANG_TIDY_EXE)
    # CI must lint; a developer machine without clang-tidy (e.g. stock Xcode)
    # still builds, with the gap reported.
    if(DEFINED ENV{CI})
      message(FATAL_ERROR "SOUNDOR_ENABLE_CLANG_TIDY is ON but clang-tidy was not found")
    endif()
    message(WARNING "clang-tidy not found; building without static analysis")
    set(SOUNDOR_ENABLE_CLANG_TIDY OFF)
  endif()
endif()

# Sanitizers must instrument every object in the final binary, QuickJS included,
# so they are applied directory-wide rather than per target.
if(SOUNDOR_ENABLE_SANITIZERS)
  if(MSVC)
    add_compile_options(/fsanitize=address)
  else()
    add_compile_options(-fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer)
    add_link_options(-fsanitize=address,undefined -fno-sanitize-recover=all)
  endif()
endif()

# Applies the warning set, hidden visibility and optional clang-tidy to a target
# whose sources Soundor owns.
function(soundor_configure_target target)
  set_target_properties(${target} PROPERTIES
    CXX_EXTENSIONS OFF
    CXX_VISIBILITY_PRESET hidden
    VISIBILITY_INLINES_HIDDEN ON
    POSITION_INDEPENDENT_CODE ON)

  if(MSVC)
    target_compile_options(${target} PRIVATE /W4 /permissive- /utf-8)
    if(SOUNDOR_WARNINGS_AS_ERRORS)
      target_compile_options(${target} PRIVATE /WX)
    endif()
  else()
    target_compile_options(${target} PRIVATE
      -Wall
      -Wextra
      -Wpedantic
      -Wshadow
      -Wconversion
      -Wsign-conversion
      -Wnon-virtual-dtor
      -Wold-style-cast
      -Woverloaded-virtual
      -Wnull-dereference
      -Wimplicit-fallthrough
      # Options structs are filled with designated initializers that rely on
      # default member initializers; Clang < 19 flags every omitted field.
      -Wno-missing-field-initializers)
    if(SOUNDOR_WARNINGS_AS_ERRORS)
      target_compile_options(${target} PRIVATE -Werror)
    endif()
  endif()

  if(SOUNDOR_ENABLE_CLANG_TIDY)
    set_target_properties(${target} PROPERTIES CXX_CLANG_TIDY "${SOUNDOR_CLANG_TIDY_EXE}")
  endif()
endfunction()
