#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>
#include <soundor/ui/Animation.h>

#include <algorithm>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

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

    // The pointer's shape over a node (CSS `cursor`, the shapes every
    // platform has). Auto takes the parent's: a text input's is Text, and
    // the view's the arrow (Default).
    enum class Cursor : std::uint8_t
    {
        Auto,
        Default,
        None,
        Pointer,
        Text,
        Crosshair,
        Move,
        EwResize,
        NsResize,
        NeswResize,
        NwseResize,
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

    // A shadow of the box (CSS `box-shadow`): its rounded rectangle, grown by
    // `spread`, moved by the offset and blurred by `blur` (a Gaussian of
    // sigma blur / 2, as CSS has it), drawn outside the border box, or with
    // `inset` inside the padding box. Neither laid out nor hit.
    struct BoxShadow
    {
        float offsetX = 0;
        float offsetY = 0;
        float blur = 0;
        float spread = 0;
        Color color = black;
        bool inset = false;

        // Whether it draws anything: a visible color.
        [[nodiscard]] bool visible() const noexcept { return color.visible(); }
        // How far its blur reaches past the shape: three sigmas, where
        // Skia's Gaussian ends.
        [[nodiscard]] float blurReach() const noexcept { return blur * 1.5f; }

        friend bool operator==(const BoxShadow&, const BoxShadow&) = default;
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

        // Each axis's own (`overflowX`, `overflowY`, else `overflow`). A box
        // clips both axes or neither: one 'visible' next to a clipping axis
        // means 'hidden', as in CSS (see clips()).
        Overflow overflowX = Overflow::Visible;
        Overflow overflowY = Overflow::Visible;
        PointerEvents pointerEvents = PointerEvents::Auto;
        Cursor cursor = Cursor::Auto;
        // Stacks the node among its siblings: higher is drawn over and hit
        // before lower; equal keeps tree order. Layout ignores it.
        int zIndex = 0;

        Color backgroundColor;
        Color borderColor = black;
        Corners borderRadius;
        // A line around the box (CSS `outline`), outside its border,
        // `outlineOffset` away from it (inside when negative) and following
        // its corners. Neither laid out nor hit: it takes no room.
        float outlineWidth = 0;
        float outlineOffset = 0;
        Color outlineColor = black;
        // Painted in order, the first on top, as in CSS: outer shadows below
        // the background, inset ones above it and below the border.
        std::vector<BoxShadow> boxShadow;
        // 0 (invisible) to 1; applies to the node and everything in it.
        float opacity = 1;
        Presentation transform;
        ResizeMode resizeMode = ResizeMode::Cover;

        TextStyle text;

        // Whether what is inside is cut to the padding box: either axis is not
        // 'visible'.
        [[nodiscard]] bool clips() const noexcept
        {
            return overflowX != Overflow::Visible || overflowY != Overflow::Visible;
        }
        // Whether a view's children scroll along that axis (a wheel, a
        // scrollbar, scrollTo()). Other nodes clip and never scroll.
        [[nodiscard]] bool scrollsX() const noexcept { return overflowX == Overflow::Scroll; }
        [[nodiscard]] bool scrollsY() const noexcept { return overflowY == Overflow::Scroll; }
        [[nodiscard]] bool scrolls() const noexcept { return scrollsX() || scrollsY(); }
        // The one value Yoga has: 'scroll' when either axis scrolls.
        [[nodiscard]] Overflow layoutOverflow() const noexcept
        {
            return scrolls() ? Overflow::Scroll : clips() ? Overflow::Hidden : Overflow::Visible;
        }

        [[nodiscard]] bool outlined() const noexcept { return outlineWidth > 0 && outlineColor.visible(); }
        // How far the outline reaches outside the box: 0 without one.
        [[nodiscard]] float outlineExtent() const noexcept
        {
            return outlined() ? std::max(0.0f, outlineOffset + outlineWidth) : 0;
        }
        // Whether any shadow draws.
        [[nodiscard]] bool shadowed() const noexcept
        {
            return std::ranges::any_of(boxShadow, [](const BoxShadow& shadow) { return shadow.visible(); });
        }
        // How far what the node draws itself reaches outside its box, per
        // edge: its outline and its outer shadows. Damage, layers and
        // caches cover this much more than the box.
        [[nodiscard]] Edges<float> inkOverflow() const noexcept
        {
            const float outline = outlineExtent();
            Edges<float> result { outline, outline, outline, outline };
            for (const BoxShadow& shadow : boxShadow)
            {
                if (shadow.inset || ! shadow.visible())
                    continue;
                const float reach = shadow.spread + shadow.blurReach();
                result.top = std::max(result.top, reach - shadow.offsetY);
                result.right = std::max(result.right, reach + shadow.offsetX);
                result.bottom = std::max(result.bottom, reach + shadow.offsetY);
                result.left = std::max(result.left, reach - shadow.offsetX);
            }
            return result;
        }
        // Whether it draws anything outside its box.
        [[nodiscard]] bool overflowsInk() const noexcept
        {
            const Edges<float> ink = inkOverflow();
            return ink.top > 0 || ink.right > 0 || ink.bottom > 0 || ink.left > 0;
        }

        friend bool operator==(const Style&, const Style&) = default;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
