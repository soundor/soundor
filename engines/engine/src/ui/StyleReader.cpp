#include "ui/StyleReader.h"

#include "ui/Color.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdlib>
#include <exception>
#include <stdexcept>
#include <string>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    namespace
    {
        class Reader
        {
        public:
            explicit Reader(StyleSource& from) : source(from) {}

            Style read()
            {
                Style out;
                readLayout(out);
                readSpacing(out);
                readVisual(out);
                readText(out.text);
                return out;
            }

        private:
            // StyleSource::fail() throws; a virtual call's [[noreturn]] is
            // not one every compiler relies on, so this one is sure to.
            [[noreturn]] void fail(std::string_view key, std::string_view expected)
            {
                source.fail(key, expected);
                throw std::logic_error("StyleSource::fail() returned");
            }

            std::optional<float> number(const char* key)
            {
                const StyleValue value = source.get(key);
                if (! value.present())
                    return std::nullopt;
                if (value.kind != StyleValue::Kind::Number || ! std::isfinite(value.number))
                    fail(key, "a finite number");
                return static_cast<float>(value.number);
            }

            std::optional<Length> length(const char* key, bool allowAuto)
            {
                const StyleValue value = source.get(key);
                if (! value.present())
                    return std::nullopt;
                const std::string_view expected =
                    allowAuto ? "a number, a percentage or 'auto'" : "a number or a percentage";
                if (value.kind == StyleValue::Kind::Number)
                {
                    if (! std::isfinite(value.number))
                        fail(key, expected);
                    return Length::points(static_cast<float>(value.number));
                }
                if (value.kind == StyleValue::Kind::String)
                {
                    const std::string& text = value.text;
                    if (allowAuto && text == "auto")
                        return Length::automatic();
                    if (text.size() > 1 && text.back() == '%')
                    {
                        std::size_t used = 0;
                        try
                        {
                            const float percent = std::stof(text.substr(0, text.size() - 1), &used);
                            if (used == text.size() - 1 && std::isfinite(percent))
                                return Length::percent(percent);
                        }
                        catch (const std::exception&) // NOLINT(bugprone-empty-catch): reported below
                        {
                        }
                    }
                }
                fail(key, expected);
            }

            template <typename Enum, std::size_t Count>
            std::optional<Enum> choice(const char* key, const std::array<std::string_view, Count>& names)
            {
                const StyleValue value = source.get(key);
                if (! value.present())
                    return std::nullopt;
                if (value.kind == StyleValue::Kind::String)
                    for (std::size_t i = 0; i < Count; ++i)
                        if (names[i] == value.text)
                            return static_cast<Enum>(i);
                std::string expected = "one of ";
                for (std::size_t i = 0; i < Count; ++i)
                    expected += (i == 0 ? "'" : ", '") + std::string(names[i]) + "'";
                fail(key, expected);
            }

            std::optional<Color> color(const char* key)
            {
                const StyleValue value = source.get(key);
                if (! value.present())
                    return std::nullopt;
                if (value.kind == StyleValue::Kind::String)
                    if (const std::optional<Color> parsed = parseColor(value.text))
                        return parsed;
                fail(key, "a CSS color");
            }

            template <typename T>
            static void assign(T& field, const std::optional<T>& value)
            {
                if (value)
                    field = *value;
            }

            void readLayout(Style& out)
            {
                static constexpr std::array<std::string_view, 2> displays { "flex", "none" };
                static constexpr std::array<std::string_view, 3> positions { "relative", "absolute", "static" };
                static constexpr std::array<std::string_view, 4> directions { "column", "column-reverse", "row",
                                                                              "row-reverse" };
                static constexpr std::array<std::string_view, 3> wraps { "nowrap", "wrap", "wrap-reverse" };
                static constexpr std::array<std::string_view, 6> justifies { "flex-start",   "center",
                                                                             "flex-end",     "space-between",
                                                                             "space-around", "space-evenly" };
                static constexpr std::array<std::string_view, 9> aligns {
                    "auto",     "flex-start",    "center",       "flex-end",    "stretch",
                    "baseline", "space-between", "space-around", "space-evenly"
                };
                static constexpr std::array<std::string_view, 3> overflows { "visible", "hidden", "scroll" };
                static constexpr std::array<std::string_view, 2> boxSizings { "border-box", "content-box" };
                static constexpr std::array<std::string_view, 4> pointerEvents { "auto", "none", "box-none",
                                                                                 "box-only" };
                static constexpr std::array<std::string_view, 11> cursors { "auto",        "default",    "none",
                                                                            "pointer",     "text",       "crosshair",
                                                                            "move",        "ew-resize",  "ns-resize",
                                                                            "nesw-resize", "nwse-resize" };

                assign(out.display, choice<Display>("display", displays));
                assign(out.position, choice<Position>("position", positions));
                assign(out.flexDirection, choice<FlexDirection>("flexDirection", directions));
                assign(out.flexWrap, choice<Wrap>("flexWrap", wraps));
                assign(out.justifyContent, choice<Justify>("justifyContent", justifies));
                assign(out.alignItems, choice<Align>("alignItems", aligns));
                assign(out.alignSelf, choice<Align>("alignSelf", aligns));
                assign(out.alignContent, choice<Align>("alignContent", aligns));
                // `overflow` sets both axes; `overflowX`/`overflowY` win over it.
                if (const auto both = choice<Overflow>("overflow", overflows))
                    out.overflowX = out.overflowY = *both;
                assign(out.overflowX, choice<Overflow>("overflowX", overflows));
                assign(out.overflowY, choice<Overflow>("overflowY", overflows));
                assign(out.boxSizing, choice<BoxSizing>("boxSizing", boxSizings));
                assign(out.pointerEvents, choice<PointerEvents>("pointerEvents", pointerEvents));
                assign(out.cursor, choice<Cursor>("cursor", cursors));
                if (const StyleValue zIndex = source.get("zIndex"); zIndex.present())
                {
                    const bool isNumber = zIndex.kind == StyleValue::Kind::Number;
                    const double value = isNumber ? zIndex.number : 0.5;
                    if (! isNumber || std::trunc(value) != value || std::abs(value) > 2147483647.0)
                        fail("zIndex", "an integer");
                    out.zIndex = static_cast<int>(value);
                }

                // `flex` as in React Native; the longhands win over it.
                if (const auto flex = number("flex"))
                {
                    if (*flex > 0)
                    {
                        out.flexGrow = *flex;
                        out.flexShrink = 1;
                        out.flexBasis = Length::points(0);
                    }
                    else if (*flex < 0)
                        out.flexShrink = 1;
                }
                assign(out.flexGrow, number("flexGrow"));
                assign(out.flexShrink, number("flexShrink"));
                assign(out.flexBasis, length("flexBasis", true));

                assign(out.width, length("width", true));
                assign(out.height, length("height", true));
                assign(out.minWidth, length("minWidth", false));
                assign(out.minHeight, length("minHeight", false));
                assign(out.maxWidth, length("maxWidth", false));
                assign(out.maxHeight, length("maxHeight", false));
                out.aspectRatio = number("aspectRatio");
            }

            // Shorthand, then axis, then side: `margin`, `marginHorizontal`, `marginLeft`.
            template <typename T, typename Read>
            void edges(Edges<T>& out, const std::string& prefix, const std::string& suffix, Read read)
            {
                const auto key = [&](const char* side) { return prefix + side + suffix; };
                if (const auto all = read((prefix + suffix).c_str()))
                    out = { *all, *all, *all, *all };
                if (const auto vertical = read(key("Vertical").c_str()))
                    out.top = out.bottom = *vertical;
                if (const auto horizontal = read(key("Horizontal").c_str()))
                    out.left = out.right = *horizontal;
                assign(out.top, read(key("Top").c_str()));
                assign(out.right, read(key("Right").c_str()));
                assign(out.bottom, read(key("Bottom").c_str()));
                assign(out.left, read(key("Left").c_str()));
            }

            void readSpacing(Style& out)
            {
                edges(out.margin, "margin", "", [&](const char* key) { return length(key, true); });
                edges(out.padding, "padding", "", [&](const char* key) { return length(key, false); });
                edges(out.borderWidth, "border", "Width", [&](const char* key) { return number(key); });

                if (const auto inset = length("inset", true))
                    out.inset = { *inset, *inset, *inset, *inset };
                assign(out.inset.top, length("top", true));
                assign(out.inset.right, length("right", true));
                assign(out.inset.bottom, length("bottom", true));
                assign(out.inset.left, length("left", true));

                if (const auto gap = number("gap"))
                    out.rowGap = out.columnGap = *gap;
                assign(out.rowGap, number("rowGap"));
                assign(out.columnGap, number("columnGap"));
            }

            void readVisual(Style& out)
            {
                static constexpr std::array<std::string_view, 4> resizeModes { "cover", "contain", "stretch",
                                                                               "center" };
                assign(out.backgroundColor, color("backgroundColor"));
                assign(out.borderColor, color("borderColor"));
                if (const auto radius = number("borderRadius"))
                    out.borderRadius = { *radius, *radius, *radius, *radius };
                assign(out.borderRadius.topLeft, number("borderTopLeftRadius"));
                assign(out.borderRadius.topRight, number("borderTopRightRadius"));
                assign(out.borderRadius.bottomRight, number("borderBottomRightRadius"));
                assign(out.borderRadius.bottomLeft, number("borderBottomLeftRadius"));
                assign(out.outlineWidth, number("outlineWidth"));
                assign(out.outlineOffset, number("outlineOffset"));
                assign(out.outlineColor, color("outlineColor"));
                out.boxShadow = source.boxShadow();
                if (const auto opacity = number("opacity"))
                    out.opacity = std::clamp(*opacity, 0.0f, 1.0f);
                if (std::optional<Presentation> transform = source.transform())
                    out.transform = *transform;
                assign(out.resizeMode, choice<ResizeMode>("resizeMode", resizeModes));
            }

            void readText(TextStyle& out)
            {
                assign(out.color, color("color"));
                static constexpr std::array<std::string_view, 2> fontStyles { "normal", "italic" };
                static constexpr std::array<std::string_view, 4> textAligns { "auto", "left", "center", "right" };

                if (const StyleValue family = source.get("fontFamily"); family.present())
                {
                    if (family.kind != StyleValue::Kind::String)
                        fail("fontFamily", "a string");
                    out.fontFamily = family.text;
                }
                if (const auto size = number("fontSize"); size && *size > 0)
                    out.fontSize = *size;
                if (const StyleValue weight = source.get("fontWeight"); weight.present())
                {
                    double value = 0;
                    if (weight.kind == StyleValue::Kind::Number)
                        value = weight.number;
                    else if (weight.kind == StyleValue::Kind::String)
                        value = weight.text == "normal" ? 400
                                : weight.text == "bold" ? 700
                                                        : std::atof(weight.text.c_str());
                    if (value < 1 || value > 1000)
                        fail("fontWeight", "a weight from 1 to 1000, 'normal' or 'bold'");
                    out.fontWeight = static_cast<int>(value);
                }
                assign(out.fontStyle, choice<FontStyle>("fontStyle", fontStyles));
                assign(out.lineHeight, number("lineHeight"));
                assign(out.letterSpacing, number("letterSpacing"));
                assign(out.textAlign, choice<TextAlign>("textAlign", textAligns));
                if (const auto lines = number("numberOfLines"))
                    out.numberOfLines = std::max(0, static_cast<int>(*lines));
            }

            StyleSource& source;
        };
    } // namespace

    Style readStyle(StyleSource& source)
    {
        return Reader(source).read();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
