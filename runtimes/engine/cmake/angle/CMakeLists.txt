# Compiles ANGLE as one static library, with the toolchain CMake is given.
#
#   cmake -S cmake/angle -B <build> -DANGLE_TARGETS=<targets.cmake> ...
#
# ANGLE_TARGETS is written by targets.py from gn's view of the build: what to
# compile, with which defines and include paths. Everything else is decided
# here: everything is hidden (ANGLE_EXPORT and KHRONOS_APICALL expand to
# nothing), position-independent and optimized, and warnings are ANGLE's
# business, not the plugin's.

cmake_minimum_required(VERSION 3.22)
project(SoundorAngle LANGUAGES C CXX)
if(APPLE)
  enable_language(OBJC OBJCXX)
endif()

if(NOT ANGLE_TARGETS)
  message(FATAL_ERROR "ANGLE_TARGETS is required")
endif()

set(CMAKE_C_STANDARD 11)
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(CMAKE_OBJCXX_STANDARD 20)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
foreach(language C CXX OBJC OBJCXX)
  set(CMAKE_${language}_VISIBILITY_PRESET hidden)
endforeach()
set(CMAKE_VISIBILITY_INLINES_HIDDEN ON)

if(MSVC)
  set(angle_common_options /W0 /utf-8 /bigobj /Zc:__cplusplus /permissive- /EHsc /MP)
else()
  set(angle_common_options -w)
endif()

set(angle_objects "")
function(angle_target name)
  cmake_parse_arguments(PARSE_ARGV 1 arg "" "" "SOURCES;DEFINES;INCLUDES;FLAGS")
  add_library(${name} OBJECT ${arg_SOURCES})
  target_compile_definitions(${name} PRIVATE ${arg_DEFINES} NDEBUG ANGLE_EXPORT= KHRONOS_STATIC)
  target_include_directories(${name} PRIVATE ${arg_INCLUDES})
  target_compile_options(${name} PRIVATE ${angle_common_options} ${arg_FLAGS})
  set(angle_objects ${angle_objects} $<TARGET_OBJECTS:${name}> PARENT_SCOPE)
endfunction()

include(${ANGLE_TARGETS})

add_library(angle STATIC ${angle_objects})
install(TARGETS angle ARCHIVE DESTINATION lib)
