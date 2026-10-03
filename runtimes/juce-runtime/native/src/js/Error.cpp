#include <soundor/js/Error.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    std::string Error::toString() const
    {
        if (name.empty())
            return message;
        if (message.empty())
            return name;
        return name + ": " + message;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
