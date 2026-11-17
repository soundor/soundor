# The engine's platform-independent core: the UI node tree, its Yoga layout,
# styles, text layout and animations. It needs Yoga and the C++ standard
# library only (no Hermes, Skia, ANGLE or platform APIs), so the same sources
# are compiled into the native runtime (SoundorEngineSource.cmake) and into
# the WebAssembly engine (wasm/CMakeLists.txt). Paths are relative to the
# engine's directory.
#
# A build without Skia adds src/render/NoVectorScene.cpp, where the native
# runtime has src/render/VectorScene.cpp: SVG scenes are drawn with Skia.

include_guard(GLOBAL)

set(SOUNDOR_CORE_SOURCES
  src/render/Frame.cpp
  src/ui/Animation.cpp
  src/ui/Color.cpp
  src/ui/StyleReader.cpp
  src/ui/Surface.cpp
  src/ui/Text.cpp)
