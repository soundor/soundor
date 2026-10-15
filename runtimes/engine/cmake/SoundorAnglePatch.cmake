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
  return()
endif()
string(REPLACE "${upstream}" "${patched}" content "${content}")
file(WRITE "${SOURCE}/src/libANGLE/Display.cpp" "${content}")
