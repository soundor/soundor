#pragma once

// ANGLE's EGL and OpenGL ES headers: included only in src/gpu (and tests).
// ANGLE is linked statically and hidden (see cmake/SoundorAngle.cmake).

// EGL's headers include <windows.h>: without its min and max macros.
#if defined(_WIN32)
    #ifndef NOMINMAX
        #define NOMINMAX
    #endif
    #ifndef WIN32_LEAN_AND_MEAN
        #define WIN32_LEAN_AND_MEAN
    #endif
#endif

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <EGL/eglext_angle.h>
#include <GLES3/gl3.h>
// clang-format off: gl2ext.h needs gl3.h first.
#include <GLES2/gl2ext.h>
#include <GLES2/gl2ext_angle.h>
// clang-format on
