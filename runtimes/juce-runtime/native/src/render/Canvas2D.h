#pragma once

// Private to soundor_runtime: the 2D context of a canvas node
// (CanvasRenderingContext2D), drawing with Skia on the CPU into the node's
// buffer. Coordinates and sizes are the Web's: doubles, in canvas pixels, under
// the current transform. The JavaScript side (canvas.js) converts and checks
// arguments as WebIDL would; this side assumes finite numbers.

#include <soundor/ui/Surface.h>

#include <array>
#include <cstdint>
#include <memory>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // A gradient (createLinearGradient() and friends) or a pattern
    // (createPattern()): a paint a fill or stroke style can be.
    class Paint;

    class Canvas2D
    {
    public:
        // `images` decodes the bundled images drawImage() draws (may be null).
        Canvas2D(std::shared_ptr<ui::CanvasBuffer> buffer, std::shared_ptr<ui::ImageSource> images);
        ~Canvas2D();
        Canvas2D(const Canvas2D&) = delete;
        Canvas2D& operator=(const Canvas2D&) = delete;

        [[nodiscard]] const std::shared_ptr<ui::CanvasBuffer>& buffer() const noexcept { return target; }
        // Catches up with the buffer: a resized buffer resets the context's
        // state and path. Every operation starts with it.
        void sync();

        // ── State ────────────────────────────────────────────────────────────
        void save();
        void restore();
        void reset();
        [[nodiscard]] double globalAlpha() const noexcept;
        void setGlobalAlpha(double alpha);
        // A CSS blend or Porter-Duff name; false (unchanged) for anything else.
        [[nodiscard]] std::string globalCompositeOperation() const;
        bool setGlobalCompositeOperation(std::string_view name);

        // ── Transforms ───────────────────────────────────────────────────────
        void scale(double x, double y);
        void rotate(double angle);
        void translate(double x, double y);
        void transform(double a, double b, double c, double d, double e, double f);
        void setTransform(double a, double b, double c, double d, double e, double f);
        void resetTransform();
        // a, b, c, d, e, f.
        [[nodiscard]] std::array<double, 6> getTransform() const;

        // ── Styles ───────────────────────────────────────────────────────────
        // CSS colors; false (unchanged) when `color` is not one.
        bool setFillColor(std::string_view color);
        bool setStrokeColor(std::string_view color);
        void setFillPaint(std::shared_ptr<Paint> paint);
        void setStrokePaint(std::shared_ptr<Paint> paint);
        // Serialized as the Web does: "#rrggbb", or "rgba(r, g, b, a)".
        [[nodiscard]] std::string fillColor() const;
        [[nodiscard]] std::string strokeColor() const;

        [[nodiscard]] static std::shared_ptr<Paint> linearGradient(double x0, double y0, double x1, double y1);
        [[nodiscard]] static std::shared_ptr<Paint> radialGradient(double x0, double y0, double r0, double x1,
                                                                   double y1, double r1);
        [[nodiscard]] static std::shared_ptr<Paint> conicGradient(double angle, double x, double y);
        // false when `color` is not a CSS color.
        static bool addColorStop(Paint& gradient, double offset, std::string_view color);
        // `repetition`: "repeat", "repeat-x", "repeat-y", "no-repeat" (or "").
        [[nodiscard]] std::shared_ptr<Paint> pattern(const ui::CanvasBuffer& source, std::string_view repetition) const;

        void setLineWidth(double width);
        [[nodiscard]] double lineWidth() const noexcept;
        // "butt", "round", "square"; false (unchanged) otherwise.
        bool setLineCap(std::string_view cap);
        [[nodiscard]] std::string lineCap() const;
        // "round", "bevel", "miter"; false (unchanged) otherwise.
        bool setLineJoin(std::string_view join);
        [[nodiscard]] std::string lineJoin() const;
        void setMiterLimit(double limit);
        [[nodiscard]] double miterLimit() const noexcept;
        void setLineDash(std::vector<double> segments);
        [[nodiscard]] std::vector<double> lineDash() const;
        void setLineDashOffset(double offset);
        [[nodiscard]] double lineDashOffset() const noexcept;

        // ── Rectangles ───────────────────────────────────────────────────────
        void clearRect(double x, double y, double width, double height);
        void fillRect(double x, double y, double width, double height);
        void strokeRect(double x, double y, double width, double height);

        // ── Paths ────────────────────────────────────────────────────────────
        void beginPath();
        void closePath();
        void moveTo(double x, double y);
        void lineTo(double x, double y);
        void quadraticCurveTo(double cx, double cy, double x, double y);
        void bezierCurveTo(double c1x, double c1y, double c2x, double c2y, double x, double y);
        void arcTo(double x1, double y1, double x2, double y2, double radius);
        void rect(double x, double y, double width, double height);
        void roundRect(double x, double y, double width, double height, std::span<const double> radii);
        void arc(double x, double y, double radius, double start, double end, bool counterclockwise);
        void ellipse(double x, double y, double radiusX, double radiusY, double rotation, double start, double end,
                     bool counterclockwise);
        // `evenOdd`: the "evenodd" fill rule, else "nonzero".
        void fill(bool evenOdd);
        void stroke();
        void clip(bool evenOdd);
        [[nodiscard]] bool isPointInPath(double x, double y, bool evenOdd) const;
        [[nodiscard]] bool isPointInStroke(double x, double y) const;

        // ── Text ─────────────────────────────────────────────────────────────
        // A CSS font shorthand ("bold 12px sans-serif"); false (unchanged) for
        // anything else.
        bool setFont(std::string_view font);
        [[nodiscard]] std::string font() const;
        // "start", "end", "left", "right", "center".
        bool setTextAlign(std::string_view align);
        [[nodiscard]] std::string textAlign() const;
        // "top", "hanging", "middle", "alphabetic", "ideographic", "bottom".
        bool setTextBaseline(std::string_view baseline);
        [[nodiscard]] std::string textBaseline() const;
        void fillText(std::string_view text, double x, double y, std::optional<double> maxWidth);
        void strokeText(std::string_view text, double x, double y, std::optional<double> maxWidth);
        struct TextMetrics
        {
            double width = 0;
            double fontBoundingBoxAscent = 0;
            double fontBoundingBoxDescent = 0;
        };
        [[nodiscard]] TextMetrics measureText(std::string_view text);

        // ── Pixels ───────────────────────────────────────────────────────────
        void setImageSmoothing(bool enabled);
        [[nodiscard]] bool imageSmoothing() const noexcept;
        // Draws `source` (its pixels) from source rectangle s… to destination d….
        void drawCanvas(const ui::CanvasBuffer& source, double sx, double sy, double sw, double sh, double dx,
                        double dy, double dw, double dh);
        // A bundled image (by asset id); false when it is not one.
        bool drawAsset(std::string_view asset, std::optional<std::array<double, 4>> sourceRect, double dx, double dy,
                       std::optional<double> dw, std::optional<double> dh);
        // RGBA, not premultiplied, row by row: ImageData's layout. Outside the
        // canvas reads as transparent.
        [[nodiscard]] std::vector<std::uint8_t> getImageData(int x, int y, int width, int height) const;
        // Writes `rgba` (width×height ImageData) at (dx, dy), only its part in
        // the dirty rectangle; ignores the transform, clip, alpha and
        // compositing, as the Web does.
        void putImageData(std::span<const std::uint8_t> rgba, int width, int height, int dx, int dy, int dirtyX,
                          int dirtyY, int dirtyWidth, int dirtyHeight);

    private:
        struct Impl;
        std::shared_ptr<ui::CanvasBuffer> target;
        std::unique_ptr<Impl> impl;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
