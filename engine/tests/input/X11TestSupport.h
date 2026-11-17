#pragma once

// doctest before X11: X.h's `None` macro would rename doctest's Color::None.
// clang-format off
#include <doctest/doctest.h>

#include <X11/X.h>
#include <X11/XF86keysym.h>
#include <X11/Xlib.h>
#include <X11/Xutil.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
// clang-format on
