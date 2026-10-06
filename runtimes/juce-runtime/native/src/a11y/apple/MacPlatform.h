#pragma once

#include <soundor/a11y/Platform.h>

#include <memory>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
{
    // Soundor's macOS bridge: virtual NSAccessibilityElements for the semantic
    // tree, in the NSView the surface is drawn in. See apple/README.md.
    [[nodiscard]] std::unique_ptr<PlatformAccessibility> createMacPlatform(const PlatformOptions& options);

    // Tests: present the tree as if VoiceOver were on.
    void forceMacAccessibility(bool on);

    // The Objective-C class of Soundor's elements in this binary, by name
    // (registered at runtime, under a name no other binary uses).
    [[nodiscard]] std::string macElementClassName();
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::a11y::detail
