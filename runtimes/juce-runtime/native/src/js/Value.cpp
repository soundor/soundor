#include <soundor/js/Value.h>

#include <cmath>
#include <cstdio>
#include <cstdlib>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    bool Value::asBoolean() const noexcept
    {
        const auto* value = std::get_if<bool>(&storage);
        return value != nullptr && *value;
    }

    double Value::asNumber() const noexcept
    {
        const auto* value = std::get_if<double>(&storage);
        return value != nullptr ? *value : std::nan("");
    }

    const std::string& Value::asString() const noexcept
    {
        static const std::string empty;
        if (const auto* value = std::get_if<std::string>(&storage))
            return *value;
        if (const auto* description = std::get_if<Description>(&storage))
            return description->text;
        return empty;
    }

    std::string Value::toString() const
    {
        switch (type())
        {
            case Type::Undefined:
                return "undefined";
            case Type::Null:
                return "null";
            case Type::Boolean:
                return asBoolean() ? "true" : "false";
            case Type::Number:
            {
                const double number = asNumber();
                if (std::isnan(number))
                    return "NaN";
                if (std::isinf(number))
                    return number > 0 ? "Infinity" : "-Infinity";
                // Shortest precision that round-trips, like JavaScript.
                char buffer[32];
                for (int precision = 1; precision <= 17; ++precision)
                {
                    std::snprintf(buffer, sizeof buffer, "%.*g", precision, number);
                    if (std::strtod(buffer, nullptr) == number)
                        break;
                }
                return buffer;
            }
            case Type::String:
            case Type::Other:
                return asString();
        }
        return {};
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
