#pragma once

#include <soundor/a11y/Platform.h>

#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    // Soundor's iOS bridge: virtual UIAccessibilityElements for the semantic
    // tree, in the UIView the surface is drawn in. See apple/README.md.
    [[nodiscard]] std::unique_ptr<PlatformAccessibility> createIosPlatform(const PlatformOptions& options);

    // Tests: present the tree as if VoiceOver were on.
    void forceIosAccessibility(bool on);

    // The Objective-C class of Soundor's elements in this binary.
    [[nodiscard]] std::string iosElementClassName();
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
