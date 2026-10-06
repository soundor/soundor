# Builds Soundor's iOS accessibility bridge, with the platform-independent
# a11y code it needs, for iOS: there is no iOS plugin build to carry it yet,
# so this keeps it compiling. Run by the soundor_ios_bridge_builds test on
# macOS (configured with CMAKE_SYSTEM_NAME=iOS).
cmake_minimum_required(VERSION 3.22)
project(SoundorIosBridge LANGUAGES C CXX OBJCXX)

if(NOT IOS)
  message(FATAL_ERROR "configure this project for iOS (-DCMAKE_SYSTEM_NAME=iOS)")
endif()

set(native "${SOUNDOR_NATIVE_DIR}")
add_library(soundor_ios_a11y STATIC
  ${native}/src/a11y/Platform.cpp
  ${native}/src/a11y/PlatformSupport.cpp
  ${native}/src/a11y/Semantics.cpp
  ${native}/src/a11y/apple/AppleShared.mm
  ${native}/src/a11y/apple/IosPlatform.mm)
target_include_directories(soundor_ios_a11y PRIVATE ${native}/include ${native}/src)
target_compile_definitions(soundor_ios_a11y PRIVATE SOUNDOR_ABI_NAMESPACE=p_ios SOUNDOR_HAS_ACCESSKIT=0)
set_target_properties(soundor_ios_a11y PROPERTIES
  CXX_STANDARD 20 CXX_STANDARD_REQUIRED ON OBJCXX_STANDARD 20 OBJCXX_STANDARD_REQUIRED ON
  CXX_VISIBILITY_PRESET hidden OBJCXX_VISIBILITY_PRESET hidden)
target_compile_options(soundor_ios_a11y PRIVATE -Wall -Wextra -Werror $<$<COMPILE_LANGUAGE:OBJCXX>:-fobjc-arc>)
