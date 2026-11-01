#include "SvgScene.h"

#include <cmath>
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
            explicit Reader(js::bind::ContextState& owner) : context(owner) {}

            SvgScene read(const jsi::Value& value)
            {
                const auto root = object(value);
                const auto version = root.getProperty(context.rt, "version");
                if (! version.isNumber() || version.getNumber() != 1)
                    fail("version must be 1");
                SvgScene result;
                const auto box = root.getProperty(context.rt, "viewBox");
                if (! box.isUndefined())
                    result.viewBox = fixed<4>(box);
                const auto ratio = root.getProperty(context.rt, "preserveAspectRatio");
                if (! ratio.isUndefined())
                    result.preserveAspectRatio = text(ratio, 128);
                result.presentation = presentation(root.getProperty(context.rt, "presentation"));
                result.children = children(root, 1);
                return result;
            }

        private:
            js::bind::ContextState& context;
            std::size_t nodeCount = 1, numericCount = 0, bytes = 0;

            [[noreturn]] static void fail(const char* message)
            {
                throw std::invalid_argument(std::string("SVG scene: ") + message);
            }

            jsi::Object object(const jsi::Value& value)
            {
                if (! value.isObject() || value.getObject(context.rt).isArray(context.rt))
                    fail("expected an object");
                return value.getObject(context.rt);
            }

            std::string text(const jsi::Value& value, std::size_t maximum)
            {
                if (! value.isString())
                    fail("expected a string");
                const auto string = value.getString(context.rt);
                // Bound the UTF-16 input before copying a potentially huge guest string.
                if (string.length(context.rt) > maximum)
                    fail("excessive string data");
                auto result = string.utf8(context.rt);
                bytes += result.size();
                if (result.size() > maximum || bytes > std::size_t { 1024 } * 1024
                    || result.find('\0') != std::string::npos)
                    fail("excessive string data");
                return result;
            }

            float number(const jsi::Value& value)
            {
                if (! value.isNumber())
                    fail("expected a finite number");
                const double result = value.getNumber();
                if (! std::isfinite(result) || std::abs(result) > 1000000 || ++numericCount > 65536)
                    fail("invalid or excessive coordinates");
                return static_cast<float>(result);
            }

            float field(const jsi::Object& from, const char* name)
            {
                const auto value = from.getProperty(context.rt, name);
                return value.isUndefined() ? 0 : number(value);
            }

            std::optional<float> optionalNumber(const jsi::Object& from, const char* name)
            {
                const auto value = from.getProperty(context.rt, name);
                return value.isUndefined() ? std::nullopt : std::optional(number(value));
            }

            jsi::Array array(const jsi::Value& value, std::size_t maximum)
            {
                if (! value.isObject() || ! value.getObject(context.rt).isArray(context.rt))
                    fail("expected an array");
                auto result = value.getObject(context.rt).getArray(context.rt);
                if (result.size(context.rt) > maximum)
                    fail("excessive array size");
                return result;
            }

            template <std::size_t Count>
            std::array<float, Count> fixed(const jsi::Value& value)
            {
                const auto input = array(value, Count);
                if (input.size(context.rt) != Count)
                    fail("invalid tuple size");
                std::array<float, Count> result {};
                for (std::size_t i = 0; i < Count; ++i)
                    result[i] = number(input.getValueAtIndex(context.rt, i));
                return result;
            }

            std::vector<float> numbers(const jsi::Value& value, std::size_t maximum)
            {
                const auto input = array(value, maximum);
                std::vector<float> result;
                const auto size = input.size(context.rt);
                result.reserve(size);
                for (std::size_t i = 0; i < size; ++i)
                    result.push_back(number(input.getValueAtIndex(context.rt, i)));
                return result;
            }

            SvgPresentation presentation(const jsi::Value& value)
            {
                SvgPresentation result;
                if (value.isUndefined())
                    return result;
                const auto props = object(value);
                const auto string = [&](const char* name, std::optional<std::string>& out)
                {
                    const auto input = props.getProperty(context.rt, name);
                    if (! input.isUndefined())
                        out = text(input, 128);
                };
                string("fill", result.fill);
                string("stroke", result.stroke);
                string("color", result.color);
                string("fillRule", result.fillRule);
                string("strokeLinecap", result.strokeLinecap);
                string("strokeLinejoin", result.strokeLinejoin);
                result.strokeWidth = optionalNumber(props, "strokeWidth");
                result.strokeMiterlimit = optionalNumber(props, "strokeMiterlimit");
                result.strokeDashoffset = optionalNumber(props, "strokeDashoffset");
                result.opacity = optionalNumber(props, "opacity");
                result.fillOpacity = optionalNumber(props, "fillOpacity");
                result.strokeOpacity = optionalNumber(props, "strokeOpacity");
                const auto dash = props.getProperty(context.rt, "strokeDasharray");
                if (! dash.isUndefined())
                    result.strokeDasharray = numbers(dash, 4096);
                const auto transform = props.getProperty(context.rt, "transform");
                if (! transform.isUndefined())
                    result.transform = fixed<6>(transform);
                return result;
            }

            std::vector<SvgShape> children(const jsi::Object& from, std::size_t depth)
            {
                const auto value = from.getProperty(context.rt, "children");
                if (value.isUndefined())
                    return {};
                if (depth > 64)
                    fail("excessive nesting");
                const auto input = array(value, 4096 - nodeCount);
                std::vector<SvgShape> result;
                const auto size = input.size(context.rt);
                result.reserve(size);
                for (std::size_t i = 0; i < size; ++i)
                {
                    if (++nodeCount > 4096)
                        fail("excessive nodes");
                    const auto node = object(input.getValueAtIndex(context.rt, i));
                    const auto type = text(node.getProperty(context.rt, "type"), 16);
                    SvgShape shape;
                    if (type == "g")
                        shape.geometry = SvgGroup {};
                    else if (type == "path")
                    {
                        const auto d = node.getProperty(context.rt, "d");
                        shape.geometry = SvgPath { d.isUndefined() ? "" : text(d, std::size_t { 256 } * 1024) };
                    }
                    else if (type == "circle")
                        shape.geometry = SvgCircle { field(node, "cx"), field(node, "cy"), field(node, "r") };
                    else if (type == "rect")
                        shape.geometry =
                            SvgRect { field(node, "x"),      field(node, "y"),           field(node, "width"),
                                      field(node, "height"), optionalNumber(node, "rx"), optionalNumber(node, "ry") };
                    else if (type == "ellipse")
                        shape.geometry =
                            SvgEllipse { field(node, "cx"), field(node, "cy"), field(node, "rx"), field(node, "ry") };
                    else if (type == "line")
                        shape.geometry =
                            SvgLine { field(node, "x1"), field(node, "y1"), field(node, "x2"), field(node, "y2") };
                    else if (type == "polygon" || type == "polyline")
                    {
                        const auto points = node.getProperty(context.rt, "points");
                        shape.geometry =
                            SvgPoints { points.isUndefined() ? std::vector<float> {} : numbers(points, 65536),
                                        type == "polygon" };
                    }
                    else
                        fail("unknown shape type");
                    shape.presentation = presentation(node.getProperty(context.rt, "presentation"));
                    shape.children = children(node, depth + 1);
                    result.push_back(std::move(shape));
                }
                return result;
            }
        };
    } // namespace

    SvgScene readSvgScene(js::bind::ContextState& context, const jsi::Value& value)
    {
        return Reader(context).read(value);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
