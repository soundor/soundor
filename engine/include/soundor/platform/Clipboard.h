#pragma once

#include <soundor/Abi.h>
#include <soundor/ui/Surface.h>

#include <memory>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    // The system's plain-text clipboard. Created and used on the UI thread.
    // Returns null where no desktop clipboard is available (e.g. headless Linux).
    [[nodiscard]] std::shared_ptr<ui::Clipboard> systemClipboard();
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
