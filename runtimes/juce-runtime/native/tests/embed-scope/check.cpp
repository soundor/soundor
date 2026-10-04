#include <soundor/platform/Resources.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::embedded
{
    std::span<const platform::EmbeddedFile> consumerUi();
}

// Fails to compile if the embedded table is missing or empty.
int checkEmbedded()
{
    return static_cast<int>(soundor::embedded::consumerUi().size());
}
