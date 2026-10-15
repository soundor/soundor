#include <soundor/js/Value.h>

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
{
    namespace
    {
        // ECMAScript Number::toString: the shortest digits that round-trip,
        // laid out in fixed notation for exponents in [-7, 21) and in
        // exponential notation otherwise.
        std::string formatNumber(double number)
        {
            if (std::isnan(number))
                return "NaN";
            if (number == 0)
                return "0";
            if (std::isinf(number))
                return number > 0 ? "Infinity" : "-Infinity";

            // Shortest "d.ddde±x" that round-trips.
            char buffer[40];
            for (int precision = 0; precision <= 16; ++precision)
            {
                std::snprintf(buffer, sizeof buffer, "%.*e", precision, number);
                if (std::strtod(buffer, nullptr) == number)
                    break;
            }
            std::string text(buffer);
            std::string sign;
            if (text.front() == '-')
            {
                sign = "-";
                text.erase(0, 1);
            }
            const auto exponentAt = text.find('e');
            const int exponent = std::stoi(text.substr(exponentAt + 1));
            std::string digits = text.substr(0, exponentAt);
            digits.erase(std::remove(digits.begin(), digits.end(), '.'), digits.end());
            while (digits.size() > 1 && digits.back() == '0')
                digits.pop_back();

            const int k = static_cast<int>(digits.size());
            const int n = exponent + 1; // position of the decimal point
            if (k <= n && n <= 21)
                return sign + digits + std::string(static_cast<std::size_t>(n - k), '0');
            if (0 < n && n <= 21)
                return sign + digits.substr(0, static_cast<std::size_t>(n)) + "."
                       + digits.substr(static_cast<std::size_t>(n));
            if (-6 < n && n <= 0)
                return sign + "0." + std::string(static_cast<std::size_t>(-n), '0') + digits;
            const std::string mantissa = k == 1 ? digits : digits.substr(0, 1) + "." + digits.substr(1);
            return sign + mantissa + "e" + (n - 1 >= 0 ? "+" : "-") + std::to_string(std::abs(n - 1));
        }
    } // namespace

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
                return formatNumber(asNumber());
            case Type::String:
            case Type::Other:
                return asString();
        }
        return {};
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::js
