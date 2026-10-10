#pragma once

// Private to soundor_runtime: the native side of canvases' 2D contexts, part
// of `soundor:internal/ui`. canvas.js calls call2d(node, op, ...) with the
// operation numbers below; keep the two lists the same.

#include "js/Bindings.h"

#include <soundor/js/Context.h>
#include <soundor/ui/Surface.h>

#include <cstdint>
#include <span>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    enum class Canvas2DOp : std::uint8_t
    {
        Save = 0,
        Restore = 1,
        Reset = 2,
        GlobalAlpha = 3,
        SetGlobalAlpha = 4,
        CompositeOperation = 5,
        SetCompositeOperation = 6,
        Scale = 7,
        Rotate = 8,
        Translate = 9,
        Transform = 10,
        SetTransform = 11,
        ResetTransform = 12,
        GetTransform = 13,
        SetFillColor = 14,
        SetStrokeColor = 15,
        SetFillPaint = 16,
        SetStrokePaint = 17,
        FillColor = 18,
        StrokeColor = 19,
        LineWidth = 20,
        SetLineWidth = 21,
        LineCap = 22,
        SetLineCap = 23,
        LineJoin = 24,
        SetLineJoin = 25,
        MiterLimit = 26,
        SetMiterLimit = 27,
        LineDash = 28,
        SetLineDash = 29,
        LineDashOffset = 30,
        SetLineDashOffset = 31,
        ClearRect = 32,
        FillRect = 33,
        StrokeRect = 34,
        BeginPath = 35,
        ClosePath = 36,
        MoveTo = 37,
        LineTo = 38,
        QuadraticCurveTo = 39,
        BezierCurveTo = 40,
        ArcTo = 41,
        Rect = 42,
        RoundRect = 43,
        Arc = 44,
        Ellipse = 45,
        Fill = 46,
        Stroke = 47,
        Clip = 48,
        IsPointInPath = 49,
        IsPointInStroke = 50,
        Font = 51,
        SetFont = 52,
        TextAlign = 53,
        SetTextAlign = 54,
        TextBaseline = 55,
        SetTextBaseline = 56,
        FillText = 57,
        StrokeText = 58,
        MeasureText = 59,
        ImageSmoothing = 60,
        SetImageSmoothing = 61,
        DrawCanvas = 62,
        DrawAsset = 63,
        GetImageData = 64,
        PutImageData = 65,
        // Path commands canvas.js gathered, in one call: a Float64Array of
        // [op, arguments...] for BeginPath through Ellipse (not RoundRect),
        // and how many of its numbers are commands.
        Path = 66,
    };

    struct NativeFunction
    {
        const char* name;
        JSCFunction* call;
        int length;
    };

    // The surface `soundor:ui` is installed on in `ctx`.
    [[nodiscard]] Surface& surfaceOf(JSContext* ctx);

    // The canvas functions of `soundor:internal/ui`.
    [[nodiscard]] std::span<const NativeFunction> canvasFunctions();
    // Their per-context state; with soundor:ui.
    void installCanvases(js::Context& context);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
