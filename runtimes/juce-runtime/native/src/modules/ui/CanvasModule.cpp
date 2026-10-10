#include "modules/ui/CanvasModule.h"

#include "js/Bindings.h"
#include "render/Canvas2D.h"

#include <algorithm>
#include <cmath>
#include <map>
#include <memory>
#include <optional>
#include <span>
#include <stdexcept>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    namespace
    {
        namespace bind = js::bind;

        const char canvasKey = 0;

        // One context's canvases: their 2D contexts by node, and the
        // gradients and patterns its code made, by id.
        struct Canvases
        {
            std::map<NodeId, std::unique_ptr<render::Canvas2D>> contexts;
            std::map<std::uint32_t, std::shared_ptr<render::Paint>> paints;
            std::uint32_t nextPaint = 1;
        };

        Canvases& canvasesOf(JSContext* ctx)
        {
            auto* canvases = bind::contextData<Canvases>(ctx, &canvasKey);
            if (canvases == nullptr)
                throw std::logic_error("canvases are not installed in this context");
            return *canvases;
        }

        // Arguments are checked and converted by canvas.js; these only read them.
        struct Args
        {
            JSContext* ctx;
            int argc;
            JSValueConst* argv;

            [[nodiscard]] double number(int at) const
            {
                double out = 0;
                if (at >= argc || JS_ToFloat64(ctx, &out, argv[at]) < 0)
                    throw std::invalid_argument("expected a number");
                return out;
            }
            [[nodiscard]] int integer(int at) const { return static_cast<int>(std::lround(number(at))); }
            [[nodiscard]] std::optional<double> optional(int at) const
            {
                if (at >= argc || JS_IsUndefined(argv[at]))
                    return std::nullopt;
                return number(at);
            }
            [[nodiscard]] bool flag(int at) const { return at < argc && JS_ToBool(ctx, argv[at]) > 0; }
            [[nodiscard]] std::string string(int at) const
            {
                std::string out;
                if (at >= argc || ! bind::read(ctx, argv[at], bind::Path { "canvas" }, out))
                    throw std::invalid_argument("expected a string");
                return out;
            }
            [[nodiscard]] std::vector<double> numbers(int at) const
            {
                std::vector<double> out;
                if (at >= argc
                    || ! bind::readArray(ctx, argv[at], bind::Path { "canvas" }, out,
                                         [](JSContext* c, JSValueConst value, const bind::Path& path, double& element)
                                         { return bind::read(c, value, path, element); }))
                    throw std::invalid_argument("expected an array of numbers");
                return out;
            }
            [[nodiscard]] NodeId node(int at) const { return static_cast<NodeId>(number(at)); }
            // A Float64Array's numbers, borrowed for the call.
            [[nodiscard]] std::span<const double> doubles(int at) const
            {
                std::span<const double> out;
                if (at >= argc || ! bind::read(ctx, argv[at], bind::Path { "canvas" }, out))
                    throw std::invalid_argument("expected a Float64Array");
                return out;
            }
        };

        // Runs the path commands canvas.js gathered (Canvas2DOp::Path), in
        // order. They were checked as they were made; a batch that does not
        // decode is refused before anything of it runs.
        void runPath(render::Canvas2D& c, std::span<const double> commands)
        {
            const auto arity = [](double op) -> int
            {
                switch (static_cast<Canvas2DOp>(static_cast<int>(op)))
                {
                    case Canvas2DOp::BeginPath:
                    case Canvas2DOp::ClosePath:
                        return 0;
                    case Canvas2DOp::MoveTo:
                    case Canvas2DOp::LineTo:
                        return 2;
                    case Canvas2DOp::QuadraticCurveTo:
                    case Canvas2DOp::Rect:
                        return 4;
                    case Canvas2DOp::ArcTo:
                        return 5;
                    case Canvas2DOp::BezierCurveTo:
                    case Canvas2DOp::Arc:
                        return 6;
                    case Canvas2DOp::Ellipse:
                        return 8;
                    default:
                        return -1;
                }
            };
            for (std::size_t at = 0; at < commands.size();)
            {
                const double op = commands[at];
                const int count = op == std::trunc(op) && op >= 0 && op < 256 ? arity(op) : -1;
                if (count < 0 || at + 1 + static_cast<std::size_t>(count) > commands.size())
                    throw std::invalid_argument("malformed path commands");
                at += 1 + static_cast<std::size_t>(count);
            }
            for (std::size_t at = 0; at < commands.size();)
            {
                const auto op = static_cast<Canvas2DOp>(static_cast<int>(commands[at]));
                const double* v = commands.data() + at + 1;
                switch (op)
                {
                    case Canvas2DOp::BeginPath:
                        c.beginPath();
                        break;
                    case Canvas2DOp::ClosePath:
                        c.closePath();
                        break;
                    case Canvas2DOp::MoveTo:
                        c.moveTo(v[0], v[1]);
                        break;
                    case Canvas2DOp::LineTo:
                        c.lineTo(v[0], v[1]);
                        break;
                    case Canvas2DOp::QuadraticCurveTo:
                        c.quadraticCurveTo(v[0], v[1], v[2], v[3]);
                        break;
                    case Canvas2DOp::BezierCurveTo:
                        c.bezierCurveTo(v[0], v[1], v[2], v[3], v[4], v[5]);
                        break;
                    case Canvas2DOp::ArcTo:
                        c.arcTo(v[0], v[1], v[2], v[3], v[4]);
                        break;
                    case Canvas2DOp::Rect:
                        c.rect(v[0], v[1], v[2], v[3]);
                        break;
                    case Canvas2DOp::Arc:
                        c.arc(v[0], v[1], v[2], v[3], v[4], v[5] != 0);
                        break;
                    case Canvas2DOp::Ellipse:
                        c.ellipse(v[0], v[1], v[2], v[3], v[4], v[5], v[6], v[7] != 0);
                        break;
                    default:
                        break; // refused above
                }
                at += 1 + static_cast<std::size_t>(arity(commands[at]));
            }
        }

        render::Canvas2D& contextOf(JSContext* ctx, NodeId node)
        {
            Canvases& canvases = canvasesOf(ctx);
            auto found = canvases.contexts.find(node);
            if (found == canvases.contexts.end())
            {
                Surface& surface = surfaceOf(ctx);
                found =
                    canvases.contexts
                        .emplace(node, std::make_unique<render::Canvas2D>(surface.canvasBuffer(node), surface.images()))
                        .first;
            }
            return *found->second;
        }

        std::shared_ptr<render::Paint> paintOf(JSContext* ctx, double id)
        {
            const auto found = canvasesOf(ctx).paints.find(static_cast<std::uint32_t>(id));
            if (found == canvasesOf(ctx).paints.end())
                throw std::invalid_argument("unknown gradient or pattern");
            return found->second;
        }

        JSValue keep(JSContext* ctx, std::shared_ptr<render::Paint> paint)
        {
            Canvases& canvases = canvasesOf(ctx);
            const std::uint32_t id = canvases.nextPaint++;
            canvases.paints.emplace(id, std::move(paint));
            return JS_NewUint32(ctx, id);
        }

        JSValue numbers(JSContext* ctx, const std::vector<double>& values)
        {
            JSValue array = JS_NewArray(ctx);
            for (std::size_t i = 0; i < values.size(); ++i)
                JS_SetPropertyUint32(ctx, array, static_cast<std::uint32_t>(i), JS_NewFloat64(ctx, values[i]));
            return array;
        }

        JSValue string(JSContext* ctx, const std::string& value)
        {
            return JS_NewStringLen(ctx, value.data(), value.size());
        }

        // call2d(node, op, ...): one native entry for every 2D context method,
        // so a drawing call costs one crossing.
        JSValue call2d(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            const bind::NativeCall counted(ctx, bind::NativeApi::Canvas);
            if (! bind::expectArgumentCount(ctx, "call2d", argc, 2))
                return JS_EXCEPTION;
            return bind::invoke(
                ctx, "call2d",
                [&]() -> JSValue
                {
                    const Args all { ctx, argc, argv };
                    render::Canvas2D& c = contextOf(ctx, all.node(0));
                    c.sync();
                    const auto op = static_cast<Canvas2DOp>(all.integer(1));
                    const Args a { ctx, argc - 2, argv + 2 };
                    switch (op)
                    {
                        case Canvas2DOp::Save:
                            c.save();
                            break;
                        case Canvas2DOp::Restore:
                            c.restore();
                            break;
                        case Canvas2DOp::Reset:
                            c.reset();
                            break;
                        case Canvas2DOp::GlobalAlpha:
                            return JS_NewFloat64(ctx, c.globalAlpha());
                        case Canvas2DOp::SetGlobalAlpha:
                            c.setGlobalAlpha(a.number(0));
                            break;
                        case Canvas2DOp::CompositeOperation:
                            return string(ctx, c.globalCompositeOperation());
                        case Canvas2DOp::SetCompositeOperation:
                            return JS_NewBool(ctx, c.setGlobalCompositeOperation(a.string(0)));
                        case Canvas2DOp::Scale:
                            c.scale(a.number(0), a.number(1));
                            break;
                        case Canvas2DOp::Rotate:
                            c.rotate(a.number(0));
                            break;
                        case Canvas2DOp::Translate:
                            c.translate(a.number(0), a.number(1));
                            break;
                        case Canvas2DOp::Transform:
                            c.transform(a.number(0), a.number(1), a.number(2), a.number(3), a.number(4), a.number(5));
                            break;
                        case Canvas2DOp::SetTransform:
                            c.setTransform(a.number(0), a.number(1), a.number(2), a.number(3), a.number(4),
                                           a.number(5));
                            break;
                        case Canvas2DOp::ResetTransform:
                            c.resetTransform();
                            break;
                        case Canvas2DOp::GetTransform:
                        {
                            const auto m = c.getTransform();
                            return numbers(ctx, { m.begin(), m.end() });
                        }
                        case Canvas2DOp::SetFillColor:
                            return JS_NewBool(ctx, c.setFillColor(a.string(0)));
                        case Canvas2DOp::SetStrokeColor:
                            return JS_NewBool(ctx, c.setStrokeColor(a.string(0)));
                        case Canvas2DOp::SetFillPaint:
                            c.setFillPaint(paintOf(ctx, a.number(0)));
                            break;
                        case Canvas2DOp::SetStrokePaint:
                            c.setStrokePaint(paintOf(ctx, a.number(0)));
                            break;
                        case Canvas2DOp::FillColor:
                            return string(ctx, c.fillColor());
                        case Canvas2DOp::StrokeColor:
                            return string(ctx, c.strokeColor());
                        case Canvas2DOp::LineWidth:
                            return JS_NewFloat64(ctx, c.lineWidth());
                        case Canvas2DOp::SetLineWidth:
                            c.setLineWidth(a.number(0));
                            break;
                        case Canvas2DOp::LineCap:
                            return string(ctx, c.lineCap());
                        case Canvas2DOp::SetLineCap:
                            return JS_NewBool(ctx, c.setLineCap(a.string(0)));
                        case Canvas2DOp::LineJoin:
                            return string(ctx, c.lineJoin());
                        case Canvas2DOp::SetLineJoin:
                            return JS_NewBool(ctx, c.setLineJoin(a.string(0)));
                        case Canvas2DOp::MiterLimit:
                            return JS_NewFloat64(ctx, c.miterLimit());
                        case Canvas2DOp::SetMiterLimit:
                            c.setMiterLimit(a.number(0));
                            break;
                        case Canvas2DOp::LineDash:
                            return numbers(ctx, c.lineDash());
                        case Canvas2DOp::SetLineDash:
                            c.setLineDash(a.numbers(0));
                            break;
                        case Canvas2DOp::LineDashOffset:
                            return JS_NewFloat64(ctx, c.lineDashOffset());
                        case Canvas2DOp::SetLineDashOffset:
                            c.setLineDashOffset(a.number(0));
                            break;
                        case Canvas2DOp::ClearRect:
                            c.clearRect(a.number(0), a.number(1), a.number(2), a.number(3));
                            break;
                        case Canvas2DOp::FillRect:
                            c.fillRect(a.number(0), a.number(1), a.number(2), a.number(3));
                            break;
                        case Canvas2DOp::StrokeRect:
                            c.strokeRect(a.number(0), a.number(1), a.number(2), a.number(3));
                            break;
                        case Canvas2DOp::BeginPath:
                            c.beginPath();
                            break;
                        case Canvas2DOp::ClosePath:
                            c.closePath();
                            break;
                        case Canvas2DOp::MoveTo:
                            c.moveTo(a.number(0), a.number(1));
                            break;
                        case Canvas2DOp::LineTo:
                            c.lineTo(a.number(0), a.number(1));
                            break;
                        case Canvas2DOp::QuadraticCurveTo:
                            c.quadraticCurveTo(a.number(0), a.number(1), a.number(2), a.number(3));
                            break;
                        case Canvas2DOp::BezierCurveTo:
                            c.bezierCurveTo(a.number(0), a.number(1), a.number(2), a.number(3), a.number(4),
                                            a.number(5));
                            break;
                        case Canvas2DOp::ArcTo:
                            c.arcTo(a.number(0), a.number(1), a.number(2), a.number(3), a.number(4));
                            break;
                        case Canvas2DOp::Rect:
                            c.rect(a.number(0), a.number(1), a.number(2), a.number(3));
                            break;
                        case Canvas2DOp::RoundRect:
                        {
                            const std::vector<double> radii = a.numbers(4);
                            c.roundRect(a.number(0), a.number(1), a.number(2), a.number(3), radii);
                            break;
                        }
                        case Canvas2DOp::Arc:
                            c.arc(a.number(0), a.number(1), a.number(2), a.number(3), a.number(4), a.flag(5));
                            break;
                        case Canvas2DOp::Ellipse:
                            c.ellipse(a.number(0), a.number(1), a.number(2), a.number(3), a.number(4), a.number(5),
                                      a.number(6), a.flag(7));
                            break;
                        case Canvas2DOp::Path:
                        {
                            const std::span<const double> commands = a.doubles(0);
                            const auto count = static_cast<std::size_t>(std::max(0, a.integer(1)));
                            if (count > commands.size())
                                throw std::invalid_argument("malformed path commands");
                            runPath(c, commands.first(count));
                            break;
                        }
                        case Canvas2DOp::Fill:
                            c.fill(a.flag(0));
                            break;
                        case Canvas2DOp::Stroke:
                            c.stroke();
                            break;
                        case Canvas2DOp::Clip:
                            c.clip(a.flag(0));
                            break;
                        case Canvas2DOp::IsPointInPath:
                            return JS_NewBool(ctx, c.isPointInPath(a.number(0), a.number(1), a.flag(2)));
                        case Canvas2DOp::IsPointInStroke:
                            return JS_NewBool(ctx, c.isPointInStroke(a.number(0), a.number(1)));
                        case Canvas2DOp::Font:
                            return string(ctx, c.font());
                        case Canvas2DOp::SetFont:
                            return JS_NewBool(ctx, c.setFont(a.string(0)));
                        case Canvas2DOp::TextAlign:
                            return string(ctx, c.textAlign());
                        case Canvas2DOp::SetTextAlign:
                            return JS_NewBool(ctx, c.setTextAlign(a.string(0)));
                        case Canvas2DOp::TextBaseline:
                            return string(ctx, c.textBaseline());
                        case Canvas2DOp::SetTextBaseline:
                            return JS_NewBool(ctx, c.setTextBaseline(a.string(0)));
                        case Canvas2DOp::FillText:
                            c.fillText(a.string(0), a.number(1), a.number(2), a.optional(3));
                            break;
                        case Canvas2DOp::StrokeText:
                            c.strokeText(a.string(0), a.number(1), a.number(2), a.optional(3));
                            break;
                        case Canvas2DOp::MeasureText:
                        {
                            const auto metrics = c.measureText(a.string(0));
                            return numbers(
                                ctx, { metrics.width, metrics.fontBoundingBoxAscent, metrics.fontBoundingBoxDescent });
                        }
                        case Canvas2DOp::ImageSmoothing:
                            return JS_NewBool(ctx, c.imageSmoothing());
                        case Canvas2DOp::SetImageSmoothing:
                            c.setImageSmoothing(a.flag(0));
                            break;
                        case Canvas2DOp::DrawCanvas:
                        {
                            const std::shared_ptr<CanvasBuffer> source = surfaceOf(ctx).canvasBuffer(a.node(0));
                            c.drawCanvas(*source, a.number(1), a.number(2), a.number(3), a.number(4), a.number(5),
                                         a.number(6), a.number(7), a.number(8));
                            break;
                        }
                        case Canvas2DOp::DrawAsset:
                        {
                            std::optional<std::array<double, 4>> sourceRect;
                            if (a.flag(1))
                                sourceRect = { a.number(2), a.number(3), a.number(4), a.number(5) };
                            return JS_NewBool(ctx, c.drawAsset(a.string(0), sourceRect, a.number(6), a.number(7),
                                                               a.optional(8), a.optional(9)));
                        }
                        case Canvas2DOp::GetImageData:
                            return bind::write(ctx,
                                               c.getImageData(a.integer(0), a.integer(1), a.integer(2), a.integer(3)));
                        case Canvas2DOp::PutImageData:
                        {
                            std::span<const std::uint8_t> data;
                            if (! bind::read(ctx, a.argv[0], bind::Path { "putImageData" }, data))
                                return JS_EXCEPTION;
                            c.putImageData(data, a.integer(1), a.integer(2), a.integer(3), a.integer(4), a.integer(5),
                                           a.integer(6), a.integer(7), a.integer(8));
                            break;
                        }
                    }
                    return JS_UNDEFINED;
                });
        }

        // gradient2d(kind, ...numbers): a new gradient's id.
        JSValue gradient2d(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            const bind::NativeCall counted(ctx, bind::NativeApi::Canvas);
            if (! bind::expectArgumentCount(ctx, "gradient2d", argc, 1))
                return JS_EXCEPTION;
            return bind::invoke(
                ctx, "gradient2d",
                [&]() -> JSValue
                {
                    const Args a { ctx, argc, argv };
                    switch (a.integer(0))
                    {
                        case 0:
                            return keep(ctx, render::Canvas2D::linearGradient(a.number(1), a.number(2), a.number(3),
                                                                              a.number(4)));
                        case 1:
                            return keep(ctx, render::Canvas2D::radialGradient(a.number(1), a.number(2), a.number(3),
                                                                              a.number(4), a.number(5), a.number(6)));
                        default:
                            return keep(ctx, render::Canvas2D::conicGradient(a.number(1), a.number(2), a.number(3)));
                    }
                });
        }

        // colorStop2d(paint, offset, color): false when the color is not one.
        JSValue colorStop2d(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            const bind::NativeCall counted(ctx, bind::NativeApi::Canvas);
            if (! bind::expectArgumentCount(ctx, "colorStop2d", argc, 3))
                return JS_EXCEPTION;
            return bind::invoke(ctx, "colorStop2d",
                                [&]() -> JSValue
                                {
                                    const Args a { ctx, argc, argv };
                                    return JS_NewBool(ctx, render::Canvas2D::addColorStop(*paintOf(ctx, a.number(0)),
                                                                                          a.number(1), a.string(2)));
                                });
        }

        // pattern2d(context node, source node, repetition): a new pattern's id.
        JSValue pattern2d(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            const bind::NativeCall counted(ctx, bind::NativeApi::Canvas);
            if (! bind::expectArgumentCount(ctx, "pattern2d", argc, 3))
                return JS_EXCEPTION;
            return bind::invoke(ctx, "pattern2d",
                                [&]() -> JSValue
                                {
                                    const Args a { ctx, argc, argv };
                                    render::Canvas2D& c = contextOf(ctx, a.node(0));
                                    return keep(ctx, c.pattern(*surfaceOf(ctx).canvasBuffer(a.node(1)), a.string(2)));
                                });
        }

        // release2d(node, paint): forgets a node's context (0: none) and a
        // paint (0: none), once their JavaScript objects are collected.
        JSValue release2d(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            const bind::NativeCall counted(ctx, bind::NativeApi::Canvas);
            if (! bind::expectArgumentCount(ctx, "release2d", argc, 2))
                return JS_EXCEPTION;
            return bind::invoke(ctx, "release2d",
                                [&]() -> JSValue
                                {
                                    const Args a { ctx, argc, argv };
                                    Canvases& canvases = canvasesOf(ctx);
                                    canvases.contexts.erase(a.node(0));
                                    canvases.paints.erase(static_cast<std::uint32_t>(a.number(1)));
                                    return JS_UNDEFINED;
                                });
        }
    } // namespace

    std::span<const NativeFunction> canvasFunctions()
    {
        static constexpr NativeFunction functions[] = {
            { "call2d", call2d, 2 },       { "gradient2d", gradient2d, 1 }, { "colorStop2d", colorStop2d, 3 },
            { "pattern2d", pattern2d, 3 }, { "release2d", release2d, 2 },
        };
        return functions;
    }

    void installCanvases(js::Context& context)
    {
        bind::setContextData(context, &canvasKey, std::make_shared<Canvases>());
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
