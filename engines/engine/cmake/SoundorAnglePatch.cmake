# cmake -DSOURCE=<ANGLE checkout> -P SoundorAnglePatch.cmake
#
# Soundor's changes to ANGLE, applied by SoundorAngleBuild.cmake after the
# checkout. Each one fails the build if ANGLE's code no longer matches, so an
# ANGLE update has to look at it again.
#
# Display::terminate: join the worker pools before the backend terminates.
# Upstream joins them after, but the Vulkan backend's terminate destroys the
# VkInstance, and the Vulkan loader then unloads the driver. A worker that
# made Vulkan calls (pipeline compilation, for one) then exits with the driver
# gone and runs its thread-exit destructors in unmapped code: Mesa's Venus
# driver crashes there on every eglTerminate. Joining first also keeps a
# worker from running while the backend's device is destroyed; queued tasks
# are aborted, as they would be a few lines later.

file(READ "${SOURCE}/src/libANGLE/Display.cpp" content)
set(upstream [=[
    mImplementation->terminate();

    mMemoryProgramCache.clear();
    mMemoryShaderCache.clear();
    mBlobCache.setBlobCacheFuncs(nullptr, nullptr);

    mState.singleThreadPool.reset();
    mState.multiThreadPool.reset();
]=])
set(patched [=[
    // Soundor: the workers are joined before the backend terminates (see
    // SoundorAnglePatch.cmake).
    mState.singleThreadPool.reset();
    mState.multiThreadPool.reset();

    mImplementation->terminate();

    mMemoryProgramCache.clear();
    mMemoryShaderCache.clear();
    mBlobCache.setBlobCacheFuncs(nullptr, nullptr);
]=])
string(FIND "${content}" "${upstream}" found)
if(found EQUAL -1)
  string(FIND "${content}" "${patched}" already)
  if(already EQUAL -1)
    message(FATAL_ERROR "src/libANGLE/Display.cpp: Display::terminate changed; update SoundorAnglePatch.cmake")
  endif()
else()
  string(REPLACE "${upstream}" "${patched}" content "${content}")
  file(WRITE "${SOURCE}/src/libANGLE/Display.cpp" "${content}")
endif()

# XCB presentation only: keep GLX and Xlib GPU discovery disabled. Both would
# add mandatory X11 dependencies and are unnecessary for Vulkan presentation.
function(soundor_angle_replace file before after)
  file(READ "${SOURCE}/${file}" content)
  string(FIND "${content}" "${before}" found)
  if(found EQUAL -1)
    string(FIND "${content}" "${after}" already)
    if(already EQUAL -1)
      message(FATAL_ERROR "${file}: XCB presentation changed; update SoundorAnglePatch.cmake")
    endif()
    return()
  endif()
  string(REPLACE "${before}" "${after}" content "${content}")
  file(WRITE "${SOURCE}/${file}" "${content}")
endfunction()

soundor_angle_replace(src/libANGLE/renderer/vulkan/vulkan_backend.gni
  "if (angle_use_x11) {" "if (angle_use_x11 || is_linux) {")
soundor_angle_replace(src/libANGLE/Display.cpp
  "#        if defined(ANGLE_USE_X11)\n            if (platformType == EGL_PLATFORM_X11_EXT && rx::IsVulkanXcbDisplayAvailable())"
  "#        if defined(ANGLE_USE_X11) || defined(SOUNDOR_ANGLE_USE_XCB)\n            if (platformType == EGL_PLATFORM_X11_EXT && rx::IsVulkanXcbDisplayAvailable())")

file(COPY_FILE "${CMAKE_CURRENT_LIST_DIR}/angle/XcbLoader.h" "${SOURCE}/src/common/soundor_xcb.h")
foreach(file DisplayVkXcb.cpp WindowSurfaceVkXcb.cpp)
  set(path "src/libANGLE/renderer/vulkan/linux/xcb/${file}")
  file(READ "${SOURCE}/${path}" content)
  if(NOT content MATCHES "common/soundor_xcb.h")
    string(REPLACE "namespace rx\n{" "#include \"common/soundor_xcb.h\"\n\nnamespace rx\n{" content "${content}")
    string(REGEX REPLACE "xcb_([a-z_]+)\\(" "soundor_angle::xcb().\\1(" content "${content}")
    file(WRITE "${SOURCE}/${path}" "${content}")
  endif()
endforeach()
soundor_angle_replace(src/libANGLE/renderer/vulkan/linux/xcb/DisplayVkXcb.cpp
  "mHasXDisplay = !angle::GetEnvironmentVar(\"DISPLAY\").empty();"
  "mHasXDisplay = soundor_angle::xcb().available && !angle::GetEnvironmentVar(\"DISPLAY\").empty();")
