#include "render/Canvas2D.h"

#include "render/SkiaImages.h"
#include "render/SkiaText.h"
#include "ui/Color.h"

#include <include/core/SkBlendMode.h>
#include <include/core/SkCanvas.h>
#include <include/core/SkColor.h>
#include <include/core/SkImage.h>
#include <include/core/SkMatrix.h>
#include <include/core/SkPaint.h>
#include <include/core/SkPath.h>
#include <include/core/SkPathBuilder.h>
#include <include/core/SkPathEffect.h>
#include <include/core/SkPathUtils.h>
#include <include/core/SkPixmap.h>
#include <include/core/SkRRect.h>
#include <include/core/SkShader.h>
#include <include/effects/SkDashPathEffect.h>
#include <include/effects/SkGradientShader.h>

#include <algorithm>
#include <array>
#include <cctype>
#include <charconv>
#include <cmath>
#include <cstring>
#include <numbers>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    // ── Paints ───────────────────────────────────────────────────────────────

    class Paint
    {
    public:
        enum class Kind : std::uint8_t
        {
            Linear,
            Radial,
            Conic,
            Pattern,
        };

        Kind kind = Kind::Linear;
        std::array<float, 6> points {};
        std::vector<std::pair<float, SkColor4f>> stops;
        sk_sp<SkImage> image;
        SkTileMode tileX = SkTileMode::kRepeat;
        SkTileMode tileY = SkTileMode::kRepeat;

        sk_sp<SkShader> shader()
        {
            if (cached != nullptr || kind == Kind::Pattern)
                return kind == Kind::Pattern ? patternShader() : cached;
            if (stops.empty())
                return nullptr;
            std::vector<SkColor4f> colors;
            std::vector<float> positions;
            for (const auto& [offset, color] : stops)
            {
                positions.push_back(offset);
                colors.push_back(color);
            }
            const auto count = static_cast<int>(colors.size());
            const SkGradientShader::Interpolation premul {
                .fInPremul = SkGradientShader::Interpolation::InPremul::kYes,
            };
            switch (kind)
            {
                case Kind::Linear:
                {
                    // The same start and end point: nothing is painted.
                    if (points[0] == points[2] && points[1] == points[3])
                        return nullptr;
                    const SkPoint ends[2] = { { points[0], points[1] }, { points[2], points[3] } };
                    cached = SkGradientShader::MakeLinear(ends, colors.data(), nullptr, positions.data(), count,
                                                          SkTileMode::kClamp, premul, nullptr);
                    break;
                }
                case Kind::Radial:
                    cached = SkGradientShader::MakeTwoPointConical(
                        { points[0], points[1] }, points[2], { points[3], points[4] }, points[5], colors.data(),
                        nullptr, positions.data(), count, SkTileMode::kClamp, premul, nullptr);
                    break;
                case Kind::Conic:
                {
                    // Starts at `angle` from the positive x axis, clockwise.
                    const SkMatrix rotation =
                        SkMatrix::RotateDeg(points[0] * 180 / std::numbers::pi_v<float>, { points[1], points[2] });
                    cached = SkGradientShader::MakeSweep(points[1], points[2], colors.data(), nullptr, positions.data(),
                                                         count, SkTileMode::kClamp, 0, 360, premul, &rotation);
                    break;
                }
                case Kind::Pattern:
                    break;
            }
            return cached;
        }

        void changed() { cached = nullptr; }

    private:
        [[nodiscard]] sk_sp<SkShader> patternShader() const
        {
            return image != nullptr ? image->makeShader(tileX, tileY, SkSamplingOptions(SkFilterMode::kLinear))
                                    : nullptr;
        }

        sk_sp<SkShader> cached;
    };

    namespace
    {
        constexpr double twoPi = 2 * std::numbers::pi;

        SkColor4f colorOf(ui::Color color)
        {
            return SkColor4f::FromColor(SkColorSetARGB(color.a, color.r, color.g, color.b));
        }

        std::string serialize(const SkColor4f& color)
        {
            const SkColor c = color.toSkColor();
            char text[64];
            if (SkColorGetA(c) == 255)
                std::snprintf(text, sizeof text, "#%02x%02x%02x", SkColorGetR(c), SkColorGetG(c), SkColorGetB(c));
            else
            {
                // The alpha as the Web prints it: the shortest decimal that reads back the same byte.
                std::string alpha = "0";
                for (int digits = 1; digits <= 3; ++digits)
                {
                    char buffer[16];
                    std::snprintf(buffer, sizeof buffer, "%.*f", digits, SkColorGetA(c) / 255.0);
                    if (std::lround(std::strtod(buffer, nullptr) * 255) == static_cast<long>(SkColorGetA(c)))
                    {
                        alpha = buffer;
                        break;
                    }
                }
                while (alpha.find('.') != std::string::npos && (alpha.back() == '0' || alpha.back() == '.'))
                {
                    const bool dot = alpha.back() == '.';
                    alpha.pop_back();
                    if (dot)
                        break;
                }
                std::snprintf(text, sizeof text, "rgba(%u, %u, %u, %s)", SkColorGetR(c), SkColorGetG(c), SkColorGetB(c),
                              alpha.c_str());
            }
            return text;
        }

        struct NamedBlend
        {
            std::string_view name;
            SkBlendMode mode;
        };

        constexpr NamedBlend blends[] = {
            { "source-over", SkBlendMode::kSrcOver },
            { "source-in", SkBlendMode::kSrcIn },
            { "source-out", SkBlendMode::kSrcOut },
            { "source-atop", SkBlendMode::kSrcATop },
            { "destination-over", SkBlendMode::kDstOver },
            { "destination-in", SkBlendMode::kDstIn },
            { "destination-out", SkBlendMode::kDstOut },
            { "destination-atop", SkBlendMode::kDstATop },
            { "lighter", SkBlendMode::kPlus },
            { "copy", SkBlendMode::kSrc },
            { "xor", SkBlendMode::kXor },
            { "multiply", SkBlendMode::kMultiply },
            { "screen", SkBlendMode::kScreen },
            { "overlay", SkBlendMode::kOverlay },
            { "darken", SkBlendMode::kDarken },
            { "lighten", SkBlendMode::kLighten },
            { "color-dodge", SkBlendMode::kColorDodge },
            { "color-burn", SkBlendMode::kColorBurn },
            { "hard-light", SkBlendMode::kHardLight },
            { "soft-light", SkBlendMode::kSoftLight },
            { "difference", SkBlendMode::kDifference },
            { "exclusion", SkBlendMode::kExclusion },
            { "hue", SkBlendMode::kHue },
            { "saturation", SkBlendMode::kSaturation },
            { "color", SkBlendMode::kColor },
            { "luminosity", SkBlendMode::kLuminosity },
        };

        // Modes that affect pixels outside the shape too (the shape's
        // transparent surroundings are composited as well), as on the Web.
        bool unbounded(SkBlendMode mode)
        {
            return mode == SkBlendMode::kSrcIn || mode == SkBlendMode::kSrcOut || mode == SkBlendMode::kDstIn
                   || mode == SkBlendMode::kDstATop || mode == SkBlendMode::kSrc;
        }

        enum class Align : std::uint8_t
        {
            Start,
            End,
            Left,
            Right,
            Center,
        };
        constexpr std::array<std::string_view, 5> alignNames { "start", "end", "left", "right", "center" };

        enum class Baseline : std::uint8_t
        {
            Top,
            Hanging,
            Middle,
            Alphabetic,
            Ideographic,
            Bottom,
        };
        constexpr std::array<std::string_view, 6> baselineNames { "top",        "hanging",     "middle",
                                                                  "alphabetic", "ideographic", "bottom" };

        template <typename Enum, std::size_t N>
        bool pick(std::string_view name, const std::array<std::string_view, N>& names, Enum& out)
        {
            const auto found = std::ranges::find(names, name);
            if (found == names.end())
                return false;
            out = static_cast<Enum>(found - names.begin());
            return true;
        }

        struct Font
        {
            ui::TextStyle style;
            std::string serialized = "10px sans-serif";
        };

        std::string lower(std::string_view text)
        {
            std::string out(text);
            for (char& c : out)
                c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
            return out;
        }

        // A CSS font shorthand: [style] [variant] [weight] size[/line-height] family.
        std::optional<Font> parseFont(std::string_view text)
        {
            Font font;
            font.style.fontSize = 10;
            std::size_t at = 0;
            const auto skipSpace = [&]
            {
                while (at < text.size() && std::isspace(static_cast<unsigned char>(text[at])))
                    ++at;
            };
            const auto word = [&]
            {
                skipSpace();
                const std::size_t start = at;
                while (at < text.size() && ! std::isspace(static_cast<unsigned char>(text[at])))
                    ++at;
                return text.substr(start, at - start);
            };
            std::string serializedPrefix;
            for (;;)
            {
                const std::size_t before = at;
                const std::string token = lower(word());
                if (token.empty())
                    return std::nullopt;
                if (token == "normal")
                    continue;
                if (token == "italic" || token == "oblique")
                {
                    font.style.fontStyle = ui::FontStyle::Italic;
                    serializedPrefix += "italic ";
                    continue;
                }
                if (token == "small-caps")
                    return std::nullopt; // not supported: refuse rather than draw it wrong
                if (token == "bold" || token == "bolder")
                {
                    font.style.fontWeight = 700;
                    serializedPrefix += "bold ";
                    continue;
                }
                if (token == "lighter")
                {
                    font.style.fontWeight = 300;
                    serializedPrefix += "300 ";
                    continue;
                }
                int weight = 0;
                if (std::from_chars(token.data(), token.data() + token.size(), weight).ec == std::errc {}
                    && std::to_string(weight) == token && weight >= 1 && weight <= 1000)
                {
                    font.style.fontWeight = weight;
                    if (weight != 400)
                        serializedPrefix += weight == 700 ? "bold " : token + " ";
                    continue;
                }
                // The size (and maybe a line height after a slash).
                at = before;
                skipSpace();
                break;
            }
            std::size_t end = at;
            while (end < text.size() && ! std::isspace(static_cast<unsigned char>(text[end])) && text[end] != '/')
                ++end;
            const std::string size = lower(text.substr(at, end - at));
            double value = 0;
            const auto [rest, error] = std::from_chars(size.data(), size.data() + size.size(), value);
            if (error != std::errc {} || value < 0)
                return std::nullopt;
            const std::string_view unit(rest, static_cast<std::size_t>(size.data() + size.size() - rest));
            if (unit == "px")
                font.style.fontSize = static_cast<float>(value);
            else if (unit == "pt")
                font.style.fontSize = static_cast<float>(value * 4 / 3);
            else if (unit == "em" || unit == "rem")
                font.style.fontSize = static_cast<float>(value * 10);
            else if (unit == "%")
                font.style.fontSize = static_cast<float>(value / 10);
            else
                return std::nullopt;
            at = end;
            if (at < text.size() && text[at] == '/')
            {
                ++at;
                word(); // the line height: no effect on canvas text
            }
            skipSpace();
            std::string_view families = text.substr(at);
            if (families.empty())
                return std::nullopt;
            // The first family; generic ones are the platform's own.
            std::string_view first = families.substr(0, families.find(','));
            while (! first.empty() && std::isspace(static_cast<unsigned char>(first.back())))
                first.remove_suffix(1);
            if (first.size() >= 2 && (first.front() == '"' || first.front() == '\'') && first.back() == first.front())
                first = first.substr(1, first.size() - 2);
            const std::string generic = lower(first);
            font.style.fontFamily = generic == "sans-serif" || generic == "system-ui" ? "" : std::string(first);
            char sizeText[32];
            std::snprintf(sizeText, sizeof sizeText, "%gpx", static_cast<double>(font.style.fontSize));
            font.serialized = serializedPrefix + sizeText + " " + std::string(families);
            return font;
        }

        // Angles as the Web canonicalizes them for arc() and ellipse().
        std::pair<double, double> arcAngles(double start, double end, bool counterclockwise)
        {
            double canonical = std::fmod(start, twoPi);
            if (canonical < 0)
                canonical += twoPi;
            end += canonical - start;
            start = canonical;
            if (! counterclockwise && end - start >= twoPi)
                end = start + twoPi;
            else if (counterclockwise && start - end >= twoPi)
                end = start - twoPi;
            else if (! counterclockwise && start > end)
                end = start + (twoPi - std::fmod(start - end, twoPi));
            else if (counterclockwise && start < end)
                end = start - (twoPi - std::fmod(end - start, twoPi));
            return { start, end - start };
        }

        float degrees(double radians)
        {
            return static_cast<float>(radians * 180 / std::numbers::pi);
        }
    } // namespace

    // ── Context ──────────────────────────────────────────────────────────────

    struct Canvas2D::Impl
    {
        struct Style
        {
            SkColor4f color = SkColors::kBlack;
            std::shared_ptr<Paint> paint;
        };

        struct State
        {
            Style fill;
            Style stroke;
            float globalAlpha = 1;
            SkBlendMode blend = SkBlendMode::kSrcOver;
            float lineWidth = 1;
            SkPaint::Cap cap = SkPaint::kButt_Cap;
            SkPaint::Join join = SkPaint::kMiter_Join;
            float miterLimit = 10;
            std::vector<double> dash;
            float dashOffset = 0;
            Font font;
            Align align = Align::Start;
            Baseline baseline = Baseline::Alphabetic;
            bool smoothing = true;
        };

        std::shared_ptr<ui::CanvasBuffer> buffer;
        std::shared_ptr<ui::ImageSource> images;
        std::unique_ptr<SkCanvas> canvas;
        std::uint64_t seenResets = 0;
        std::vector<State> states { State {} };
        // In canvas pixels: each point is transformed when it is added.
        SkPathBuilder path;
        bool hasCurrentPoint = false;
        std::unique_ptr<SkiaTextEngine> shaper;

        State& state() { return states.back(); }
        [[nodiscard]] const State& state() const { return states.back(); }

        // The canvas over the buffer; a (re)sized buffer resets everything.
        SkCanvas& surface()
        {
            if (canvas == nullptr || seenResets != buffer->resets)
            {
                const Bitmap bitmap = buffer->pixels.bitmap();
                canvas = SkCanvas::MakeRasterDirect(
                    SkImageInfo::Make(std::max(bitmap.width, 1), std::max(bitmap.height, 1), kBGRA_8888_SkColorType,
                                      kPremul_SkAlphaType),
                    bitmap.empty() ? &scratchPixel : bitmap.pixels, bitmap.empty() ? 4 : bitmap.rowBytes);
                seenResets = buffer->resets;
                states.assign(1, State {});
                path.reset();
                hasCurrentPoint = false;
            }
            return *canvas;
        }

        [[nodiscard]] SkMatrix matrix() { return surface().getTotalMatrix(); }

        void drawn() { buffer->drawn = true; }

        [[nodiscard]] SkPaint paintFor(const Style& style, bool stroke) const
        {
            const State& current = state();
            SkPaint paint;
            paint.setAntiAlias(true);
            if (style.paint != nullptr)
            {
                paint.setShader(style.paint->shader());
                paint.setAlphaf(current.globalAlpha);
                // A gradient that paints nothing (no stops, a point line).
                if (paint.getShader() == nullptr)
                    paint.setColor(SK_ColorTRANSPARENT);
            }
            else
            {
                SkColor4f color = style.color;
                color.fA *= current.globalAlpha;
                paint.setColor4f(color);
            }
            if (! unbounded(current.blend))
                paint.setBlendMode(current.blend);
            if (stroke)
            {
                paint.setStyle(SkPaint::kStroke_Style);
                paint.setStrokeWidth(current.lineWidth);
                paint.setStrokeCap(current.cap);
                paint.setStrokeJoin(current.join);
                paint.setStrokeMiter(current.miterLimit);
                if (! current.dash.empty())
                {
                    std::vector<float> intervals(current.dash.begin(), current.dash.end());
                    paint.setPathEffect(
                        SkDashPathEffect::Make({ intervals.data(), intervals.size() }, current.dashOffset));
                }
            }
            return paint;
        }

        // Draws with the state's compositing: modes that reach past the shape
        // draw it into a layer composited over the whole clip.
        template <typename Draw>
        void composite(Draw&& draw)
        {
            SkCanvas& into = surface();
            if (unbounded(state().blend))
            {
                SkPaint layer;
                layer.setBlendMode(state().blend);
                into.saveLayer(nullptr, &layer);
                draw(into);
                into.restore();
            }
            else
                draw(into);
            drawn();
        }

        // The current path in user space, for drawing under the transform;
        // nothing when the transform cannot be inverted.
        std::optional<SkPath> userPath(bool evenOdd)
        {
            SkMatrix inverse;
            if (! matrix().invert(&inverse))
                return std::nullopt;
            return path.snapshot(&inverse).makeFillType(evenOdd ? SkPathFillType::kEvenOdd : SkPathFillType::kWinding);
        }

        void ensureSubpath(double x, double y)
        {
            if (! hasCurrentPoint)
                moveTo(x, y);
        }

        void moveTo(double x, double y)
        {
            path.moveTo(matrix().mapPoint({ static_cast<float>(x), static_cast<float>(y) }));
            hasCurrentPoint = true;
        }

        // Appends a piece built in user space (then `local`), joined to the
        // current point.
        void append(const SkPathBuilder& piece, const SkMatrix& local = SkMatrix::I())
        {
            const SkMatrix mapping = SkMatrix::Concat(matrix(), local);
            path.addPath(piece.snapshot(&mapping), 0, 0,
                         hasCurrentPoint ? SkPath::kExtend_AddPathMode : SkPath::kAppend_AddPathMode);
            hasCurrentPoint = true;
        }

        void arc(double x, double y, double rx, double ry, double rotation, double start, double end,
                 bool counterclockwise)
        {
            const auto [from, sweep] = arcAngles(start, end, counterclockwise);
            const SkRect oval = SkRect::MakeLTRB(static_cast<float>(x - rx), static_cast<float>(y - ry),
                                                 static_cast<float>(x + rx), static_cast<float>(y + ry));
            SkPathBuilder piece;
            const float startDegrees = degrees(from);
            const float sweepDegrees = degrees(sweep);
            if (std::abs(sweepDegrees) >= 359.999f)
            {
                // A whole turn, in two halves (one arc of 360° is empty).
                piece.arcTo(oval, startDegrees, sweepDegrees / 2, true);
                piece.arcTo(oval, startDegrees + sweepDegrees / 2, sweepDegrees / 2, false);
            }
            else
                piece.arcTo(oval, startDegrees, sweepDegrees, true);
            append(piece, SkMatrix::RotateDeg(degrees(rotation), { static_cast<float>(x), static_cast<float>(y) }));
        }

        void drawText(std::string_view text, double x, double y, std::optional<double> maxWidth, bool stroke)
        {
            if (maxWidth && ! (*maxWidth > 0))
                return;
            SkiaTextEngine& engine = textEngine();
            const State& current = state();
            const ui::TextStyle& style = current.font.style;
            const float natural = engine.advance(text, style);
            const ui::TextEngine::Metrics metrics = engine.metrics(style);
            // Squeezed horizontally to fit maxWidth, then aligned.
            const float squeeze = maxWidth && natural > *maxWidth ? static_cast<float>(*maxWidth) / natural : 1.0f;
            const float width = natural * squeeze;
            auto left = static_cast<float>(x);
            switch (current.align)
            {
                case Align::Start:
                case Align::Left:
                    break;
                case Align::End:
                case Align::Right:
                    left -= width;
                    break;
                case Align::Center:
                    left -= width / 2;
                    break;
            }
            auto baseline = static_cast<float>(y);
            switch (current.baseline)
            {
                case Baseline::Top:
                    baseline += metrics.ascent;
                    break;
                case Baseline::Hanging:
                    baseline += metrics.ascent * 0.8f;
                    break;
                case Baseline::Middle:
                    baseline += (metrics.ascent - metrics.descent) / 2;
                    break;
                case Baseline::Alphabetic:
                    break;
                case Baseline::Ideographic:
                case Baseline::Bottom:
                    baseline -= metrics.descent;
                    break;
            }
            const SkPaint paint = paintFor(stroke ? current.stroke : current.fill, stroke);
            composite(
                [&](SkCanvas& into)
                {
                    into.save();
                    into.translate(left, baseline);
                    into.scale(squeeze, 1);
                    engine.draw(into, text, style, 0, 0, paint);
                    into.restore();
                });
        }

        SkiaTextEngine& textEngine()
        {
            if (shaper == nullptr)
                shaper = std::make_unique<SkiaTextEngine>();
            return *shaper;
        }

        void drawImage(const sk_sp<SkImage>& image, SkRect source, SkRect destination)
        {
            // Rectangles may be given backwards.
            source.sort();
            destination.sort();
            if (source.isEmpty() || destination.isEmpty())
                return;
            // A source reaching past the image is clipped, and the destination with it.
            const SkRect bounds = SkRect::MakeIWH(image->width(), image->height());
            SkRect clipped = source;
            if (! clipped.intersect(bounds))
                return;
            const float scaleX = destination.width() / source.width();
            const float scaleY = destination.height() / source.height();
            destination = SkRect::MakeLTRB(destination.left() + (clipped.left() - source.left()) * scaleX,
                                           destination.top() + (clipped.top() - source.top()) * scaleY,
                                           destination.right() - (source.right() - clipped.right()) * scaleX,
                                           destination.bottom() - (source.bottom() - clipped.bottom()) * scaleY);
            SkPaint paint;
            paint.setAlphaf(state().globalAlpha);
            if (! unbounded(state().blend))
                paint.setBlendMode(state().blend);
            const SkSamplingOptions sampling = state().smoothing ? SkSamplingOptions(SkFilterMode::kLinear)
                                                                 : SkSamplingOptions(SkFilterMode::kNearest);
            composite(
                [&](SkCanvas& into) {
                    into.drawImageRect(image, clipped, destination, sampling, &paint,
                                       SkCanvas::kStrict_SrcRectConstraint);
                });
        }

        std::uint32_t scratchPixel = 0;
    };

    Canvas2D::Canvas2D(std::shared_ptr<ui::CanvasBuffer> canvasBuffer, std::shared_ptr<ui::ImageSource> images)
        : target(std::move(canvasBuffer)), impl(std::make_unique<Impl>())
    {
        impl->buffer = target;
        impl->images = std::move(images);
        impl->surface();
    }

    Canvas2D::~Canvas2D() = default;

    void Canvas2D::sync()
    {
        impl->surface();
    }

    // ── State ────────────────────────────────────────────────────────────────

    void Canvas2D::save()
    {
        impl->surface().save();
        impl->states.push_back(impl->state());
    }

    void Canvas2D::restore()
    {
        if (impl->states.size() <= 1)
            return;
        impl->surface().restore();
        impl->states.pop_back();
    }

    void Canvas2D::reset()
    {
        SkCanvas& canvas = impl->surface();
        canvas.restoreToCount(1);
        canvas.resetMatrix();
        canvas.clear(SK_ColorTRANSPARENT);
        impl->states.assign(1, Impl::State {});
        impl->path.reset();
        impl->hasCurrentPoint = false;
        impl->drawn();
    }

    double Canvas2D::globalAlpha() const noexcept
    {
        return impl->state().globalAlpha;
    }

    void Canvas2D::setGlobalAlpha(double alpha)
    {
        if (alpha >= 0 && alpha <= 1)
            impl->state().globalAlpha = static_cast<float>(alpha);
    }

    std::string Canvas2D::globalCompositeOperation() const
    {
        for (const NamedBlend& blend : blends)
            if (blend.mode == impl->state().blend)
                return std::string(blend.name);
        return "source-over";
    }

    bool Canvas2D::setGlobalCompositeOperation(std::string_view name)
    {
        for (const NamedBlend& blend : blends)
            if (blend.name == name)
            {
                impl->state().blend = blend.mode;
                return true;
            }
        return false;
    }

    // ── Transforms ───────────────────────────────────────────────────────────

    void Canvas2D::scale(double x, double y)
    {
        impl->surface().scale(static_cast<float>(x), static_cast<float>(y));
    }

    void Canvas2D::rotate(double angle)
    {
        impl->surface().rotate(degrees(angle));
    }

    void Canvas2D::translate(double x, double y)
    {
        impl->surface().translate(static_cast<float>(x), static_cast<float>(y));
    }

    void Canvas2D::transform(double a, double b, double c, double d, double e, double f)
    {
        impl->surface().concat(SkMatrix::MakeAll(static_cast<float>(a), static_cast<float>(c), static_cast<float>(e),
                                                 static_cast<float>(b), static_cast<float>(d), static_cast<float>(f), 0,
                                                 0, 1));
    }

    void Canvas2D::setTransform(double a, double b, double c, double d, double e, double f)
    {
        impl->surface().resetMatrix();
        transform(a, b, c, d, e, f);
    }

    void Canvas2D::resetTransform()
    {
        impl->surface().resetMatrix();
    }

    std::array<double, 6> Canvas2D::getTransform() const
    {
        const SkMatrix m = impl->matrix();
        return { m.getScaleX(), m.getSkewY(), m.getSkewX(), m.getScaleY(), m.getTranslateX(), m.getTranslateY() };
    }

    // ── Styles ───────────────────────────────────────────────────────────────

    bool Canvas2D::setFillColor(std::string_view color)
    {
        const auto parsed = ui::parseColor(color);
        if (! parsed)
            return false;
        impl->state().fill = { colorOf(*parsed), nullptr };
        return true;
    }

    bool Canvas2D::setStrokeColor(std::string_view color)
    {
        const auto parsed = ui::parseColor(color);
        if (! parsed)
            return false;
        impl->state().stroke = { colorOf(*parsed), nullptr };
        return true;
    }

    void Canvas2D::setFillPaint(std::shared_ptr<Paint> paint)
    {
        impl->state().fill.paint = std::move(paint);
    }

    void Canvas2D::setStrokePaint(std::shared_ptr<Paint> paint)
    {
        impl->state().stroke.paint = std::move(paint);
    }

    std::string Canvas2D::fillColor() const
    {
        return serialize(impl->state().fill.color);
    }

    std::string Canvas2D::strokeColor() const
    {
        return serialize(impl->state().stroke.color);
    }

    std::shared_ptr<Paint> Canvas2D::linearGradient(double x0, double y0, double x1, double y1)
    {
        auto paint = std::make_shared<Paint>();
        paint->kind = Paint::Kind::Linear;
        paint->points = {
            static_cast<float>(x0), static_cast<float>(y0), static_cast<float>(x1), static_cast<float>(y1), 0, 0
        };
        return paint;
    }

    std::shared_ptr<Paint> Canvas2D::radialGradient(double x0, double y0, double r0, double x1, double y1, double r1)
    {
        auto paint = std::make_shared<Paint>();
        paint->kind = Paint::Kind::Radial;
        paint->points = { static_cast<float>(x0), static_cast<float>(y0), static_cast<float>(r0),
                          static_cast<float>(x1), static_cast<float>(y1), static_cast<float>(r1) };
        return paint;
    }

    std::shared_ptr<Paint> Canvas2D::conicGradient(double angle, double x, double y)
    {
        auto paint = std::make_shared<Paint>();
        paint->kind = Paint::Kind::Conic;
        paint->points = { static_cast<float>(angle), static_cast<float>(x), static_cast<float>(y), 0, 0, 0 };
        return paint;
    }

    bool Canvas2D::addColorStop(Paint& gradient, double offset, std::string_view color)
    {
        const auto parsed = ui::parseColor(color);
        if (! parsed)
            return false;
        // After every stop at the same offset: stops keep the order they came in.
        const auto at = std::ranges::upper_bound(gradient.stops, static_cast<float>(offset), {},
                                                 &std::pair<float, SkColor4f>::first);
        gradient.stops.insert(at, { static_cast<float>(offset), colorOf(*parsed) });
        gradient.changed();
        return true;
    }

    std::shared_ptr<Paint> Canvas2D::pattern(const ui::CanvasBuffer& source, std::string_view repetition) const
    {
        auto paint = std::make_shared<Paint>();
        paint->kind = Paint::Kind::Pattern;
        const RasterSurface& pixels = source.pixels;
        if (pixels.width() > 0 && pixels.height() > 0)
            // The source as it is now: later drawing does not change the pattern.
            paint->image = SkImages::RasterFromPixmapCopy(SkPixmap(
                SkImageInfo::Make(pixels.width(), pixels.height(), kBGRA_8888_SkColorType, kPremul_SkAlphaType),
                pixels.pixels(), static_cast<std::size_t>(pixels.width()) * 4));
        const bool repeatX = repetition.empty() || repetition == "repeat" || repetition == "repeat-x";
        const bool repeatY = repetition.empty() || repetition == "repeat" || repetition == "repeat-y";
        paint->tileX = repeatX ? SkTileMode::kRepeat : SkTileMode::kDecal;
        paint->tileY = repeatY ? SkTileMode::kRepeat : SkTileMode::kDecal;
        return paint;
    }

    void Canvas2D::setLineWidth(double width)
    {
        if (width > 0)
            impl->state().lineWidth = static_cast<float>(width);
    }

    double Canvas2D::lineWidth() const noexcept
    {
        return impl->state().lineWidth;
    }

    bool Canvas2D::setLineCap(std::string_view cap)
    {
        static constexpr std::array<std::string_view, 3> names { "butt", "round", "square" };
        return pick(cap, names, impl->state().cap);
    }

    std::string Canvas2D::lineCap() const
    {
        static constexpr std::array<std::string_view, 3> names { "butt", "round", "square" };
        return std::string(names[static_cast<std::size_t>(impl->state().cap)]);
    }

    bool Canvas2D::setLineJoin(std::string_view join)
    {
        // Skia's order: miter, round, bevel.
        static constexpr std::array<std::string_view, 3> names { "miter", "round", "bevel" };
        return pick(join, names, impl->state().join);
    }

    std::string Canvas2D::lineJoin() const
    {
        static constexpr std::array<std::string_view, 3> names { "miter", "round", "bevel" };
        return std::string(names[static_cast<std::size_t>(impl->state().join)]);
    }

    void Canvas2D::setMiterLimit(double limit)
    {
        if (limit > 0)
            impl->state().miterLimit = static_cast<float>(limit);
    }

    double Canvas2D::miterLimit() const noexcept
    {
        return impl->state().miterLimit;
    }

    void Canvas2D::setLineDash(std::vector<double> segments)
    {
        if (std::ranges::any_of(segments, [](double segment) { return ! (segment >= 0); }))
            return;
        // An odd list repeats itself, as on the Web.
        if (segments.size() % 2 == 1)
            segments.insert(segments.end(), segments.begin(), segments.end());
        impl->state().dash = std::move(segments);
    }

    std::vector<double> Canvas2D::lineDash() const
    {
        return impl->state().dash;
    }

    void Canvas2D::setLineDashOffset(double offset)
    {
        impl->state().dashOffset = static_cast<float>(offset);
    }

    double Canvas2D::lineDashOffset() const noexcept
    {
        return impl->state().dashOffset;
    }

    // ── Rectangles ───────────────────────────────────────────────────────────

    void Canvas2D::clearRect(double x, double y, double width, double height)
    {
        SkPaint paint;
        paint.setBlendMode(SkBlendMode::kClear);
        impl->surface().drawRect(SkRect::MakeXYWH(static_cast<float>(x), static_cast<float>(y),
                                                  static_cast<float>(width), static_cast<float>(height))
                                     .makeSorted(),
                                 paint);
        impl->drawn();
    }

    void Canvas2D::fillRect(double x, double y, double width, double height)
    {
        const SkPaint paint = impl->paintFor(impl->state().fill, false);
        const SkRect rect = SkRect::MakeXYWH(static_cast<float>(x), static_cast<float>(y), static_cast<float>(width),
                                             static_cast<float>(height))
                                .makeSorted();
        impl->composite([&](SkCanvas& canvas) { canvas.drawRect(rect, paint); });
    }

    void Canvas2D::strokeRect(double x, double y, double width, double height)
    {
        const SkPaint paint = impl->paintFor(impl->state().stroke, true);
        const SkRect rect = SkRect::MakeXYWH(static_cast<float>(x), static_cast<float>(y), static_cast<float>(width),
                                             static_cast<float>(height))
                                .makeSorted();
        impl->composite([&](SkCanvas& canvas) { canvas.drawRect(rect, paint); });
    }

    // ── Paths ────────────────────────────────────────────────────────────────

    void Canvas2D::beginPath()
    {
        impl->path.reset();
        impl->hasCurrentPoint = false;
    }

    void Canvas2D::closePath()
    {
        if (impl->hasCurrentPoint)
            impl->path.close();
    }

    void Canvas2D::moveTo(double x, double y)
    {
        impl->moveTo(x, y);
    }

    void Canvas2D::lineTo(double x, double y)
    {
        if (! impl->hasCurrentPoint)
        {
            impl->moveTo(x, y);
            return;
        }
        impl->path.lineTo(impl->matrix().mapPoint({ static_cast<float>(x), static_cast<float>(y) }));
    }

    void Canvas2D::quadraticCurveTo(double cx, double cy, double x, double y)
    {
        impl->ensureSubpath(cx, cy);
        const SkMatrix m = impl->matrix();
        impl->path.quadTo(m.mapPoint({ static_cast<float>(cx), static_cast<float>(cy) }),
                          m.mapPoint({ static_cast<float>(x), static_cast<float>(y) }));
    }

    void Canvas2D::bezierCurveTo(double c1x, double c1y, double c2x, double c2y, double x, double y)
    {
        impl->ensureSubpath(c1x, c1y);
        const SkMatrix m = impl->matrix();
        impl->path.cubicTo(m.mapPoint({ static_cast<float>(c1x), static_cast<float>(c1y) }),
                           m.mapPoint({ static_cast<float>(c2x), static_cast<float>(c2y) }),
                           m.mapPoint({ static_cast<float>(x), static_cast<float>(y) }));
    }

    void Canvas2D::arcTo(double x1, double y1, double x2, double y2, double radius)
    {
        impl->ensureSubpath(x1, y1);
        SkMatrix inverse;
        const std::optional<SkPoint> last = impl->path.getLastPt();
        if (! impl->matrix().invert(&inverse) || ! last)
            return;
        SkPathBuilder piece;
        piece.moveTo(inverse.mapPoint(*last));
        piece.arcTo({ static_cast<float>(x1), static_cast<float>(y1) },
                    { static_cast<float>(x2), static_cast<float>(y2) }, static_cast<float>(radius));
        impl->append(piece);
    }

    void Canvas2D::rect(double x, double y, double width, double height)
    {
        const SkMatrix m = impl->matrix();
        const auto point = [&](double px, double py)
        { return m.mapPoint({ static_cast<float>(px), static_cast<float>(py) }); };
        impl->path.moveTo(point(x, y));
        impl->path.lineTo(point(x + width, y));
        impl->path.lineTo(point(x + width, y + height));
        impl->path.lineTo(point(x, y + height));
        impl->path.close();
        impl->path.moveTo(point(x, y));
        impl->hasCurrentPoint = true;
    }

    void Canvas2D::roundRect(double x, double y, double width, double height, std::span<const double> radii)
    {
        // One to four radii: all corners; top-left/bottom-right and the
        // others; top-left, top-right/bottom-left, bottom-right; each.
        std::array<double, 4> corner {};
        switch (radii.size())
        {
            case 1:
                corner = { radii[0], radii[0], radii[0], radii[0] };
                break;
            case 2:
                corner = { radii[0], radii[1], radii[0], radii[1] };
                break;
            case 3:
                corner = { radii[0], radii[1], radii[2], radii[1] };
                break;
            case 4:
                corner = { radii[0], radii[1], radii[2], radii[3] };
                break;
            default:
                return;
        }
        SkRect bounds = SkRect::MakeXYWH(static_cast<float>(x), static_cast<float>(y), static_cast<float>(width),
                                         static_cast<float>(height));
        bounds.sort();
        const SkVector vectors[4] = { { static_cast<float>(corner[0]), static_cast<float>(corner[0]) },
                                      { static_cast<float>(corner[1]), static_cast<float>(corner[1]) },
                                      { static_cast<float>(corner[2]), static_cast<float>(corner[2]) },
                                      { static_cast<float>(corner[3]), static_cast<float>(corner[3]) } };
        SkRRect rounded;
        rounded.setRectRadii(bounds, vectors);
        SkPathBuilder piece;
        piece.addRRect(rounded);
        const SkMatrix matrix = impl->matrix();
        impl->path.addPath(piece.snapshot(&matrix), 0, 0);
        impl->path.moveTo(impl->matrix().mapPoint({ static_cast<float>(x), static_cast<float>(y) }));
        impl->hasCurrentPoint = true;
    }

    void Canvas2D::arc(double x, double y, double radius, double start, double end, bool counterclockwise)
    {
        impl->arc(x, y, radius, radius, 0, start, end, counterclockwise);
    }

    void Canvas2D::ellipse(double x, double y, double radiusX, double radiusY, double rotation, double start,
                           double end, bool counterclockwise)
    {
        impl->arc(x, y, radiusX, radiusY, rotation, start, end, counterclockwise);
    }

    void Canvas2D::fill(bool evenOdd)
    {
        const auto user = impl->userPath(evenOdd);
        if (! user)
            return;
        const SkPaint paint = impl->paintFor(impl->state().fill, false);
        impl->composite([&](SkCanvas& canvas) { canvas.drawPath(*user, paint); });
    }

    void Canvas2D::stroke()
    {
        const auto user = impl->userPath(false);
        if (! user)
            return;
        const SkPaint paint = impl->paintFor(impl->state().stroke, true);
        impl->composite([&](SkCanvas& canvas) { canvas.drawPath(*user, paint); });
    }

    void Canvas2D::clip(bool evenOdd)
    {
        const auto user = impl->userPath(evenOdd);
        if (user)
            impl->surface().clipPath(*user, true);
        else
            impl->surface().clipRect(SkRect::MakeEmpty());
    }

    bool Canvas2D::isPointInPath(double x, double y, bool evenOdd) const
    {
        return impl->path.snapshot()
            .makeFillType(evenOdd ? SkPathFillType::kEvenOdd : SkPathFillType::kWinding)
            .contains(static_cast<float>(x), static_cast<float>(y));
    }

    bool Canvas2D::isPointInStroke(double x, double y) const
    {
        const auto user = impl->userPath(false);
        if (! user)
            return false;
        const SkPath outline = skpathutils::FillPathWithPaint(*user, impl->paintFor(impl->state().stroke, true));
        return outline.makeTransform(impl->matrix()).contains(static_cast<float>(x), static_cast<float>(y));
    }

    // ── Text ─────────────────────────────────────────────────────────────────

    bool Canvas2D::setFont(std::string_view font)
    {
        auto parsed = parseFont(font);
        if (! parsed)
            return false;
        impl->state().font = std::move(*parsed);
        return true;
    }

    std::string Canvas2D::font() const
    {
        return impl->state().font.serialized;
    }

    bool Canvas2D::setTextAlign(std::string_view align)
    {
        return pick(align, alignNames, impl->state().align);
    }

    std::string Canvas2D::textAlign() const
    {
        return std::string(alignNames[static_cast<std::size_t>(impl->state().align)]);
    }

    bool Canvas2D::setTextBaseline(std::string_view baseline)
    {
        return pick(baseline, baselineNames, impl->state().baseline);
    }

    std::string Canvas2D::textBaseline() const
    {
        return std::string(baselineNames[static_cast<std::size_t>(impl->state().baseline)]);
    }

    void Canvas2D::fillText(std::string_view text, double x, double y, std::optional<double> maxWidth)
    {
        impl->drawText(text, x, y, maxWidth, false);
    }

    void Canvas2D::strokeText(std::string_view text, double x, double y, std::optional<double> maxWidth)
    {
        impl->drawText(text, x, y, maxWidth, true);
    }

    Canvas2D::TextMetrics Canvas2D::measureText(std::string_view text)
    {
        SkiaTextEngine& engine = impl->textEngine();
        const ui::TextStyle& style = impl->state().font.style;
        const ui::TextEngine::Metrics metrics = engine.metrics(style);
        return { engine.advance(text, style), metrics.ascent, metrics.descent };
    }

    // ── Pixels ───────────────────────────────────────────────────────────────

    void Canvas2D::setImageSmoothing(bool enabled)
    {
        impl->state().smoothing = enabled;
    }

    bool Canvas2D::imageSmoothing() const noexcept
    {
        return impl->state().smoothing;
    }

    void Canvas2D::drawCanvas(const ui::CanvasBuffer& source, double sx, double sy, double sw, double sh, double dx,
                              double dy, double dw, double dh)
    {
        const RasterSurface& pixels = source.pixels;
        if (pixels.width() == 0 || pixels.height() == 0)
            return;
        const SkPixmap pixmap(
            SkImageInfo::Make(pixels.width(), pixels.height(), kBGRA_8888_SkColorType, kPremul_SkAlphaType),
            pixels.pixels(), static_cast<std::size_t>(pixels.width()) * 4);
        // Drawing a canvas into itself reads a copy.
        const sk_sp<SkImage> image = &source == target.get() ? SkImages::RasterFromPixmapCopy(pixmap)
                                                             : SkImages::RasterFromPixmap(pixmap, nullptr, nullptr);
        if (image == nullptr)
            return;
        impl->drawImage(image,
                        SkRect::MakeXYWH(static_cast<float>(sx), static_cast<float>(sy), static_cast<float>(sw),
                                         static_cast<float>(sh)),
                        SkRect::MakeXYWH(static_cast<float>(dx), static_cast<float>(dy), static_cast<float>(dw),
                                         static_cast<float>(dh)));
    }

    bool Canvas2D::drawAsset(std::string_view asset, std::optional<std::array<double, 4>> sourceRect, double dx,
                             double dy, std::optional<double> dw, std::optional<double> dh)
    {
        auto* images = dynamic_cast<SkiaImages*>(impl->images.get());
        const sk_sp<SkImage> image = images != nullptr ? images->image(asset) : nullptr;
        if (image == nullptr)
            return false;
        const SkRect source =
            sourceRect ? SkRect::MakeXYWH(static_cast<float>((*sourceRect)[0]), static_cast<float>((*sourceRect)[1]),
                                          static_cast<float>((*sourceRect)[2]), static_cast<float>((*sourceRect)[3]))
                       : SkRect::MakeIWH(image->width(), image->height());
        impl->drawImage(image, source,
                        SkRect::MakeXYWH(static_cast<float>(dx), static_cast<float>(dy),
                                         static_cast<float>(dw.value_or(source.width())),
                                         static_cast<float>(dh.value_or(source.height()))));
        return true;
    }

    std::vector<std::uint8_t> Canvas2D::getImageData(int x, int y, int width, int height) const
    {
        std::vector<std::uint8_t> rgba(static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4, 0);
        const RasterSurface& pixels = target->pixels;
        if (rgba.empty() || pixels.width() == 0 || pixels.height() == 0)
            return rgba;
        const SkPixmap source(
            SkImageInfo::Make(pixels.width(), pixels.height(), kBGRA_8888_SkColorType, kPremul_SkAlphaType),
            pixels.pixels(), static_cast<std::size_t>(pixels.width()) * 4);
        // Only the part inside the canvas is read; the rest stays transparent.
        const SkIRect inside = SkIRect::MakeXYWH(x, y, width, height);
        SkIRect area = inside;
        if (! area.intersect(SkIRect::MakeWH(pixels.width(), pixels.height())))
            return rgba;
        const SkImageInfo destination =
            SkImageInfo::Make(area.width(), area.height(), kRGBA_8888_SkColorType, kUnpremul_SkAlphaType);
        std::uint8_t* at = rgba.data()
                           + (static_cast<std::size_t>(area.top() - y) * static_cast<std::size_t>(width)
                              + static_cast<std::size_t>(area.left() - x))
                                 * 4;
        source.readPixels(destination, at, static_cast<std::size_t>(width) * 4, area.left(), area.top());
        return rgba;
    }

    void Canvas2D::putImageData(std::span<const std::uint8_t> rgba, int width, int height, int dx, int dy, int dirtyX,
                                int dirtyY, int dirtyWidth, int dirtyHeight)
    {
        RasterSurface& pixels = target->pixels;
        if (pixels.width() == 0 || pixels.height() == 0
            || rgba.size() < static_cast<std::size_t>(width) * static_cast<std::size_t>(height) * 4)
            return;
        // The dirty rectangle within the image, then within the canvas.
        SkIRect dirty = SkIRect::MakeXYWH(dirtyX, dirtyY, dirtyWidth, dirtyHeight).makeSorted();
        if (! dirty.intersect(SkIRect::MakeWH(width, height)))
            return;
        SkIRect onCanvas = dirty.makeOffset(dx, dy);
        if (! onCanvas.intersect(SkIRect::MakeWH(pixels.width(), pixels.height())))
            return;
        const SkPixmap source(SkImageInfo::Make(width, height, kRGBA_8888_SkColorType, kUnpremul_SkAlphaType),
                              rgba.data(), static_cast<std::size_t>(width) * 4);
        const SkImageInfo destination =
            SkImageInfo::Make(onCanvas.width(), onCanvas.height(), kBGRA_8888_SkColorType, kPremul_SkAlphaType);
        auto* at = static_cast<std::uint8_t*>(pixels.bitmap().pixels)
                   + (static_cast<std::size_t>(onCanvas.top()) * static_cast<std::size_t>(pixels.width())
                      + static_cast<std::size_t>(onCanvas.left()))
                         * 4;
        source.readPixels(destination, at, static_cast<std::size_t>(pixels.width()) * 4, onCanvas.left() - dx,
                          onCanvas.top() - dy);
        impl->drawn();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
