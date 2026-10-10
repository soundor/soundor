#pragma once

#include <soundor/Config.h>

#include <cstdint>
#include <optional>
#include <string>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    // A node's style: flexbox layout as in React Native (and CSS), how the
    // node is drawn, and the text properties text is set in. Every field
    // starts at its initial value, so a default Style is "no style".

    // An sRGB color with straight (not premultiplied) alpha.
    struct Color
    {
        std::uint8_t r = 0;
        std::uint8_t g = 0;
        std::uint8_t b = 0;
        std::uint8_t a = 0;

        [[nodiscard]] constexpr bool visible() const noexcept { return a != 0; }
        friend constexpr bool operator==(const Color&, const Color&) = default;
    };

    inline constexpr Color black { 0, 0, 0, 255 };
    inline constexpr Color transparent {};

    struct Corners
    {
        float topLeft = 0;
        float topRight = 0;
        float bottomRight = 0;
        float bottomLeft = 0;

        friend constexpr bool operator==(const Corners&, const Corners&) = default;
    };

    struct Length
    {
        enum class Unit : std::uint8_t
        {
            Undefined,
            Point,
            Percent,
            Auto,
        };

        Unit unit = Unit::Undefined;
        float value = 0;

        [[nodiscard]] static constexpr Length points(float v) noexcept { return { Unit::Point, v }; }
        [[nodiscard]] static constexpr Length percent(float v) noexcept { return { Unit::Percent, v }; }
        [[nodiscard]] static constexpr Length automatic() noexcept { return { Unit::Auto, 0 }; }

        friend constexpr bool operator==(const Length&, const Length&) = default;
    };

    template <typename T>
    struct Edges
    {
        T top {};
        T right {};
        T bottom {};
        T left {};

        friend constexpr bool operator==(const Edges&, const Edges&) = default;
    };

    enum class Display : std::uint8_t
    {
        Flex,
        None,
    };

    enum class Position : std::uint8_t
    {
        Relative,
        Absolute,
        Static,
    };

    enum class FlexDirection : std::uint8_t
    {
        Column,
        ColumnReverse,
        Row,
        RowReverse,
    };

    enum class Wrap : std::uint8_t
    {
        NoWrap,
        Wrap,
        WrapReverse,
    };

    enum class Justify : std::uint8_t
    {
        FlexStart,
        Center,
        FlexEnd,
        SpaceBetween,
        SpaceAround,
        SpaceEvenly,
    };

    enum class Align : std::uint8_t
    {
        Auto,
        FlexStart,
        Center,
        FlexEnd,
        Stretch,
        Baseline,
        SpaceBetween,
        SpaceAround,
        SpaceEvenly,
    };

    enum class Overflow : std::uint8_t
    {
        Visible,
        Hidden,
        Scroll,
    };

    enum class BoxSizing : std::uint8_t
    {
        BorderBox,
        ContentBox,
    };

    // Whether a node can be the target of pointer events (React Native's
    // `pointerEvents`): BoxNone lets events through the node to its children,
    // BoxOnly keeps them from its children.
    enum class PointerEvents : std::uint8_t
    {
        Auto,
        None,
        BoxNone,
        BoxOnly,
    };

    enum class FontStyle : std::uint8_t
    {
        Normal,
        Italic,
    };

    enum class TextAlign : std::uint8_t
    {
        Auto,
        Left,
        Center,
        Right,
    };

    // How an image fills its box (React Native's resizeMode).
    enum class ResizeMode : std::uint8_t
    {
        Cover,   // fill the box, cropping, keeping the aspect ratio
        Contain, // fit inside the box, keeping the aspect ratio
        Stretch, // fill the box exactly
        Center,  // centered at its own size, scaled down to fit
    };

    struct TextStyle
    {
        Color color = black;
        std::string fontFamily; // empty: the platform's UI font
        float fontSize = 14;
        int fontWeight = 400;
        FontStyle fontStyle = FontStyle::Normal;
        // Line height in points; 0: from the font (about 1.2 × fontSize).
        float lineHeight = 0;
        float letterSpacing = 0;
        TextAlign textAlign = TextAlign::Auto;
        // 0: unlimited.
        int numberOfLines = 0;

        friend bool operator==(const TextStyle&, const TextStyle&) = default;
    };

    struct Style
    {
        Display display = Display::Flex;
        Position position = Position::Relative;
        FlexDirection flexDirection = FlexDirection::Column;
        Wrap flexWrap = Wrap::NoWrap;
        Justify justifyContent = Justify::FlexStart;
        Align alignItems = Align::Stretch;
        Align alignSelf = Align::Auto;
        Align alignContent = Align::FlexStart;
        float flexGrow = 0;
        float flexShrink = 0;
        Length flexBasis = Length::automatic();

        Length width = Length::automatic();
        Length height = Length::automatic();
        Length minWidth;
        Length minHeight;
        Length maxWidth;
        Length maxHeight;
        // Width / height; none when unset.
        std::optional<float> aspectRatio;
        BoxSizing boxSizing = BoxSizing::BorderBox;

        Edges<Length> margin { Length::points(0), Length::points(0), Length::points(0), Length::points(0) };
        Edges<Length> padding { Length::points(0), Length::points(0), Length::points(0), Length::points(0) };
        // top/right/bottom/left offsets.
        Edges<Length> inset;
        Edges<float> borderWidth;
        float rowGap = 0;
        float columnGap = 0;

        Overflow overflow = Overflow::Visible;
        PointerEvents pointerEvents = PointerEvents::Auto;
        // Stacks the node among its siblings: higher is drawn over and hit
        // before lower; equal keeps tree order. Layout ignores it.
        int zIndex = 0;

        Color backgroundColor;
        Color borderColor = black;
        Corners borderRadius;
        // 0 (invisible) to 1; applies to the node and everything in it.
        float opacity = 1;
        ResizeMode resizeMode = ResizeMode::Cover;

        TextStyle text;

        friend bool operator==(const Style&, const Style&) = default;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
