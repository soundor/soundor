#pragma once

// ANGLE's EGL and OpenGL ES headers: included only in src/gpu (and tests).
// ANGLE is linked statically and hidden (see cmake/SoundorAngle.cmake).

#include <EGL/egl.h>
#include <EGL/eglext.h>
#include <EGL/eglext_angle.h>
#include <GLES3/gl3.h>
// clang-format off: gl2ext.h needs gl3.h first.
#include <GLES2/gl2ext.h>
#include <GLES2/gl2ext_angle.h>
// clang-format on
