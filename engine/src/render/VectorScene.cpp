#include "VectorScene.h"

#include "ui/Color.h"

#include <include/core/SkCanvas.h>
#include <include/core/SkMatrix.h>
#include <include/core/SkPaint.h>
#include <include/core/SkPathBuilder.h>
#include <include/core/SkRRect.h>
#include <include/effects/SkDashPathEffect.h>
#include <include/utils/SkParse.h>
#include <include/utils/SkParsePath.h>

#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    struct SvgGeometryData
    {
        SkPath path;
        std::size_t numbers = 0;
        std::size_t bytes = 0;
    };

    namespace
    {
        constexpr std::size_t maxBytes = std::size_t { 1024 } * 1024;
        constexpr std::size_t maxNumbers = 65536;
        constexpr std::size_t maxNodes = 4096;
        constexpr std::size_t maxPathBytes = std::size_t { 256 } * 1024;
        constexpr float maxCoordinate = 1000000;

        [[noreturn]] void invalid(std::string_view field)
        {
            throw std::invalid_argument("SVG scene: invalid or excessive " + std::string(field));
        }

        void finite(float value, std::string_view field)
        {
            if (! std::isfinite(value) || std::abs(value) > maxCoordinate)
                invalid(field);
        }

        struct Budget
        {
            std::size_t nodes = 0, numbers = 0, bytes = 0;
            void add(std::size_t numeric, std::size_t text = 0)
            {
                numbers += numeric;
                bytes += text;
                if (numbers > maxNumbers || bytes > maxBytes)
                    invalid("scene size");
            }
            void number(float value, std::string_view field)
            {
                finite(value, field);
                add(1);
            }
            void text(std::string_view value)
            {
                if (value.size() > 128)
                    invalid("presentation string");
                add(0, value.size());
            }
        };

        std::string_view trimmed(std::string_view text)
        {
            constexpr std::string_view spaces = " \t\n\r\f";
            const auto begin = text.find_first_not_of(spaces);
            if (begin == std::string_view::npos)
                return {};
            return text.substr(begin, text.find_last_not_of(spaces) - begin + 1);
        }

        std::string lower(std::string_view value)
        {
            std::string result(trimmed(value));
            for (auto& c : result)
                if (c >= 'A' && c <= 'Z')
                    c = static_cast<char>(c + ('a' - 'A'));
            return result;
        }

        struct StringHash
        {
            using is_transparent = void;
            std::size_t operator()(std::string_view value) const noexcept
            {
                return std::hash<std::string_view>()(value);
            }
        };

        std::size_t pathNumbers(const std::string& d)
        {
            std::size_t count = 0;
            for (const char* at = d.c_str(); *at != '\0';)
            {
                if (at[0] == '0' && (at[1] == 'x' || at[1] == 'X'))
                    invalid("path number");
                if ((*at >= '0' && *at <= '9') || *at == '+' || *at == '-' || *at == '.')
                {
                    if (*at == '+')
                        ++at;
                    float value = 0;
                    const char* next = SkParse::FindScalar(at, &value);
                    if (next == nullptr || next == at || ++count > maxNumbers)
                        invalid("path number");
                    finite(value, "path number");
                    at = next;
                }
                else
                    ++at;
            }
            return count;
        }

        struct PaintValue
        {
            enum class Kind
            {
                None,
                Solid,
                CurrentColor
            };
            Kind kind = Kind::None;
            ui::Color color;
        };

        PaintValue paintValue(std::string_view value)
        {
            const std::string keyword = lower(value);
            if (keyword == "none")
                return {};
            if (keyword == "currentcolor")
                return { PaintValue::Kind::CurrentColor, {} };
            const auto color = ui::parseColor(value);
            if (! color)
                invalid("paint color");
            return { PaintValue::Kind::Solid, *color };
        }

        struct Inherited
        {
            PaintValue fill { PaintValue::Kind::Solid, ui::black };
            PaintValue stroke;
            ui::Color color = ui::black;
            float width = 1, miter = 4, dashOffset = 0, fillOpacity = 1, strokeOpacity = 1;
            SkPaint::Cap cap = SkPaint::kButt_Cap;
            SkPaint::Join join = SkPaint::kMiter_Join;
            SkPathFillType rule = SkPathFillType::kWinding;
            std::shared_ptr<const std::vector<float>> dash;
            sk_sp<SkPathEffect> dashEffect;
        };

        Inherited inherit(const ui::SvgPresentation& props, Inherited result, Budget& budget)
        {
            const auto numeric =
                [&](const std::optional<float>& value, float& target, bool nonnegative = false, bool opacity = false)
            {
                if (! value)
                    return;
                budget.number(*value, "presentation number");
                if (nonnegative && *value < 0)
                    invalid("negative stroke value");
                target = opacity ? std::clamp(*value, 0.0f, 1.0f) : *value;
            };
            const auto paint = [&](const std::optional<std::string>& value, PaintValue& target)
            {
                if (value)
                {
                    budget.text(*value);
                    target = paintValue(*value);
                }
            };
            paint(props.fill, result.fill);
            paint(props.stroke, result.stroke);
            if (props.color)
            {
                budget.text(*props.color);
                if (lower(*props.color) != "currentcolor")
                {
                    const auto color = ui::parseColor(*props.color);
                    if (! color)
                        invalid("color");
                    result.color = *color;
                }
            }
            numeric(props.strokeWidth, result.width, true);
            numeric(props.strokeMiterlimit, result.miter);
            if (result.miter < 1)
                invalid("strokeMiterlimit");
            numeric(props.strokeDashoffset, result.dashOffset);
            numeric(props.fillOpacity, result.fillOpacity, false, true);
            numeric(props.strokeOpacity, result.strokeOpacity, false, true);
            if (props.fillRule)
            {
                budget.text(*props.fillRule);
                if (*props.fillRule != "nonzero" && *props.fillRule != "evenodd")
                    invalid("fillRule");
                result.rule = *props.fillRule == "evenodd" ? SkPathFillType::kEvenOdd : SkPathFillType::kWinding;
            }
            if (props.strokeLinecap)
            {
                budget.text(*props.strokeLinecap);
                if (*props.strokeLinecap == "butt")
                    result.cap = SkPaint::kButt_Cap;
                else if (*props.strokeLinecap == "round")
                    result.cap = SkPaint::kRound_Cap;
                else if (*props.strokeLinecap == "square")
                    result.cap = SkPaint::kSquare_Cap;
                else
                    invalid("strokeLinecap");
            }
            if (props.strokeLinejoin)
            {
                budget.text(*props.strokeLinejoin);
                if (*props.strokeLinejoin == "miter")
                    result.join = SkPaint::kMiter_Join;
                else if (*props.strokeLinejoin == "round")
                    result.join = SkPaint::kRound_Join;
                else if (*props.strokeLinejoin == "bevel")
                    result.join = SkPaint::kBevel_Join;
                else
                    invalid("strokeLinejoin");
            }
            if (props.strokeDasharray)
            {
                if (props.strokeDasharray->size() > 4096)
                    invalid("strokeDasharray");
                auto dash = *props.strokeDasharray;
                for (const float length : dash)
                {
                    budget.number(length, "strokeDasharray");
                    if (length < 0)
                        invalid("strokeDasharray");
                }
                if (std::ranges::all_of(dash, [](float value) { return value == 0; }))
                    dash.clear();
                if (dash.size() % 2 != 0)
                {
                    const auto repeated = dash;
                    dash.insert(dash.end(), repeated.begin(), repeated.end());
                }
                result.dash = std::make_shared<const std::vector<float>>(std::move(dash));
            }
            if (props.strokeDasharray || props.strokeDashoffset)
            {
                result.dashEffect.reset();
                if (result.dash && ! result.dash->empty())
                {
                    result.dashEffect =
                        SkDashPathEffect::Make({ result.dash->data(), result.dash->size() }, result.dashOffset);
                    if (! result.dashEffect)
                        invalid("strokeDasharray");
                }
            }
            return result;
        }

        SkPaint makePaint(const PaintValue& value, const Inherited& inherited, bool stroke)
        {
            const ui::Color color = value.kind == PaintValue::Kind::CurrentColor ? inherited.color : value.color;
            SkPaint paint;
            paint.setAntiAlias(true);
            paint.setColor(SkColorSetARGB(color.a, color.r, color.g, color.b));
            paint.setAlphaf(paint.getAlphaf() * (stroke ? inherited.strokeOpacity : inherited.fillOpacity));
            if (stroke)
            {
                paint.setStyle(SkPaint::kStroke_Style);
                paint.setStrokeWidth(inherited.width);
                paint.setStrokeCap(inherited.cap);
                paint.setStrokeJoin(inherited.join);
                paint.setStrokeMiter(inherited.miter);
                paint.setPathEffect(inherited.dashEffect);
            }
            return paint;
        }

        std::shared_ptr<const SvgGeometryData> basicGeometry(const ui::SvgGeometry& geometry)
        {
            auto result = std::make_shared<SvgGeometryData>();
            const auto number = [&](float value, bool nonnegative = false)
            {
                finite(value, "geometry number");
                if (nonnegative && value < 0)
                    invalid("negative dimension");
                ++result->numbers;
                return value;
            };
            SkPathBuilder path;
            std::visit(
                [&](const auto& shape)
                {
                    using T = std::decay_t<decltype(shape)>;
                    if constexpr (std::is_same_v<T, ui::SvgCircle>)
                    {
                        number(shape.cx);
                        number(shape.cy);
                        number(shape.r, true);
                        if (shape.r > 0)
                            path.addCircle(shape.cx, shape.cy, shape.r);
                    }
                    else if constexpr (std::is_same_v<T, ui::SvgEllipse>)
                    {
                        number(shape.cx);
                        number(shape.cy);
                        number(shape.rx, true);
                        number(shape.ry, true);
                        if (shape.rx > 0 && shape.ry > 0)
                            path.addOval(SkRect::MakeLTRB(shape.cx - shape.rx, shape.cy - shape.ry, shape.cx + shape.rx,
                                                          shape.cy + shape.ry));
                    }
                    else if constexpr (std::is_same_v<T, ui::SvgRect>)
                    {
                        number(shape.x);
                        number(shape.y);
                        number(shape.width, true);
                        number(shape.height, true);
                        const float rx = number(shape.rx.value_or(shape.ry.value_or(0)), true);
                        const float ry = number(shape.ry.value_or(shape.rx.value_or(0)), true);
                        if (shape.width > 0 && shape.height > 0)
                            path.addRRect(SkRRect::MakeRectXY(
                                SkRect::MakeXYWH(shape.x, shape.y, shape.width, shape.height), rx, ry));
                    }
                    else if constexpr (std::is_same_v<T, ui::SvgLine>)
                    {
                        path.moveTo(number(shape.x1), number(shape.y1)).lineTo(number(shape.x2), number(shape.y2));
                    }
                    else if constexpr (std::is_same_v<T, ui::SvgPoints>)
                    {
                        if (shape.points.size() > maxNumbers || shape.points.size() % 2 != 0)
                            invalid("points");
                        for (std::size_t i = 0; i < shape.points.size(); i += 2)
                        {
                            const float x = number(shape.points[i]), y = number(shape.points[i + 1]);
                            if (i == 0)
                                path.moveTo(x, y);
                            else
                                path.lineTo(x, y);
                        }
                        if (shape.closed)
                            path.close();
                    }
                    else if constexpr (! std::is_same_v<T, ui::SvgGroup>)
                        invalid("geometry kind");
                },
                geometry);
            result->path = path.detach();
            return result;
        }

        struct AspectRatio
        {
            float x = 0.5f, y = 0.5f;
            bool none = false, slice = false;
        };

        AspectRatio aspectRatio(std::string_view value)
        {
            value = trimmed(value);
            if (value == "none")
                return { 0, 0, true, false };
            if (value.size() < 8 || value[0] != 'x' || value[4] != 'Y')
                invalid("preserveAspectRatio");
            const auto alignment = [](std::string_view name)
            {
                if (name == "Min")
                    return 0.0f;
                if (name == "Mid")
                    return 0.5f;
                if (name == "Max")
                    return 1.0f;
                invalid("preserveAspectRatio");
            };
            AspectRatio result { alignment(value.substr(1, 3)), alignment(value.substr(5, 3)) };
            const auto mode = trimmed(value.substr(8));
            if (! mode.empty() && mode != "meet" && mode != "slice")
                invalid("preserveAspectRatio");
            result.slice = mode == "slice";
            return result;
        }

        struct CompiledNode
        {
            const ui::SvgShape* source = nullptr;
            std::shared_ptr<const SvgGeometryData> geometry;
            SkMatrix matrix = SkMatrix::I();
            SkPaint fill, stroke;
            SkPathFillType rule = SkPathFillType::kWinding;
            float opacity = 1;
            bool fillEnabled = false, strokeEnabled = false;
            std::vector<CompiledNode> children;

            void draw(SkCanvas& canvas) const
            {
                if (opacity == 0)
                    return;
                canvas.save();
                canvas.concat(matrix);
                // Opacity isolates the whole shape too: fill/stroke overlap
                // must not apply it twice.
                if (opacity < 1)
                    canvas.saveLayerAlphaf(nullptr, opacity);
                if (geometry)
                {
                    const SkPath path = geometry->path.makeFillType(rule);
                    if (fillEnabled)
                        canvas.drawPath(path, fill);
                    if (strokeEnabled)
                        canvas.drawPath(path, stroke);
                }
                for (const auto& child : children)
                    child.draw(canvas);
                if (opacity < 1)
                    canvas.restore();
                canvas.restore();
            }
        };
    } // namespace

    struct SvgGeometryCache::Impl
    {
        explicit Impl(std::uint64_t& counter) : parses(counter) {}
        std::uint64_t& parses;
        std::size_t bytes = 0;
        std::unordered_map<std::string, std::weak_ptr<const SvgGeometryData>, StringHash, std::equal_to<>> paths;
    };

    SvgGeometryCache::SvgGeometryCache(std::uint64_t& counter) : impl(std::make_unique<Impl>(counter)) {}
    SvgGeometryCache::~SvgGeometryCache() = default;

    std::shared_ptr<const SvgGeometryData> SvgGeometryCache::path(std::string_view d)
    {
        if (d.size() > maxPathBytes || d.find('\0') != std::string_view::npos)
            invalid("path size");
        if (const auto found = impl->paths.find(d); found != impl->paths.end())
        {
            if (const auto alive = found->second.lock())
                return alive;
            impl->bytes -= found->first.size();
            impl->paths.erase(found);
        }
        const std::string text(d);
        const auto first = text.find_first_not_of(" \t\r\n\f");
        if (first != std::string::npos && text[first] != 'M' && text[first] != 'm')
            invalid("path data (expected moveto)");
        auto parsed = std::make_shared<SvgGeometryData>();
        parsed->numbers = pathNumbers(text);
        parsed->bytes = d.size();
        ++impl->parses;
        const auto path = SkParsePath::FromSVGString(text.c_str());
        if (! path || ! path->isFinite())
            invalid("path data");
        parsed->path = *path;
        constexpr std::size_t maxCachedBytes = 4 * maxBytes;
        if (impl->bytes + d.size() > maxCachedBytes || impl->paths.size() >= maxNodes)
        {
            for (auto at = impl->paths.begin(); at != impl->paths.end();)
                if (at->second.expired())
                {
                    impl->bytes -= at->first.size();
                    at = impl->paths.erase(at);
                }
                else
                    ++at;
        }
        while (impl->bytes + d.size() > maxCachedBytes || impl->paths.size() >= maxNodes)
        {
            const auto at = impl->paths.begin();
            impl->bytes -= at->first.size();
            impl->paths.erase(at);
        }
        impl->paths.emplace(text, parsed);
        impl->bytes += d.size();
        return parsed;
    }

    struct VectorScene::Impl
    {
        ui::SvgScene scene;
        CompiledNode root;
        AspectRatio aspect;
        ui::Size natural { 300, 150 };
        Budget budget;
        std::size_t reservedNodes = 1;

        CompiledNode compileNode(const ui::SvgPresentation& props, const std::vector<ui::SvgShape>& children,
                                 const ui::SvgShape* source, const Inherited& inherited, const SkMatrix& parent,
                                 std::size_t depth, SvgGeometryCache& cache, const CompiledNode* previous)
        {
            if (++budget.nodes > maxNodes || depth > 64)
                invalid("scene complexity");
            CompiledNode result;
            result.source = source;
            const auto paints = inherit(props, inherited, budget);
            if (props.opacity)
            {
                budget.number(*props.opacity, "opacity");
                result.opacity = std::clamp(*props.opacity, 0.0f, 1.0f);
            }
            if (props.transform)
            {
                for (const float coordinate : *props.transform)
                    budget.number(coordinate, "transform");
                const auto& m = *props.transform;
                result.matrix.setAll(m[0], m[2], m[4], m[1], m[3], m[5], 0, 0, 1);
            }
            const SkMatrix accumulated = SkMatrix::Concat(parent, result.matrix);
            for (int i = 0; i < 9; ++i)
                if (! std::isfinite(accumulated[i]) || std::abs(accumulated[i]) > 1.0e12f)
                    invalid("accumulated transform");
            if (source && ! std::holds_alternative<ui::SvgGroup>(source->geometry))
            {
                if (! children.empty())
                    invalid("shape children");
                if (previous && previous->source && previous->source->geometry == source->geometry)
                    result.geometry = previous->geometry;
                else if (const auto* path = std::get_if<ui::SvgPath>(&source->geometry))
                    result.geometry = cache.path(path->d);
                else
                    result.geometry = basicGeometry(source->geometry);
                budget.add(result.geometry->numbers, result.geometry->bytes);
                result.rule = paints.rule;
                result.fillEnabled = paints.fill.kind != PaintValue::Kind::None;
                result.strokeEnabled = paints.stroke.kind != PaintValue::Kind::None && paints.width > 0;
                result.fill = makePaint(paints.fill, paints, false);
                result.stroke = makePaint(paints.stroke, paints, true);
            }
            if (children.size() > maxNodes - reservedNodes)
                invalid("scene complexity");
            reservedNodes += children.size();
            result.children.reserve(children.size());
            for (std::size_t i = 0; i < children.size(); ++i)
            {
                const auto& child = children[i];
                const auto* prior = previous && i < previous->children.size() ? &previous->children[i] : nullptr;
                result.children.push_back(compileNode(child.presentation, child.children, &child, paints, accumulated,
                                                      depth + 1, cache, prior));
            }
            return result;
        }
    };

    std::unique_ptr<VectorScene> VectorScene::compile(ui::SvgScene scene, SvgGeometryCache& cache,
                                                      const VectorScene* previous)
    {
        if (scene.version != 1)
            invalid("version (expected 1)");
        auto compiled = std::make_unique<Impl>();
        compiled->scene = std::move(scene);
        compiled->budget.text(compiled->scene.preserveAspectRatio);
        compiled->aspect = aspectRatio(compiled->scene.preserveAspectRatio);
        if (const auto viewBox = compiled->scene.viewBox)
        {
            const auto& box = *viewBox;
            for (const float coordinate : box)
                compiled->budget.number(coordinate, "viewBox");
            if (box[2] <= 0 || box[3] <= 0)
                invalid("viewBox dimensions");
            const float ratio = box[2] / box[3];
            if (! std::isfinite(ratio) || ratio <= 0)
                invalid("viewBox ratio");
            compiled->natural.width = std::min(300.0f, 150 * ratio);
            compiled->natural.height = compiled->natural.width / ratio;
            if (! std::isfinite(compiled->natural.height) || compiled->natural.height <= 0)
                invalid("viewBox ratio");
        }
        compiled->root =
            compiled->compileNode(compiled->scene.presentation, compiled->scene.children, nullptr, Inherited {},
                                  SkMatrix::I(), 0, cache, previous ? &previous->impl->root : nullptr);
        return std::unique_ptr<VectorScene>(new VectorScene(std::move(compiled)));
    }

    VectorScene::VectorScene(std::unique_ptr<Impl> compiled) : impl(std::move(compiled)) {}
    VectorScene::~VectorScene() = default;
    const ui::SvgScene& VectorScene::snapshot() const
    {
        return impl->scene;
    }
    ui::Size VectorScene::naturalSize() const
    {
        return impl->natural;
    }

    void VectorScene::draw(SkCanvas& canvas, const SkRect& viewport) const
    {
        if (viewport.isEmpty() || canvas.quickReject(viewport))
            return;
        canvas.save();
        canvas.clipRect(viewport, true);
        canvas.translate(viewport.x(), viewport.y());
        if (const auto viewBox = impl->scene.viewBox)
        {
            const auto& box = *viewBox;
            float sx = viewport.width() / box[2], sy = viewport.height() / box[3];
            if (! impl->aspect.none)
                sx = sy = impl->aspect.slice ? std::max(sx, sy) : std::min(sx, sy);
            if (! std::isfinite(sx) || ! std::isfinite(sy))
            {
                canvas.restore();
                return;
            }
            canvas.translate((viewport.width() - box[2] * sx) * impl->aspect.x,
                             (viewport.height() - box[3] * sy) * impl->aspect.y);
            canvas.scale(sx, sy);
            canvas.translate(-box[0], -box[1]);
        }
        impl->root.draw(canvas);
        canvas.restore();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
