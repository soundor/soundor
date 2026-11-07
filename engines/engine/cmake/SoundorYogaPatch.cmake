# cmake -DSOURCE=<Yoga checkout> -P SoundorYogaPatch.cmake
#
# Soundor's changes to Yoga, applied after the download. Each one fails the
# build if Yoga's code no longer matches, so a Yoga update has to look at it
# again.
#
# YGMacros.h: Yoga marks its C API visibility("default") outside MSVC, which
# would export every YG* function from a plugin binary. Soundor links Yoga
# privately into each plugin, so the API stays hidden like the rest of the
# runtime.
#
# CalculateLayout.cpp, measureNodeWithFixedSize: Yoga sizes a box that fits
# its content into no space (zero or less) to its padding and border alone,
# without measuring its content. With a pixel of space it measures it, so a
# button in a container squeezed to zero lost its label, while browsers lay
# it out at its content's size. The shortcut is removed, so the content is
# always measured; it stays for a box whose size is fixed in both axes, which
# does not depend on its content. Yoga's own tests pass with the change.

function(soundor_yoga_patch file upstream patched)
  file(READ "${SOURCE}/${file}" content)
  string(FIND "${content}" "${upstream}" found)
  if(found EQUAL -1)
    string(FIND "${content}" "${patched}" already)
    if(already EQUAL -1)
      message(FATAL_ERROR "${file}: code not found; update SoundorYogaPatch.cmake")
    endif()
    return()
  endif()
  string(REPLACE "${upstream}" "${patched}" content "${content}")
  file(WRITE "${SOURCE}/${file}" "${content}")
endfunction()

soundor_yoga_patch(yoga/YGMacros.h
  "#define YG_EXPORT __attribute__((visibility(\"default\")))"
  "#define YG_EXPORT /* hidden by Soundor */")

soundor_yoga_patch(yoga/algorithm/CalculateLayout.cpp [=[
  if ((yoga::isDefined(availableWidth) &&
       widthSizingMode == SizingMode::FitContent && availableWidth <= 0.0f) ||
      (yoga::isDefined(availableHeight) &&
       heightSizingMode == SizingMode::FitContent && availableHeight <= 0.0f) ||
      (widthSizingMode == SizingMode::StretchFit &&
       heightSizingMode == SizingMode::StretchFit)) {]=] [=[
  // Soundor: a box with no room still measures its content (see
  // SoundorYogaPatch.cmake).
  if (widthSizingMode == SizingMode::StretchFit &&
      heightSizingMode == SizingMode::StretchFit) {]=])
