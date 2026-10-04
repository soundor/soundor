#include "modules/ui/UiModule.h"

#include "js/Bindings.h"
#include "modules/Embedded.h"

#include <array>
#include <cmath>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    namespace
    {
        namespace bind = js::bind;

        const char bindingKey = 0;
        const char listenerKey = 0;

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

        Surface& surfaceOf(JSContext* ctx)
        {
            auto* binding = bind::contextData<Binding>(ctx, &bindingKey);
            if (binding == nullptr)
                throw std::logic_error("soundor:ui is not installed in this context");
            return *binding->surface;
        }

        NodeId readId(JSContext* ctx, JSValueConst value)
        {
            double number = 0;
            if (! JS_IsNumber(value) || JS_ToFloat64(ctx, &number, value) < 0 || number < 0 || number > 4294967295.0
                || std::floor(number) != number)
                throw std::invalid_argument("invalid node id");
            return static_cast<NodeId>(number);
        }

        JSValue writeRect(JSContext* ctx, Rect rect)
        {
            bind::ObjectBuilder object(ctx);
            object.set("x", JS_NewFloat64(ctx, rect.x));
            object.set("y", JS_NewFloat64(ctx, rect.y));
            object.set("width", JS_NewFloat64(ctx, rect.width));
            object.set("height", JS_NewFloat64(ctx, rect.height));
            return object.release();
        }

        // ── Style ────────────────────────────────────────────────────────────

        // Reads a style object into a Style. Unknown keys are left for others
        // (the renderer's visual properties); known keys with invalid values
        // throw a TypeError naming them.
        class StyleReader
        {
        public:
            StyleReader(JSContext* context, JSValueConst object) : ctx(context), style(object) {}

            Style read()
            {
                Style out;
                readLayout(out);
                readSpacing(out);
                readText(out.text);
                return out;
            }

        private:
            struct Property
            {
                Property(JSContext* context, JSValueConst object, const char* key)
                    : ctx(context), name(key), value(JS_GetPropertyStr(context, object, key))
                {
                    if (JS_IsException(value))
                        throw JsError {};
                }
                ~Property() { JS_FreeValue(ctx, value); }
                Property(const Property&) = delete;
                Property& operator=(const Property&) = delete;

                [[nodiscard]] bool present() const { return ! JS_IsUndefined(value) && ! JS_IsNull(value); }

                JSContext* ctx;
                const char* name;
                JSValue value;
            };

        public:
            // A JavaScript exception is pending.
            struct JsError
            {
            };

        private:
            [[noreturn]] void fail(const Property& property, std::string_view expected)
            {
                const char* actual = JS_ToCString(ctx, property.value);
                const std::string got = actual == nullptr ? "?" : actual;
                JS_FreeCString(ctx, actual);
                JS_ThrowTypeError(ctx, "style.%s: expected %.*s, got %s", property.name,
                                  static_cast<int>(expected.size()), expected.data(),
                                  JS_IsString(property.value) ? ("'" + got + "'").c_str() : got.c_str());
                throw JsError {};
            }

            std::optional<float> number(const char* key)
            {
                Property property(ctx, style, key);
                if (! property.present())
                    return std::nullopt;
                double value = 0;
                if (! JS_IsNumber(property.value) || JS_ToFloat64(ctx, &value, property.value) < 0
                    || ! std::isfinite(value))
                    fail(property, "a finite number");
                return static_cast<float>(value);
            }

            std::optional<Length> length(const char* key, bool allowAuto)
            {
                Property property(ctx, style, key);
                if (! property.present())
                    return std::nullopt;
                const std::string_view expected =
                    allowAuto ? "a number, a percentage or 'auto'" : "a number or a percentage";
                if (JS_IsNumber(property.value))
                {
                    double value = 0;
                    JS_ToFloat64(ctx, &value, property.value);
                    if (! std::isfinite(value))
                        fail(property, expected);
                    return Length::points(static_cast<float>(value));
                }
                if (JS_IsString(property.value))
                {
                    const char* chars = JS_ToCString(ctx, property.value);
                    const std::string text = chars == nullptr ? "" : chars;
                    JS_FreeCString(ctx, chars);
                    if (allowAuto && text == "auto")
                        return Length::automatic();
                    if (text.size() > 1 && text.back() == '%')
                    {
                        std::size_t used = 0;
                        try
                        {
                            const float value = std::stof(text.substr(0, text.size() - 1), &used);
                            if (used == text.size() - 1 && std::isfinite(value))
                                return Length::percent(value);
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
                Property property(ctx, style, key);
                if (! property.present())
                    return std::nullopt;
                if (JS_IsString(property.value))
                {
                    const char* chars = JS_ToCString(ctx, property.value);
                    const std::string_view text = chars == nullptr ? "" : chars;
                    for (std::size_t i = 0; i < Count; ++i)
                        if (names[i] == text)
                        {
                            JS_FreeCString(ctx, chars);
                            return static_cast<Enum>(i);
                        }
                    JS_FreeCString(ctx, chars);
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
                assign(out.aspectRatio, number("aspectRatio"));
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

            void readText(TextStyle& out)
            {
                static constexpr std::array<std::string_view, 2> fontStyles { "normal", "italic" };
                static constexpr std::array<std::string_view, 4> textAligns { "auto", "left", "center", "right" };

                if (Property family(ctx, style, "fontFamily"); family.present())
                {
                    if (! JS_IsString(family.value))
                        fail(family, "a string");
                    const char* chars = JS_ToCString(ctx, family.value);
                    out.fontFamily = chars == nullptr ? "" : chars;
                    JS_FreeCString(ctx, chars);
                }
                if (const auto size = number("fontSize"); size && *size > 0)
                    out.fontSize = *size;
                if (Property weight(ctx, style, "fontWeight"); weight.present())
                {
                    double value = 0;
                    if (JS_IsNumber(weight.value))
                        JS_ToFloat64(ctx, &value, weight.value);
                    else if (JS_IsString(weight.value))
                    {
                        const char* chars = JS_ToCString(ctx, weight.value);
                        const std::string_view text = chars == nullptr ? "" : chars;
                        value = text == "normal" ? 400 : text == "bold" ? 700 : std::atof(std::string(text).c_str());
                        JS_FreeCString(ctx, chars);
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

            JSContext* ctx;
            JSValueConst style;
        };

        // ── Functions ────────────────────────────────────────────────────────

        template <typename Body>
        JSValue call(JSContext* ctx, const char* method, int argc, int expected, Body&& body)
        {
            if (! bind::expectArgumentCount(ctx, method, argc, expected))
                return JS_EXCEPTION;
            return bind::invoke(ctx, method, [&]() -> JSValue { return body(surfaceOf(ctx)); });
        }

        JSValue createNode(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "createNode", argc, 1,
                        [&](Surface& surface)
                        {
                            const NodeType type = JS_ToBool(ctx, argv[0]) != 0 ? NodeType::Text : NodeType::View;
                            return JS_NewUint32(ctx, surface.createNode(type));
                        });
        }

        JSValue releaseNode(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "releaseNode", argc, 1,
                        [&](Surface& surface)
                        {
                            // Collected after the surface dropped it (a reload): nothing to do.
                            const NodeId id = readId(ctx, argv[0]);
                            if (surface.find(id) != nullptr)
                                surface.releaseNode(id);
                            return JS_UNDEFINED;
                        });
        }

        JSValue insertChild(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "insertBefore", argc, 3,
                        [&](Surface& surface)
                        {
                            surface.insertChild(readId(ctx, argv[0]), readId(ctx, argv[1]), readId(ctx, argv[2]));
                            return JS_UNDEFINED;
                        });
        }

        JSValue removeChild(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "removeChild", argc, 2,
                        [&](Surface& surface)
                        {
                            surface.removeChild(readId(ctx, argv[0]), readId(ctx, argv[1]));
                            return JS_UNDEFINED;
                        });
        }

        JSValue setStyle(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "setStyle", argc, 2,
                        [&](Surface& surface) -> JSValue
                        {
                            const NodeId id = readId(ctx, argv[0]);
                            if (! JS_IsObject(argv[1]))
                                return JS_ThrowTypeError(ctx, "style must be an object");
                            try
                            {
                                surface.setStyle(id, StyleReader(ctx, argv[1]).read());
                            }
                            catch (const StyleReader::JsError&)
                            {
                                return JS_EXCEPTION;
                            }
                            return JS_UNDEFINED;
                        });
        }

        JSValue setText(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "setText", argc, 2,
                        [&](Surface& surface) -> JSValue
                        {
                            std::string text;
                            if (! bind::read(ctx, argv[1], bind::Path { "text" }, text))
                                return JS_EXCEPTION;
                            surface.setText(readId(ctx, argv[0]), std::move(text));
                            return JS_UNDEFINED;
                        });
        }

        JSValue setFocusable(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "setFocusable", argc, 2,
                        [&](Surface& surface)
                        {
                            surface.setFocusable(readId(ctx, argv[0]), JS_ToBool(ctx, argv[1]) != 0);
                            return JS_UNDEFINED;
                        });
        }

        JSValue focus(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "focus", argc, 1,
                        [&](Surface& surface)
                        {
                            surface.focus(readId(ctx, argv[0]));
                            return JS_UNDEFINED;
                        });
        }

        JSValue focused(JSContext* ctx, JSValueConst, int argc, JSValueConst*)
        {
            return call(ctx, "focused", argc, 0,
                        [&](Surface& surface) { return JS_NewUint32(ctx, surface.focused()); });
        }

        JSValue frame(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "layout", argc, 1,
                        [&](Surface& surface)
                        {
                            const NodeId id = readId(ctx, argv[0]);
                            Node* node = surface.find(id);
                            if (node == nullptr)
                                throw std::invalid_argument("unknown node");
                            surface.layout();
                            return writeRect(ctx, node->frame());
                        });
        }

        JSValue bounds(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            return call(ctx, "getBoundingClientRect", argc, 1,
                        [&](Surface& surface)
                        {
                            const NodeId id = readId(ctx, argv[0]);
                            return surface.isConnected(id) ? writeRect(ctx, surface.bounds(id)) : writeRect(ctx, {});
                        });
        }

        JSValue viewSize(JSContext* ctx, JSValueConst, int argc, JSValueConst*)
        {
            return call(ctx, "size", argc, 0,
                        [&](Surface& surface)
                        {
                            bind::ObjectBuilder object(ctx);
                            object.set("width", JS_NewFloat64(ctx, surface.size().width));
                            object.set("height", JS_NewFloat64(ctx, surface.size().height));
                            object.set("scale", JS_NewFloat64(ctx, surface.scale()));
                            return object.release();
                        });
        }

        JSValue setListener(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 1 || ! JS_IsFunction(ctx, argv[0]))
                return JS_ThrowTypeError(ctx, "setListener() expects a function");
            bind::retainValue(ctx, &listenerKey, JS_DupValue(ctx, argv[0]));
            return JS_UNDEFINED;
        }

        // ── Events ───────────────────────────────────────────────────────────

        JSValue eventData(JSContext* ctx, const Event& event)
        {
            static constexpr const char* pointerTypes[] = { "mouse", "pen", "touch" };
            bind::ObjectBuilder data(ctx);
            data.set("related", JS_NewUint32(ctx, event.related));
            data.set("modifiers", JS_NewUint32(ctx, event.modifiers));
            switch (event.type)
            {
                case Event::Type::Wheel:
                    data.set("deltaX", JS_NewFloat64(ctx, event.deltaX));
                    data.set("deltaY", JS_NewFloat64(ctx, event.deltaY));
                    data.set("deltaMode", JS_NewInt32(ctx, event.deltaUnit == WheelInput::Unit::Line ? 1 : 0));
                    [[fallthrough]];
                case Event::Type::PointerDown:
                case Event::Type::PointerMove:
                case Event::Type::PointerUp:
                case Event::Type::PointerCancel:
                case Event::Type::PointerEnter:
                case Event::Type::PointerLeave:
                case Event::Type::Click:
                    data.set("x", JS_NewFloat64(ctx, event.position.x));
                    data.set("y", JS_NewFloat64(ctx, event.position.y));
                    data.set("offsetX", JS_NewFloat64(ctx, event.offset.x));
                    data.set("offsetY", JS_NewFloat64(ctx, event.offset.y));
                    data.set("pointerId", JS_NewInt32(ctx, event.pointerId));
                    data.set("pointerType",
                             bind::write(ctx, std::string(pointerTypes[static_cast<int>(event.pointerType)])));
                    data.set("button", JS_NewInt32(ctx, event.button));
                    data.set("buttons", JS_NewUint32(ctx, event.buttons));
                    data.set("pressure", JS_NewFloat64(ctx, event.pressure));
                    break;
                case Event::Type::KeyDown:
                case Event::Type::KeyUp:
                    data.set("key", bind::write(ctx, event.key));
                    data.set("repeat", JS_NewBool(ctx, event.repeat));
                    break;
                case Event::Type::BeforeInput:
                    data.set("data", bind::write(ctx, event.text));
                    break;
                case Event::Type::Focus:
                case Event::Type::Blur:
                    break;
            }
            return data.release();
        }

        bool dispatch(JSContext* ctx, const Event& event)
        {
            auto* state = js::detail::contextStateOf(ctx);
            if (state == nullptr)
                return false;
            state->runtime->enter();
            JSValue listener = JS_DupValue(ctx, bind::retainedValue(ctx, &listenerKey));
            bool prevented = false;
            if (JS_IsFunction(ctx, listener))
            {
                JSValue args[] = { JS_NewInt32(ctx, static_cast<int>(event.type)), JS_NewUint32(ctx, event.target),
                                   eventData(ctx, event) };
                JSValue result = JS_Call(ctx, listener, JS_UNDEFINED, 3, args);
                for (JSValue& arg : args)
                    JS_FreeValue(ctx, arg);
                if (JS_IsException(result))
                    state->runtime->log(js::LogLevel::Error,
                                        "soundor:ui dispatch failed: " + js::detail::takeException(ctx).toString());
                else
                    prevented = JS_ToBool(ctx, result) > 0;
                JS_FreeValue(ctx, result);
            }
            JS_FreeValue(ctx, listener);
            return prevented;
        }

        bool initializeInternalModule(JSContext* ctx, JSModuleDef* module)
        {
            const auto exportFunction = [&](const char* name, JSCFunction* function, int length)
            { return JS_SetModuleExport(ctx, module, name, JS_NewCFunction(ctx, function, name, length)) == 0; };
            Surface* surface = nullptr;
            try
            {
                surface = &surfaceOf(ctx);
            }
            catch (const std::exception& error)
            {
                JS_ThrowInternalError(ctx, "%s", error.what());
                return false;
            }
            return JS_SetModuleExport(ctx, module, "rootId", JS_NewUint32(ctx, surface->root().id())) == 0
                   && exportFunction("createNode", createNode, 1) && exportFunction("releaseNode", releaseNode, 1)
                   && exportFunction("insertChild", insertChild, 3) && exportFunction("removeChild", removeChild, 2)
                   && exportFunction("setStyle", setStyle, 2) && exportFunction("setText", setText, 2)
                   && exportFunction("setFocusable", setFocusable, 2) && exportFunction("focus", focus, 1)
                   && exportFunction("focused", focused, 0) && exportFunction("frame", frame, 1)
                   && exportFunction("bounds", bounds, 1) && exportFunction("size", viewSize, 0)
                   && exportFunction("setListener", setListener, 1);
        }
    } // namespace

    void install(js::Context& context, std::shared_ptr<Surface> surface)
    {
        if (surface == nullptr)
            throw std::invalid_argument("soundor:ui needs a surface");
        JSContext* ctx = js::rawContext(context);
        surface->setEventSink([ctx](const Event& event) { return dispatch(ctx, event); });
        bind::setContextData(context, &bindingKey, std::make_shared<Binding>(std::move(surface)));
        js::registerNativeModule(
            context, "soundor:internal/ui",
            { { "rootId", "createNode", "releaseNode", "insertChild", "removeChild", "setStyle", "setText",
                "setFocusable", "focus", "focused", "frame", "bounds", "size", "setListener" },
              initializeInternalModule,
              {} });
        js::registerNativeModule(context, "soundor:ui", { {}, {}, embedded::uiModule });
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
