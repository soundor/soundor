#pragma once

#include <soundor/Abi.h>

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    // Version 1 of the retained vector protocol. Only its owning UI node is
    // laid out and receives input; coordinates here are SVG user units.
    struct SvgPresentation
    {
        std::optional<std::string> fill, stroke, color;
        std::optional<float> strokeWidth, strokeMiterlimit, strokeDashoffset;
        std::optional<float> opacity, fillOpacity, strokeOpacity;
        std::optional<std::string> fillRule, strokeLinecap, strokeLinejoin;
        std::optional<std::vector<float>> strokeDasharray;
        // SVG matrix(a b c d e f), separate from the UI node's Style.
        std::optional<std::array<float, 6>> transform;
        friend bool operator==(const SvgPresentation&, const SvgPresentation&) = default;
    };

    struct SvgGroup
    {
        friend bool operator==(const SvgGroup&, const SvgGroup&) = default;
    };
    struct SvgPath
    {
        std::string d;
        friend bool operator==(const SvgPath&, const SvgPath&) = default;
    };
    struct SvgCircle
    {
        float cx = 0, cy = 0, r = 0;
        friend bool operator==(const SvgCircle&, const SvgCircle&) = default;
    };
    struct SvgRect
    {
        float x = 0, y = 0, width = 0, height = 0;
        std::optional<float> rx, ry;
        friend bool operator==(const SvgRect&, const SvgRect&) = default;
    };
    struct SvgEllipse
    {
        float cx = 0, cy = 0, rx = 0, ry = 0;
        friend bool operator==(const SvgEllipse&, const SvgEllipse&) = default;
    };
    struct SvgLine
    {
        float x1 = 0, y1 = 0, x2 = 0, y2 = 0;
        friend bool operator==(const SvgLine&, const SvgLine&) = default;
    };
    struct SvgPoints
    {
        std::vector<float> points;
        bool closed = false;
        friend bool operator==(const SvgPoints&, const SvgPoints&) = default;
    };
    using SvgGeometry = std::variant<SvgGroup, SvgPath, SvgCircle, SvgRect, SvgEllipse, SvgLine, SvgPoints>;

    struct SvgShape
    {
        SvgGeometry geometry;
        SvgPresentation presentation;
        // Only SvgGroup may have children. No individual shape has a Yoga node.
        std::vector<SvgShape> children;
        friend bool operator==(const SvgShape&, const SvgShape&) = default;
    };

    struct SvgScene
    {
        std::uint32_t version = 1;
        std::optional<std::array<float, 4>> viewBox;
        std::string preserveAspectRatio = "xMidYMid meet";
        SvgPresentation presentation;
        std::vector<SvgShape> children;
        friend bool operator==(const SvgScene&, const SvgScene&) = default;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
