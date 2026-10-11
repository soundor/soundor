#include "modules/ui/UiModule.h"

#include "gpu/webgl/WebGLModule.h"
#include "js/Bindings.h"
#include "modules/Embedded.h"
#include "modules/ui/CanvasModule.h"
#include "ui/Color.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <utility>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    namespace
    {
        namespace bind = js::bind;
        using bind::ContextState;

        const char bindingKey = 0;
        const char listenerKey = 0;
        const char frameListenerKey = 0;

        // JavaScript indexes strings in UTF-16 code units, the surface in
        // UTF-8 bytes.
        std::size_t byteOffset(std::string_view text, double utf16Index)
        {
            std::size_t units = 0;
            std::size_t i = 0;
            while (i < text.size() && static_cast<double>(units) < utf16Index)
            {
                const auto lead = static_cast<unsigned char>(text[i]);
                const std::size_t length = lead < 0x80 ? 1 : lead < 0xE0 ? 2 : lead < 0xF0 ? 3 : 4;
                units += length == 4 ? 2 : 1;
                i += length;
            }
            return std::min(i, text.size());
        }

        double utf16Index(std::string_view text, std::size_t offset)
        {
            double units = 0;
            for (std::size_t i = 0; i < offset && i < text.size(); ++i)
            {
                const auto byte = static_cast<unsigned char>(text[i]);
                if ((byte & 0xC0) != 0x80)
                    units += byte >= 0xF0 ? 2 : 1;
            }
            return units;
        }

        // One context's hold on the surface. The surface may outlive the
        // context (a reload), so the binding unhooks its events when it goes.
        struct Binding
        {
            explicit Binding(std::shared_ptr<Surface> target) : surface(std::move(target)) {}
            ~Binding() { surface->setEventSink(nullptr); }

            Binding(const Binding&) = delete;
            Binding& operator=(const Binding&) = delete;

            std::shared_ptr<Surface> surface;
        };

        NodeId readId(const jsi::Value& value)
        {
            const double number = value.isNumber() ? value.getNumber() : -1.0;
            if (number < 0 || number > 4294967295.0 || std::floor(number) != number)
                throw std::invalid_argument("invalid node id");
            return static_cast<NodeId>(number);
        }

        jsi::Value writeRect(ContextState& context, Rect rect)
        {
            bind::ObjectBuilder object(context);
            object.set("x", jsi::Value(double(rect.x)));
            object.set("y", jsi::Value(double(rect.y)));
            object.set("width", jsi::Value(double(rect.width)));
            object.set("height", jsi::Value(double(rect.height)));
            return object.release();
        }

        // ── Style ────────────────────────────────────────────────────────────

        // Reads a style object into a Style. Unknown keys are ignored; known
        // keys with invalid values throw a TypeError naming them.
        class StyleReader
        {
        public:
            StyleReader(ContextState& owner, const jsi::Object& object) : context(owner)
            {
                // The style's own properties, listed once with their values:
                // most of the many it could have are absent, and looking each
                // of those up would cost an engine lookup.
                const jsi::Array names = object.getPropertyNames(context.rt);
                const std::size_t count = names.size(context.rt);
                present.reserve(count);
                for (std::size_t i = 0; i < count; ++i)
                {
                    const jsi::Value name = names.getValueAtIndex(context.rt, i);
                    if (! name.isString())
                        continue;
                    const jsi::String key = name.getString(context.rt);
                    present.emplace_back(key.utf8(context.rt), object.getProperty(context.rt, key));
                }
            }

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
            struct Property
            {
                Property(const StyleReader& reader, const char* key) : name(key), value(reader.find(key)) {}

                [[nodiscard]] bool present() const
                {
                    return value != nullptr && ! value->isUndefined() && ! value->isNull();
                }

                const char* name;
                const jsi::Value* value;
            };

            // The style's value of `key`, or nullptr.
            [[nodiscard]] const jsi::Value* find(std::string_view key) const
            {
                for (const auto& [name, value] : present)
                    if (name == key)
                        return &value;
                return nullptr;
            }

            [[nodiscard]] std::string text(const Property& property) const
            {
                return property.value->getString(context.rt).utf8(context.rt);
            }

            [[noreturn]] void fail(const Property& property, std::string_view expected)
            {
                const std::string got = js::detail::toStdString(context.rt, *property.value);
                bind::throwTypeError(context, std::string("style.") + property.name + ": expected "
                                                  + std::string(expected) + ", got "
                                                  + (property.value->isString() ? "'" + got + "'" : got));
            }

            std::optional<float> number(const char* key)
            {
                const Property property(*this, key);
                if (! property.present())
                    return std::nullopt;
                if (! property.value->isNumber() || ! std::isfinite(property.value->getNumber()))
                    fail(property, "a finite number");
                return static_cast<float>(property.value->getNumber());
            }

            std::optional<Length> length(const char* key, bool allowAuto)
            {
                const Property property(*this, key);
                if (! property.present())
                    return std::nullopt;
                const std::string_view expected =
                    allowAuto ? "a number, a percentage or 'auto'" : "a number or a percentage";
                if (property.value->isNumber())
                {
                    const double value = property.value->getNumber();
                    if (! std::isfinite(value))
                        fail(property, expected);
                    return Length::points(static_cast<float>(value));
                }
                if (property.value->isString())
                {
                    const std::string value = text(property);
                    if (allowAuto && value == "auto")
                        return Length::automatic();
                    if (value.size() > 1 && value.back() == '%')
                    {
                        std::size_t used = 0;
                        try
                        {
                            const float percent = std::stof(value.substr(0, value.size() - 1), &used);
                            if (used == value.size() - 1 && std::isfinite(percent))
                                return Length::percent(percent);
                        }
                        catch (const std::exception&) // NOLINT(bugprone-empty-catch): reported below
                        {
                        }
                    }
                }
                fail(property, expected);
            }

            template <typename Enum, std::size_t Count>
            std::optional<Enum> choice(const char* key, const std::array<std::string_view, Count>& names)
            {
                const Property property(*this, key);
                if (! property.present())
                    return std::nullopt;
                if (property.value->isString())
                {
                    const std::string value = text(property);
                    for (std::size_t i = 0; i < Count; ++i)
                        if (names[i] == value)
                            return static_cast<Enum>(i);
                }
                std::string expected = "one of ";
                for (std::size_t i = 0; i < Count; ++i)
                    expected += (i == 0 ? "'" : ", '") + std::string(names[i]) + "'";
                fail(property, expected);
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

                assign(out.display, choice<Display>("display", displays));
                assign(out.position, choice<Position>("position", positions));
                assign(out.flexDirection, choice<FlexDirection>("flexDirection", directions));
                assign(out.flexWrap, choice<Wrap>("flexWrap", wraps));
                assign(out.justifyContent, choice<Justify>("justifyContent", justifies));
                assign(out.alignItems, choice<Align>("alignItems", aligns));
                assign(out.alignSelf, choice<Align>("alignSelf", aligns));
                assign(out.alignContent, choice<Align>("alignContent", aligns));
                assign(out.overflow, choice<Overflow>("overflow", overflows));
                assign(out.boxSizing, choice<BoxSizing>("boxSizing", boxSizings));
                assign(out.pointerEvents, choice<PointerEvents>("pointerEvents", pointerEvents));
                if (const Property zIndex(*this, "zIndex"); zIndex.present())
                {
                    const double value = zIndex.value->isNumber() ? zIndex.value->getNumber() : 0.5;
                    if (! zIndex.value->isNumber() || std::trunc(value) != value || std::abs(value) > 2147483647.0)
                        fail(zIndex, "an integer");
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

            std::optional<Color> color(const char* key)
            {
                const Property property(*this, key);
                if (! property.present())
                    return std::nullopt;
                if (property.value->isString())
                    if (const std::optional<Color> parsed = parseColor(text(property)))
                        return parsed;
                fail(property, "a CSS color");
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
                if (const auto opacity = number("opacity"))
                    out.opacity = std::clamp(*opacity, 0.0f, 1.0f);
                assign(out.resizeMode, choice<ResizeMode>("resizeMode", resizeModes));
            }

            void readText(TextStyle& out)
            {
                assign(out.color, color("color"));
                static constexpr std::array<std::string_view, 2> fontStyles { "normal", "italic" };
                static constexpr std::array<std::string_view, 4> textAligns { "auto", "left", "center", "right" };

                if (const Property family(*this, "fontFamily"); family.present())
                {
                    if (! family.value->isString())
                        fail(family, "a string");
                    out.fontFamily = text(family);
                }
                if (const auto size = number("fontSize"); size && *size > 0)
                    out.fontSize = *size;
                if (const Property weight(*this, "fontWeight"); weight.present())
                {
                    double value = 0;
                    if (weight.value->isNumber())
                    {
                        value = weight.value->getNumber();
                    }
                    else if (weight.value->isString())
                    {
                        const std::string name = text(weight);
                        value = name == "normal" ? 400 : name == "bold" ? 700 : std::atof(name.c_str());
                    }
                    if (value < 1 || value > 1000)
                        fail(weight, "a weight from 1 to 1000, 'normal' or 'bold'");
                    out.fontWeight = static_cast<int>(value);
                }
                assign(out.fontStyle, choice<FontStyle>("fontStyle", fontStyles));
                assign(out.lineHeight, number("lineHeight"));
                assign(out.letterSpacing, number("letterSpacing"));
                assign(out.textAlign, choice<TextAlign>("textAlign", textAligns));
                if (const auto lines = number("numberOfLines"))
                    out.numberOfLines = std::max(0, static_cast<int>(*lines));
            }

            ContextState& context;
            // The style's own properties and their values.
            std::vector<std::pair<std::string, jsi::Value>> present;
        };

        // ── Accessibility ────────────────────────────────────────────────────

        // Reads the accessibility ui.js normalized and checked: every key
        // present, null where unset.
        class AccessibilityReader
        {
        public:
            explicit AccessibilityReader(ContextState& owner) : context(owner) {}

            void read(const jsi::Value& value, a11y::Properties& out)
            {
                const bind::Path path { "accessibility" };
                const jsi::Object object = bind::expectObject(context, value, path);
                std::optional<std::string> role;
                const jsi::Value state = bind::property(context, object, "state");
                const jsi::Value current = bind::property(context, object, "value");
                const jsi::Value actions = bind::property(context, object, "actions");
                optional(object, "accessible", path, out.accessible);
                optional(object, "role", path, role);
                field(object, "label", path, out.label);
                field(object, "hint", path, out.hint);
                field(object, "modal", path, out.modal);
                readState(state, path.field("state"), out.state);
                readValue(current, path.field("value"), out.value);
                readActions(actions, path.field("actions"), out.actions);
                if (role)
                {
                    out.role = a11y::roleFromName(*role);
                    if (! out.role)
                        bind::throwTypeError(context, "accessibility.role: unknown role '" + *role + "'");
                }
            }

        private:
            template <typename T>
            void field(const jsi::Object& object, const char* name, const bind::Path& parent, T& out)
            {
                bind::read(context, bind::property(context, object, name), parent.field(name), out);
            }

            template <typename T>
            void optional(const jsi::Object& object, const char* name, const bind::Path& parent, std::optional<T>& out)
            {
                const jsi::Value property = bind::property(context, object, name);
                if (property.isNull() || property.isUndefined())
                {
                    out.reset();
                    return;
                }
                T read {};
                bind::read(context, property, parent.field(name), read);
                out = std::move(read);
            }

            void readState(const jsi::Value& value, const bind::Path& path, a11y::State& out)
            {
                const jsi::Object object = bind::expectObject(context, value, path);
                const jsi::Value checked = bind::property(context, object, "checked");
                field(object, "disabled", path, out.disabled);
                field(object, "busy", path, out.busy);
                optional(object, "selected", path, out.selected);
                optional(object, "expanded", path, out.expanded);
                if (checked.isNull() || checked.isUndefined())
                    out.checked = a11y::Checked::Unset;
                else if (checked.isBool())
                    out.checked = checked.getBool() ? a11y::Checked::True : a11y::Checked::False;
                else
                    out.checked = a11y::Checked::Mixed;
            }

            void readValue(const jsi::Value& value, const bind::Path& path, a11y::Value& out)
            {
                const jsi::Object object = bind::expectObject(context, value, path);
                optional(object, "min", path, out.min);
                optional(object, "max", path, out.max);
                optional(object, "now", path, out.now);
                field(object, "text", path, out.text);
            }

            void readActions(const jsi::Value& array, const bind::Path& path, std::vector<a11y::ActionDescriptor>& out)
            {
                bind::readArray(context, array, path, out,
                                [this](ContextState&, const jsi::Value& element, const bind::Path& at,
                                       a11y::ActionDescriptor& action)
                                {
                                    const jsi::Object object = bind::expectObject(context, element, at);
                                    field(object, "name", at, action.name);
                                    field(object, "label", at, action.label);
                                    action.action = a11y::actionFromName(action.name);
                                });
            }

            ContextState& context;
        };

        // ── Functions ────────────────────────────────────────────────────────

        template <typename Body>
        jsi::Value call(ContextState& context, const char* method, std::size_t count, std::size_t expected, Body&& body)
        {
            const bind::NativeCall counted(context, bind::NativeApi::Ui);
            bind::expectArgumentCount(context, method, count, expected);
            return bind::invoke(context, method, [&]() -> jsi::Value { return body(surfaceOf(context)); });
        }

        jsi::Value createNode(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "createNode", count, 1,
                        [&](Surface& surface)
                        {
                            const int type = bind::toInt32(context, args[0]);
                            if (type < 0 || type > static_cast<int>(NodeType::Canvas))
                                throw std::invalid_argument("invalid node type");
                            return jsi::Value(double(surface.createNode(
                                static_cast<NodeType>(type)))); // NOLINT(modernize-return-braced-init-list): a lambda
                        });
        }

        jsi::Value releaseNode(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "releaseNode", count, 1,
                        [&](Surface& surface)
                        {
                            // Collected after the surface dropped it (a reload): nothing to do.
                            const NodeId id = readId(args[0]);
                            if (surface.find(id) != nullptr)
                                surface.releaseNode(id);
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value insertChild(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "insertBefore", count, 3,
                        [&](Surface& surface)
                        {
                            surface.insertChild(readId(args[0]), readId(args[1]), readId(args[2]));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value removeChild(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "removeChild", count, 2,
                        [&](Surface& surface)
                        {
                            surface.removeChild(readId(args[0]), readId(args[1]));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value setStyle(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "setStyle", count, 2,
                        [&](Surface& surface)
                        {
                            const NodeId id = readId(args[0]);
                            if (! args[1].isObject())
                                bind::throwTypeError(context, "style must be an object");
                            const jsi::Object style = args[1].getObject(context.rt);
                            surface.setStyle(id, StyleReader(context, style).read());
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value setText(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "setText", count, 2,
                        [&](Surface& surface)
                        {
                            std::string text;
                            bind::read(context, args[1], bind::Path { "text" }, text);
                            surface.setText(readId(args[0]), std::move(text));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value setAccessibility(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "accessibility", count, 2,
                        [&](Surface& surface)
                        {
                            a11y::Properties properties;
                            AccessibilityReader(context).read(args[1], properties);
                            surface.setAccessibility(readId(args[0]), std::move(properties));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value setAccessibilityParent(ContextState& context, const jsi::Value&, const jsi::Value* args,
                                          std::size_t count)
        {
            return call(context, "accessibilityParent", count, 2,
                        [&](Surface& surface)
                        {
                            surface.setAccessibilityParent(readId(args[0]), readId(args[1]));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value setFocusable(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "setFocusable", count, 2,
                        [&](Surface& surface)
                        {
                            surface.setFocusable(readId(args[0]), bind::toBoolean(context, args[1]));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value focus(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "focus", count, 1,
                        [&](Surface& surface)
                        {
                            surface.focus(readId(args[0]));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value focused(ContextState& context, const jsi::Value&, const jsi::Value*, std::size_t count)
        {
            return call(context, "focused", count, 0,
                        [&](Surface& surface) -> jsi::Value { return { double(surface.focused()) }; });
        }

        jsi::Value nodeFrame(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "layout", count, 1,
                        [&](Surface& surface)
                        {
                            const NodeId id = readId(args[0]);
                            Node* node = surface.find(id);
                            if (node == nullptr)
                                throw std::invalid_argument("unknown node");
                            surface.layout();
                            return writeRect(context, node->frame());
                        });
        }

        jsi::Value bounds(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "getBoundingClientRect", count, 1,
                        [&](Surface& surface)
                        {
                            const NodeId id = readId(args[0]);
                            return surface.isConnected(id) ? writeRect(context, surface.bounds(id))
                                                           : writeRect(context, {});
                        });
        }

        jsi::Value viewSize(ContextState& context, const jsi::Value&, const jsi::Value*, std::size_t count)
        {
            return call(context, "size", count, 0,
                        [&](Surface& surface)
                        {
                            bind::ObjectBuilder object(context);
                            object.set("width", jsi::Value(double(surface.size().width)));
                            object.set("height", jsi::Value(double(surface.size().height)));
                            object.set("scale", jsi::Value(double(surface.scale())));
                            return object.release();
                        });
        }

        jsi::Value setListener(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count < 1 || ! bind::isFunction(context, args[0]))
                bind::throwTypeError(context, "setListener() expects a function");
            bind::retainValue(context, &listenerKey, jsi::Value(context.rt, args[0]));
            return jsi::Value::undefined();
        }

        std::string readString(ContextState& context, const jsi::Value& value, const char* name)
        {
            if (! value.isString())
                throw std::invalid_argument(std::string(name) + " must be a string");
            return value.getString(context.rt).utf8(context.rt);
        }

        double readNumber(ContextState& context, const jsi::Value& value)
        {
            const double out = bind::toNumber(context, value);
            if (std::isnan(out))
                throw std::invalid_argument("expected a number");
            return out;
        }

        jsi::Value setSource(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "source", count, 2,
                        [&](Surface& surface)
                        {
                            surface.setSource(readId(args[0]), readString(context, args[1], "source"));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value setCanvasSize(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "setCanvasSize", count, 3,
                        [&](Surface& surface)
                        {
                            surface.setCanvasSize(readId(args[0]), static_cast<int>(readNumber(context, args[1])),
                                                  static_cast<int>(readNumber(context, args[2])));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value setPlaceholder(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "placeholder", count, 2,
                        [&](Surface& surface)
                        {
                            surface.setPlaceholder(readId(args[0]), readString(context, args[1], "placeholder"));
                            return jsi::Value::undefined();
                        });
        }

        // setSelection(id, anchor, focus) in UTF-16 indices.
        jsi::Value setSelection(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "setSelectionRange", count, 3,
                        [&](Surface& surface)
                        {
                            const NodeId id = readId(args[0]);
                            Node* node = surface.find(id);
                            if (node == nullptr)
                                throw std::invalid_argument("unknown node");
                            const std::string& text = node->text();
                            surface.setSelection(id, { byteOffset(text, readNumber(context, args[1])),
                                                       byteOffset(text, readNumber(context, args[2])) });
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value selection(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "selection", count, 1,
                        [&](Surface& surface)
                        {
                            Node* node = surface.find(readId(args[0]));
                            if (node == nullptr)
                                throw std::invalid_argument("unknown node");
                            bind::ObjectBuilder object(context);
                            object.set("anchor", jsi::Value(utf16Index(node->text(), node->selection().anchor)));
                            object.set("focus", jsi::Value(utf16Index(node->text(), node->selection().focus)));
                            return object.release();
                        });
        }

        // offsetAt(id, x, y): the UTF-16 index of the text nearest a point
        // relative to the node.
        jsi::Value offsetAt(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "offsetAt", count, 3,
                        [&](Surface& surface)
                        {
                            const NodeId id = readId(args[0]);
                            const Point point { static_cast<float>(readNumber(context, args[1])),
                                                static_cast<float>(readNumber(context, args[2])) };
                            const std::size_t offset = surface.textOffsetAt(id, point);
                            return jsi::Value(
                                utf16Index(surface.find(id)->text(),
                                           offset)); // NOLINT(modernize-return-braced-init-list): a lambda
                        });
        }

        jsi::Value scrollTo(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "scrollTo", count, 3,
                        [&](Surface& surface)
                        {
                            surface.scrollTo(readId(args[0]), { static_cast<float>(readNumber(context, args[1])),
                                                                static_cast<float>(readNumber(context, args[2])) });
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value scrollOffset(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "scrollOffset", count, 1,
                        [&](Surface& surface)
                        {
                            Node* node = surface.find(readId(args[0]));
                            if (node == nullptr)
                                throw std::invalid_argument("unknown node");
                            bind::ObjectBuilder object(context);
                            object.set("x", jsi::Value(double(node->scrollOffset().x)));
                            object.set("y", jsi::Value(double(node->scrollOffset().y)));
                            return object.release();
                        });
        }

        jsi::Value contentSize(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "contentSize", count, 1,
                        [&](Surface& surface)
                        {
                            const Size size = surface.contentSize(readId(args[0]));
                            bind::ObjectBuilder object(context);
                            object.set("width", jsi::Value(double(size.width)));
                            object.set("height", jsi::Value(double(size.height)));
                            return object.release();
                        });
        }

        jsi::Value readClipboard(ContextState& context, const jsi::Value&, const jsi::Value*, std::size_t count)
        {
            return call(context, "readText", count, 0,
                        [&](Surface& surface) { return bind::write(context, surface.clipboard().readText()); });
        }

        jsi::Value writeClipboard(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            return call(context, "writeText", count, 1,
                        [&](Surface& surface)
                        {
                            surface.clipboard().writeText(readString(context, args[0], "text"));
                            return jsi::Value::undefined();
                        });
        }

        jsi::Value setFrameListener(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count < 1 || ! bind::isFunction(context, args[0]))
                bind::throwTypeError(context, "setFrameListener() expects a function");
            bind::retainValue(context, &frameListenerKey, jsi::Value(context.rt, args[0]));
            return jsi::Value::undefined();
        }

        // ── Events ───────────────────────────────────────────────────────────

        jsi::Value eventData(ContextState& context, const Event& event)
        {
            static constexpr const char* pointerTypes[] = { "mouse", "pen", "touch" };
            bind::ObjectBuilder data(context);
            data.set("related", jsi::Value(double(event.related)));
            data.set("modifiers", jsi::Value(double(event.modifiers)));
            switch (event.type)
            {
                case Event::Type::Wheel:
                    data.set("deltaX", jsi::Value(double(event.deltaX)));
                    data.set("deltaY", jsi::Value(double(event.deltaY)));
                    data.set("deltaMode", jsi::Value(event.deltaUnit == WheelInput::Unit::Line ? 1 : 0));
                    [[fallthrough]];
                case Event::Type::PointerDown:
                case Event::Type::PointerMove:
                case Event::Type::PointerUp:
                case Event::Type::PointerCancel:
                case Event::Type::PointerEnter:
                case Event::Type::PointerLeave:
                case Event::Type::Click:
                case Event::Type::ContextMenu:
                    data.set("x", jsi::Value(double(event.position.x)));
                    data.set("y", jsi::Value(double(event.position.y)));
                    data.set("offsetX", jsi::Value(double(event.offset.x)));
                    data.set("offsetY", jsi::Value(double(event.offset.y)));
                    data.set("pointerId", jsi::Value(double(event.pointerId)));
                    data.set("pointerType", bind::write(context, pointerTypes[static_cast<int>(event.pointerType)]));
                    data.set("button", jsi::Value(double(event.button)));
                    data.set("buttons", jsi::Value(double(event.buttons)));
                    data.set("pressure", jsi::Value(double(event.pressure)));
                    break;
                case Event::Type::KeyDown:
                case Event::Type::KeyUp:
                    data.set("key", bind::write(context, event.key));
                    data.set("repeat", jsi::Value(event.repeat));
                    break;
                case Event::Type::BeforeInput:
                    data.set("data", bind::write(context, event.text));
                    break;
                case Event::Type::AccessibilityAction:
                    data.set("action", bind::write(context, event.action));
                    if (const auto* number = std::get_if<double>(&event.value))
                        data.set("value", jsi::Value(*number));
                    else if (const auto* text = std::get_if<std::string>(&event.value))
                        data.set("value", bind::write(context, *text));
                    break;
                case Event::Type::Focus:
                case Event::Type::Blur:
                case Event::Type::Scroll:
                    break;
            }
            return data.release();
        }

        bool dispatch(ContextState& context, const Event& event)
        {
            const jsi::Value* retained = bind::retainedValue(context, &listenerKey);
            if (context.halted() || retained == nullptr || ! bind::isFunction(context, *retained))
                return false;
            const js::detail::JavaScriptCall entry(context);
            try
            {
                // Held for the call: the listener may be replaced while it runs.
                const jsi::Function listener = retained->getObject(context.rt).getFunction(context.rt);
                const jsi::Value result = listener.call(context.rt, jsi::Value(static_cast<int>(event.type)),
                                                        jsi::Value(double(event.target)), eventData(context, event));
                return bind::toBoolean(context, result);
            }
            catch (...)
            {
                context.runtime->log(js::LogLevel::Error,
                                     "soundor:ui dispatch failed: " + js::detail::caughtError(context).toString());
                return false;
            }
        }

        using Function = NativeFunction;

        constexpr Function functions[] = {
            { "createNode", createNode, 1 },
            { "releaseNode", releaseNode, 1 },
            { "insertChild", insertChild, 3 },
            { "removeChild", removeChild, 2 },
            { "setStyle", setStyle, 2 },
            { "setText", setText, 2 },
            { "setFocusable", setFocusable, 2 },
            { "setAccessibility", setAccessibility, 2 },
            { "setAccessibilityParent", setAccessibilityParent, 2 },
            { "setSource", setSource, 2 },
            { "setCanvasSize", setCanvasSize, 3 },
            { "setPlaceholder", setPlaceholder, 2 },
            { "setSelection", setSelection, 3 },
            { "selection", selection, 1 },
            { "offsetAt", offsetAt, 3 },
            { "scrollTo", scrollTo, 3 },
            { "scrollOffset", scrollOffset, 1 },
            { "contentSize", contentSize, 1 },
            { "focus", focus, 1 },
            { "focused", focused, 0 },
            { "frame", nodeFrame, 1 },
            { "bounds", bounds, 1 },
            { "size", viewSize, 0 },
            { "readClipboard", readClipboard, 0 },
            { "writeClipboard", writeClipboard, 1 },
            { "setListener", setListener, 1 },
            { "setFrameListener", setFrameListener, 1 },
        };

        void initializeInternalModule(ContextState& context, jsi::Object& exports)
        {
            Surface* surface = nullptr;
            try
            {
                surface = &surfaceOf(context);
            }
            catch (const std::exception& error)
            {
                bind::throwInternalError(context, error.what());
            }
            for (const auto& list : { std::span<const Function>(functions), canvasFunctions(), gpu::webglFunctions() })
                for (const Function& function : list)
                    bind::setProperty(context, exports, function.name,
                                      bind::function(context, function.name, function.length, function.call));
            bind::setProperty(context, exports, "rootId", jsi::Value(double(surface->root().id())));
            bind::setProperty(context, exports, "overlayId", jsi::Value(double(surface->overlay().id())));
        }
    } // namespace

    Surface& surfaceOf(js::bind::ContextState& context)
    {
        auto* binding = js::bind::contextData<Binding>(context, &bindingKey);
        if (binding == nullptr)
            throw std::logic_error("soundor:ui is not installed in this context");
        return *binding->surface;
    }

    void install(js::Context& context, std::shared_ptr<Surface> surface)
    {
        if (surface == nullptr)
            throw std::invalid_argument("soundor:ui needs a surface");
        auto& state = js::stateOf(context);
        surface->setEventSink([&state](const Event& event) { return dispatch(state, event); });
        bind::setContextData(context, &bindingKey, std::make_shared<Binding>(std::move(surface)));
        installCanvases(context);
        // WebGL on a device of its own until the host offers one.
        gpu::installWebGL(context, nullptr, false);
        js::registerNativeModule(context, "soundor:internal/ui", { initializeInternalModule, {}, {} });
        js::registerNativeModule(context, "soundor:internal/ui/frames",
                                 { {}, embedded::uiFramesModule.text(), embedded::uiFramesModule.bytecode });
        js::registerNativeModule(context, "soundor:internal/ui/canvas",
                                 { {}, embedded::uiCanvasModule.text(), embedded::uiCanvasModule.bytecode });
        js::registerNativeModule(
            context, "soundor:internal/ui/webgl-generated",
            { {}, embedded::uiWebGLGeneratedModule.text(), embedded::uiWebGLGeneratedModule.bytecode });
        js::registerNativeModule(context, "soundor:internal/ui/webgl",
                                 { {}, embedded::uiWebGLModule.text(), embedded::uiWebGLModule.bytecode });
        js::registerNativeModule(context, "soundor:ui", { {}, embedded::uiModule.text(), embedded::uiModule.bytecode });

        // requestAnimationFrame(), devicePixelRatio and the canvas and WebGL
        // classes are global, like on the Web.
        for (const char* module :
             { "soundor:internal/ui/frames", "soundor:internal/ui/canvas", "soundor:internal/ui/webgl" })
            if (auto loaded = context.importModule(module); ! loaded)
                throw std::runtime_error("soundor:ui failed to start: " + loaded.error().toString());
    }

    void frame(js::Context& context)
    {
        auto& state = js::stateOf(context);
        const jsi::Value* retained = bind::retainedValue(state, &frameListenerKey);
        if (retained == nullptr || ! bind::isFunction(state, *retained))
            return;
        const jsi::Function listener = retained->getObject(state.rt).getFunction(state.rt);
        bind::call(state, listener, jsi::Value::undefined(), {}, "animation frame failed");
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
