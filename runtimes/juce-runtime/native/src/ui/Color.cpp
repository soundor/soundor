#include "ui/Color.h"

#include <algorithm>
#include <array>
#include <cctype>
#include <charconv>
#include <cmath>
#include <string>
#include <utility>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    namespace
    {
        // CSS Color Module Level 4 named colors.
        constexpr std::array<std::pair<std::string_view, std::uint32_t>, 148> namedColors { {
            { "aliceblue", 0xf0f8ff },
            { "antiquewhite", 0xfaebd7 },
            { "aqua", 0x00ffff },
            { "aquamarine", 0x7fffd4 },
            { "azure", 0xf0ffff },
            { "beige", 0xf5f5dc },
            { "bisque", 0xffe4c4 },
            { "black", 0x000000 },
            { "blanchedalmond", 0xffebcd },
            { "blue", 0x0000ff },
            { "blueviolet", 0x8a2be2 },
            { "brown", 0xa52a2a },
            { "burlywood", 0xdeb887 },
            { "cadetblue", 0x5f9ea0 },
            { "chartreuse", 0x7fff00 },
            { "chocolate", 0xd2691e },
            { "coral", 0xff7f50 },
            { "cornflowerblue", 0x6495ed },
            { "cornsilk", 0xfff8dc },
            { "crimson", 0xdc143c },
            { "cyan", 0x00ffff },
            { "darkblue", 0x00008b },
            { "darkcyan", 0x008b8b },
            { "darkgoldenrod", 0xb8860b },
            { "darkgray", 0xa9a9a9 },
            { "darkgreen", 0x006400 },
            { "darkgrey", 0xa9a9a9 },
            { "darkkhaki", 0xbdb76b },
            { "darkmagenta", 0x8b008b },
            { "darkolivegreen", 0x556b2f },
            { "darkorange", 0xff8c00 },
            { "darkorchid", 0x9932cc },
            { "darkred", 0x8b0000 },
            { "darksalmon", 0xe9967a },
            { "darkseagreen", 0x8fbc8f },
            { "darkslateblue", 0x483d8b },
            { "darkslategray", 0x2f4f4f },
            { "darkslategrey", 0x2f4f4f },
            { "darkturquoise", 0x00ced1 },
            { "darkviolet", 0x9400d3 },
            { "deeppink", 0xff1493 },
            { "deepskyblue", 0x00bfff },
            { "dimgray", 0x696969 },
            { "dimgrey", 0x696969 },
            { "dodgerblue", 0x1e90ff },
            { "firebrick", 0xb22222 },
            { "floralwhite", 0xfffaf0 },
            { "forestgreen", 0x228b22 },
            { "fuchsia", 0xff00ff },
            { "gainsboro", 0xdcdcdc },
            { "ghostwhite", 0xf8f8ff },
            { "gold", 0xffd700 },
            { "goldenrod", 0xdaa520 },
            { "gray", 0x808080 },
            { "green", 0x008000 },
            { "greenyellow", 0xadff2f },
            { "grey", 0x808080 },
            { "honeydew", 0xf0fff0 },
            { "hotpink", 0xff69b4 },
            { "indianred", 0xcd5c5c },
            { "indigo", 0x4b0082 },
            { "ivory", 0xfffff0 },
            { "khaki", 0xf0e68c },
            { "lavender", 0xe6e6fa },
            { "lavenderblush", 0xfff0f5 },
            { "lawngreen", 0x7cfc00 },
            { "lemonchiffon", 0xfffacd },
            { "lightblue", 0xadd8e6 },
            { "lightcoral", 0xf08080 },
            { "lightcyan", 0xe0ffff },
            { "lightgoldenrodyellow", 0xfafad2 },
            { "lightgray", 0xd3d3d3 },
            { "lightgreen", 0x90ee90 },
            { "lightgrey", 0xd3d3d3 },
            { "lightpink", 0xffb6c1 },
            { "lightsalmon", 0xffa07a },
            { "lightseagreen", 0x20b2aa },
            { "lightskyblue", 0x87cefa },
            { "lightslategray", 0x778899 },
            { "lightslategrey", 0x778899 },
            { "lightsteelblue", 0xb0c4de },
            { "lightyellow", 0xffffe0 },
            { "lime", 0x00ff00 },
            { "limegreen", 0x32cd32 },
            { "linen", 0xfaf0e6 },
            { "magenta", 0xff00ff },
            { "maroon", 0x800000 },
            { "mediumaquamarine", 0x66cdaa },
            { "mediumblue", 0x0000cd },
            { "mediumorchid", 0xba55d3 },
            { "mediumpurple", 0x9370db },
            { "mediumseagreen", 0x3cb371 },
            { "mediumslateblue", 0x7b68ee },
            { "mediumspringgreen", 0x00fa9a },
            { "mediumturquoise", 0x48d1cc },
            { "mediumvioletred", 0xc71585 },
            { "midnightblue", 0x191970 },
            { "mintcream", 0xf5fffa },
            { "mistyrose", 0xffe4e1 },
            { "moccasin", 0xffe4b5 },
            { "navajowhite", 0xffdead },
            { "navy", 0x000080 },
            { "oldlace", 0xfdf5e6 },
            { "olive", 0x808000 },
            { "olivedrab", 0x6b8e23 },
            { "orange", 0xffa500 },
            { "orangered", 0xff4500 },
            { "orchid", 0xda70d6 },
            { "palegoldenrod", 0xeee8aa },
            { "palegreen", 0x98fb98 },
            { "paleturquoise", 0xafeeee },
            { "palevioletred", 0xdb7093 },
            { "papayawhip", 0xffefd5 },
            { "peachpuff", 0xffdab9 },
            { "peru", 0xcd853f },
            { "pink", 0xffc0cb },
            { "plum", 0xdda0dd },
            { "powderblue", 0xb0e0e6 },
            { "purple", 0x800080 },
            { "rebeccapurple", 0x663399 },
            { "red", 0xff0000 },
            { "rosybrown", 0xbc8f8f },
            { "royalblue", 0x4169e1 },
            { "saddlebrown", 0x8b4513 },
            { "salmon", 0xfa8072 },
            { "sandybrown", 0xf4a460 },
            { "seagreen", 0x2e8b57 },
            { "seashell", 0xfff5ee },
            { "sienna", 0xa0522d },
            { "silver", 0xc0c0c0 },
            { "skyblue", 0x87ceeb },
            { "slateblue", 0x6a5acd },
            { "slategray", 0x708090 },
            { "slategrey", 0x708090 },
            { "snow", 0xfffafa },
            { "springgreen", 0x00ff7f },
            { "steelblue", 0x4682b4 },
            { "tan", 0xd2b48c },
            { "teal", 0x008080 },
            { "thistle", 0xd8bfd8 },
            { "tomato", 0xff6347 },
            { "turquoise", 0x40e0d0 },
            { "violet", 0xee82ee },
            { "wheat", 0xf5deb3 },
            { "white", 0xffffff },
            { "whitesmoke", 0xf5f5f5 },
            { "yellow", 0xffff00 },
            { "yellowgreen", 0x9acd32 },
        } };

        std::string lower(std::string_view text)
        {
            std::string out;
            out.reserve(text.size());
            for (const char c : text)
                if (c != ' ' && c != '\t')
                    out += static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            return out;
        }

        int hexDigit(char c)
        {
            if (c >= '0' && c <= '9')
                return c - '0';
            if (c >= 'a' && c <= 'f')
                return c - 'a' + 10;
            return -1;
        }

        std::optional<Color> parseHex(std::string_view hex)
        {
            std::array<int, 8> digits {};
            if (hex.size() > digits.size())
                return std::nullopt;
            for (std::size_t i = 0; i < hex.size(); ++i)
            {
                digits[i] = hexDigit(hex[i]);
                if (digits[i] < 0)
                    return std::nullopt;
            }
            const auto pair = [&](std::size_t i) { return static_cast<std::uint8_t>(digits[i] * 16 + digits[i + 1]); };
            const auto single = [&](std::size_t i) { return static_cast<std::uint8_t>(digits[i] * 17); };
            switch (hex.size())
            {
                case 3:
                    return Color { single(0), single(1), single(2), 255 };
                case 4:
                    return Color { single(0), single(1), single(2), single(3) };
                case 6:
                    return Color { pair(0), pair(2), pair(4), 255 };
                case 8:
                    return Color { pair(0), pair(2), pair(4), pair(6) };
                default:
                    return std::nullopt;
            }
        }

        // A number, optionally a percentage of `percentOf`.
        std::optional<double> component(std::string_view text, double percentOf)
        {
            const bool percent = ! text.empty() && text.back() == '%';
            if (percent)
                text.remove_suffix(1);
            double value = 0;
            const auto [end, error] = std::from_chars(text.data(), text.data() + text.size(), value);
            if (error != std::errc {} || end != text.data() + text.size() || ! std::isfinite(value))
                return std::nullopt;
            return percent ? value / 100.0 * percentOf : value;
        }

        std::uint8_t channel(double value)
        {
            return static_cast<std::uint8_t>(std::lround(std::clamp(value, 0.0, 255.0)));
        }

        // The arguments of `name(…)`, split on commas (or spaces and a slash).
        std::optional<std::vector<std::string_view>> arguments(std::string_view text, std::string_view name,
                                                               std::string& storage)
        {
            if (! text.starts_with(name) || text.size() < name.size() + 2 || text[name.size()] != '('
                || text.back() != ')')
                return std::nullopt;
            storage = std::string(text.substr(name.size() + 1, text.size() - name.size() - 2));
            std::replace(storage.begin(), storage.end(), '/', ',');
            std::vector<std::string_view> parts;
            std::string_view rest = storage;
            while (! rest.empty())
            {
                const std::size_t comma = rest.find(',');
                parts.push_back(rest.substr(0, comma));
                if (comma == std::string_view::npos)
                    break;
                rest.remove_prefix(comma + 1);
            }
            return parts;
        }

        double hueToRgb(double p, double q, double t)
        {
            if (t < 0)
                t += 1;
            if (t > 1)
                t -= 1;
            if (t < 1.0 / 6)
                return p + (q - p) * 6 * t;
            if (t < 1.0 / 2)
                return q;
            if (t < 2.0 / 3)
                return p + (q - p) * (2.0 / 3 - t) * 6;
            return p;
        }
    } // namespace

    std::optional<Color> parseColor(std::string_view text)
    {
        // Spaces separate rgb() arguments in modern syntax; make them commas.
        std::string spaced(text);
        for (std::size_t i = 1; i + 1 < spaced.size(); ++i)
            if (spaced[i] == ' ' && spaced[i - 1] != ',' && spaced[i + 1] != ',' && spaced[i - 1] != '('
                && spaced[i + 1] != ')' && spaced[i - 1] != '/' && spaced[i + 1] != '/')
                spaced[i] = ',';
        const std::string css = lower(spaced);
        if (css.empty())
            return std::nullopt;
        if (css == "transparent")
            return Color { 0, 0, 0, 0 };
        if (css.front() == '#')
            return parseHex(std::string_view(css).substr(1));

        std::string storage;
        for (const std::string_view name : { "rgba", "rgb" })
            if (const auto parts = arguments(css, name, storage); parts && (parts->size() == 3 || parts->size() == 4))
            {
                const auto r = component((*parts)[0], 255);
                const auto g = component((*parts)[1], 255);
                const auto b = component((*parts)[2], 255);
                const auto a = parts->size() == 4 ? component((*parts)[3], 1) : std::optional<double>(1);
                if (! r || ! g || ! b || ! a)
                    return std::nullopt;
                return Color { channel(*r), channel(*g), channel(*b), channel(*a * 255) };
            }
        for (const std::string_view name : { "hsla", "hsl" })
            if (const auto parts = arguments(css, name, storage); parts && (parts->size() == 3 || parts->size() == 4))
            {
                std::string_view hueText = (*parts)[0];
                if (hueText.ends_with("deg"))
                    hueText.remove_suffix(3);
                const auto h = component(hueText, 360);
                const auto s = component((*parts)[1], 1);
                const auto l = component((*parts)[2], 1);
                const auto a = parts->size() == 4 ? component((*parts)[3], 1) : std::optional<double>(1);
                if (! h || ! s || ! l || ! a || (*parts)[1].back() != '%' || (*parts)[2].back() != '%')
                    return std::nullopt;
                const double hue = std::fmod(std::fmod(*h, 360) + 360, 360) / 360;
                const double sat = std::clamp(*s, 0.0, 1.0);
                const double light = std::clamp(*l, 0.0, 1.0);
                const double q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
                const double p = 2 * light - q;
                return Color { channel(hueToRgb(p, q, hue + 1.0 / 3) * 255), channel(hueToRgb(p, q, hue) * 255),
                               channel(hueToRgb(p, q, hue - 1.0 / 3) * 255), channel(*a * 255) };
            }

        const auto named =
            std::lower_bound(namedColors.begin(), namedColors.end(), css,
                             [](const auto& entry, const std::string& key) { return entry.first < key; });
        if (named != namedColors.end() && named->first == css)
            return Color { static_cast<std::uint8_t>(named->second >> 16),
                           static_cast<std::uint8_t>(named->second >> 8), static_cast<std::uint8_t>(named->second),
                           255 };
        return std::nullopt;
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
