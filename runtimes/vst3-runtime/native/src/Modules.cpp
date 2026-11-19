#include "Modules.h"

#include "Controller.h"
#include "Log.h"
#include "Presets.h"
#include "js/Bindings.h"
#include "js/RustMethods.h"
#include "modules/history/HistoryBindings.h"

#include <algorithm>
#include <list>
#include <map>

namespace soundor::vst3::modules
{
    namespace bind = js::bind;
    namespace hist = soundor::history;
    using bind::ContextState;

    namespace
    {
        jsi::Value freeze(ContextState& ctx, jsi::Value value)
        {
            if (! value.isObject())
                return value;
            auto object = value.getObject(ctx.rt);
            auto names = object.getPropertyNames(ctx.rt);
            for (std::size_t i = 0; i < names.size(ctx.rt); ++i)
            {
                auto child = object.getProperty(ctx.rt, names.getValueAtIndex(ctx.rt, i).getString(ctx.rt));
                if (child.isObject())
                    static_cast<void>(freeze(ctx, std::move(child)));
            }
            auto constructor = ctx.rt.global().getPropertyAsObject(ctx.rt, "Object");
            return constructor.getPropertyAsFunction(ctx.rt, "freeze").call(ctx.rt, object);
        }

        // Strings without NUL or lone surrogates, and resource limits, as the
        // generated bindings check them before converting.
        void validateInput(ContextState& ctx, const jsi::Value& value, std::size_t depth, std::size_t& budget)
        {
            if (depth > 64 || budget == 0)
                bind::throwRangeError(ctx, "state value exceeds resource limits");
            --budget;
            if (value.isString())
            {
                const auto text = value.getString(ctx.rt).utf16(ctx.rt);
                for (std::size_t i = 0; i < text.size(); ++i)
                {
                    const auto c = text[i];
                    if (c == 0 || (c >= 0xdc00 && c <= 0xdfff))
                        bind::throwTypeError(ctx, "invalid Unicode state string");
                    if (c >= 0xd800 && c <= 0xdbff)
                    {
                        ++i;
                        if (i >= text.size() || text[i] < 0xdc00 || text[i] > 0xdfff)
                            bind::throwTypeError(ctx, "invalid Unicode state string");
                    }
                }
            }
            else if (value.isObject())
            {
                const auto object = value.getObject(ctx.rt);
                if (object.isArray(ctx.rt) && object.getArray(ctx.rt).size(ctx.rt) > budget)
                    bind::throwRangeError(ctx, "state array exceeds resource limits");
                const auto names = object.getPropertyNames(ctx.rt);
                if (names.size(ctx.rt) > budget)
                    bind::throwRangeError(ctx, "state object exceeds resource limits");
                for (std::size_t i = 0; i < names.size(ctx.rt); ++i)
                    validateInput(ctx, object.getProperty(ctx.rt, names.getValueAtIndex(ctx.rt, i).getString(ctx.rt)),
                                  depth + 1, budget);
            }
        }

        // ── soundor:state ────────────────────────────────────────────────────

        const char stateKey = 0;

        struct StateListener
        {
            std::string field; // "" for onRestored
            bool active = true;
        };

        struct StateBinding
        {
            explicit StateBinding(Controller& owner) : controller(owner), session(owner.store().connect()) {}
            ~StateBinding() { controller.store().disconnect(session); }
            StateBinding(const StateBinding&) = delete;
            StateBinding& operator=(const StateBinding&) = delete;
            StateBinding(StateBinding&&) = delete;
            StateBinding& operator=(StateBinding&&) = delete;

            Controller& controller;
            StateStore::Session session;
            std::list<StateListener> listeners;
            std::map<std::string, std::string> cached; // field → JSON of the retained value
            std::map<std::string, char> cacheKeys;     // field → key of the retained value
        };

        StateBinding& stateBinding(ContextState& ctx)
        {
            return *bind::contextData<StateBinding>(ctx, &stateKey);
        }

        // A JavaScript value of a state type as JSON (checked by StateSchema after).
        json::Value toJson(ContextState& ctx, const StateSchema& schema, const json::Value& type,
                           const jsi::Value& value, const bind::Path& path)
        {
            const auto kind = type.stringOr("kind");
            if (kind == "nullable")
                return value.isNull() ? json::Value::null() : toJson(ctx, schema, type.at("inner"), value, path);
            if (kind == "array")
            {
                const auto array = bind::expectArray(ctx, value, path);
                const auto length = array.size(ctx.rt);
                std::vector<json::Value> out;
                out.reserve(length);
                for (std::size_t i = 0; i < length; ++i)
                    out.push_back(
                        toJson(ctx, schema, type.at("element"), array.getValueAtIndex(ctx.rt, i), path.element(i)));
                return json::Value::array(std::move(out));
            }
            if (kind == "declared")
            {
                const auto* declaration = schema.declaredType(type.at("name").asString());
                if (declaration == nullptr)
                    bind::throwTypeError(ctx, path.toString() + ": unknown type");
                if (declaration->stringOr("kind") == "enum")
                {
                    std::vector<std::string_view> values;
                    for (const auto& option : declaration->at("values").asArray())
                        values.emplace_back(option.asString());
                    std::size_t index = 0;
                    bind::readEnum(ctx, value, path, values, index);
                    return json::Value::string(std::string(values[index]));
                }
                const auto object = bind::expectObject(ctx, value, path);
                const auto& fields = declaration->at("fields").asArray();
                if (object.getPropertyNames(ctx.rt).size(ctx.rt) != fields.size())
                    bind::throwTypeError(ctx, path.toString() + ": unexpected struct fields");
                std::vector<json::Value::Member> out;
                for (const auto& field : fields)
                {
                    const auto& name = field.at("name").asString();
                    out.emplace_back(name, toJson(ctx, schema, field.at("type"),
                                                  bind::property(ctx, object, name.c_str()), path.field(name.c_str())));
                }
                return json::Value::object(std::move(out));
            }
            const auto& name = type.at("name").asString();
            if (name == "boolean")
            {
                bool out = false;
                bind::read(ctx, value, path, out);
                return json::Value::boolean(out);
            }
            if (name == "string")
            {
                std::string out;
                bind::read(ctx, value, path, out);
                return json::Value::string(std::move(out));
            }
            if (name == "int64")
            {
                std::int64_t out = 0;
                bind::read(ctx, value, path, out);
                return json::Value::string(std::to_string(out));
            }
            if (name == "uint64")
            {
                std::uint64_t out = 0;
                bind::read(ctx, value, path, out);
                return json::Value::string(std::to_string(out));
            }
            const auto readNumber = [&](auto out)
            {
                bind::read(ctx, value, path, out);
                return json::Value::number(static_cast<double>(out));
            };
            if (name == "float32")
                return readNumber(float {});
            if (name == "int8")
                return readNumber(std::int8_t {});
            if (name == "uint8")
                return readNumber(std::uint8_t {});
            if (name == "int16")
                return readNumber(std::int16_t {});
            if (name == "uint16")
                return readNumber(std::uint16_t {});
            if (name == "int32")
                return readNumber(std::int32_t {});
            if (name == "uint32")
                return readNumber(std::uint32_t {});
            double out = 0;
            bind::readFloat64(ctx, value, path, out);
            return json::Value::number(out);
        }

        // Canonical JSON of a state type as a JavaScript value.
        jsi::Value fromJson(ContextState& ctx, const StateSchema& schema, const json::Value& type,
                            const json::Value& value)
        {
            const auto kind = type.stringOr("kind");
            if (kind == "nullable")
                return value.isNull() ? jsi::Value::null() : fromJson(ctx, schema, type.at("inner"), value);
            if (kind == "array")
            {
                const auto& items = value.asArray();
                jsi::Array array(ctx.rt, items.size());
                for (std::size_t i = 0; i < items.size(); ++i)
                    array.setValueAtIndex(ctx.rt, i, fromJson(ctx, schema, type.at("element"), items[i]));
                return array;
            }
            if (kind == "declared")
            {
                const auto* declaration = schema.declaredType(type.at("name").asString());
                if (declaration != nullptr && declaration->stringOr("kind") == "struct")
                {
                    bind::ObjectBuilder object(ctx);
                    for (const auto& field : declaration->at("fields").asArray())
                    {
                        const auto& name = field.at("name").asString();
                        object.set(name.c_str(), fromJson(ctx, schema, field.at("type"), value.at(name)));
                    }
                    return object.release();
                }
                return bind::write(ctx, value.asString());
            }
            const auto& name = type.at("name").asString();
            if (name == "boolean")
                return { value.asBoolean() };
            if (name == "string")
                return bind::write(ctx, value.asString());
            if (name == "int64")
            {
                const auto integer = json::Value::numberText(value.asString()).asInt64();
                if (! integer)
                    throw std::invalid_argument("invalid int64 state");
                return bind::write(ctx, *integer);
            }
            if (name == "uint64")
            {
                const auto integer = json::Value::numberText(value.asString()).asUint64();
                if (! integer)
                    throw std::invalid_argument("invalid uint64 state");
                return bind::write(ctx, *integer);
            }
            return { value.asNumber() };
        }

        jsi::Value stateValue(ContextState& ctx, std::size_t field, const std::string& json)
        {
            auto& view = stateBinding(ctx);
            const auto& schema = view.controller.schema();
            const auto& name = schema.field(field).name;
            auto& key = view.cacheKeys[name];
            const auto cached = view.cached.find(name);
            if (cached == view.cached.end() || cached->second != json || bind::retainedValue(ctx, &key) == nullptr)
            {
                auto value = fromJson(ctx, schema, schema.field(field).type, json::parse(json));
                bind::retainValue(ctx, &key, freeze(ctx, std::move(value)));
                view.cached[name] = json;
            }
            return { ctx.rt, *bind::retainedValue(ctx, &key) };
        }

        jsi::Value subscribeState(ContextState& ctx, std::string field, const jsi::Value* args, std::size_t count)
        {
            if (count != 1 || ! bind::isFunction(ctx, args[0]))
                bind::throwTypeError(ctx, "subscribe expects a function");
            auto& entry = stateBinding(ctx).listeners.emplace_back(StateListener { std::move(field), true });
            bind::retainValue(ctx, &entry, jsi::Value(ctx.rt, args[0]));
            return bind::closure(
                ctx, "unsubscribe", 0,
                [entry = &entry](ContextState& context, const jsi::Value&, const jsi::Value*, std::size_t)
                {
                    entry->active = false;
                    bind::retainValue(context, entry, jsi::Value::undefined());
                    return jsi::Value::undefined();
                });
        }

        jsi::Value stateField(ContextState& ctx, std::size_t field)
        {
            const auto& name = stateBinding(ctx).controller.schema().field(field).name;
            bind::ObjectBuilder object(ctx);
            object.set("get", bind::closure(ctx, "get", 0,
                                            [field](ContextState& c, const jsi::Value&, const jsi::Value*, std::size_t)
                                            {
                                                return bind::invoke(
                                                    c, "state.get",
                                                    [&]
                                                    {
                                                        auto& view = stateBinding(c);
                                                        const auto& n = view.controller.schema().field(field).name;
                                                        return stateValue(c, field, view.controller.store().get(n));
                                                    });
                                            }));
            object.set(
                "set",
                bind::closure(
                    ctx, "set", 1,
                    [field](ContextState& c, const jsi::Value&, const jsi::Value* args, std::size_t count)
                    {
                        return bind::invoke(
                            c, "state.set",
                            [&]
                            {
                                auto& view = stateBinding(c);
                                auto& store = view.controller.store();
                                return hist::invoke(
                                    c, store.historyManager(),
                                    [&]() -> jsi::Value
                                    {
                                        const auto& schema = view.controller.schema();
                                        const auto& n = schema.field(field).name;
                                        if (count < 1 || count > 2)
                                            bind::throwTypeError(c, "set expects a value and optional History options");
                                        const auto options = hist::readOptions(c, args, count, 1);
                                        auto resolved = jsi::Value(c.rt, args[0]);
                                        if (bind::isFunction(c, resolved))
                                        {
                                            auto current = stateValue(c, field, store.get(n));
                                            resolved = resolved.getObject(c.rt).getFunction(c.rt).call(c.rt, current);
                                        }
                                        if (resolved.isObject()
                                            && bind::isFunction(c, resolved.getObject(c.rt).getProperty(c.rt, "then")))
                                            bind::throwTypeError(
                                                c, "Setters require synchronous values, not promises or thenables");
                                        std::size_t budget = 100000;
                                        validateInput(c, resolved, 0, budget);
                                        const std::string where = "state." + n;
                                        const bind::Path path { where.c_str() };
                                        const auto json = toJson(c, schema, schema.field(field).type, resolved, path);
                                        std::string canonical;
                                        try
                                        {
                                            canonical = schema.canonical(field, json);
                                        }
                                        catch (const std::invalid_argument& error)
                                        {
                                            bind::throwTypeError(c, error.what());
                                        }
                                        store.set(n, std::move(canonical), options);
                                        return jsi::Value::undefined();
                                    });
                            });
                    }));
            object.set("beginGesture",
                       bind::closure(
                           ctx, "beginGesture", 0,
                           [field](ContextState& c, const jsi::Value&, const jsi::Value* args, std::size_t count)
                           {
                               return bind::invoke(
                                   c, "state.beginGesture",
                                   [&]
                                   {
                                       auto& view = stateBinding(c);
                                       auto& store = view.controller.store();
                                       return hist::invoke(
                                           c, store.historyManager(),
                                           [&]() -> jsi::Value
                                           {
                                               if (count > 1)
                                                   bind::throwTypeError(
                                                       c, "beginGesture expects optional History options");
                                               store.beginGesture(view.controller.schema().field(field).name,
                                                                  view.session, hist::readOptions(c, args, count, 0));
                                               return jsi::Value::undefined();
                                           });
                                   });
                           }));
            object.set("endGesture",
                       bind::closure(ctx, "endGesture", 0,
                                     [field](ContextState& c, const jsi::Value&, const jsi::Value*, std::size_t count)
                                     {
                                         return bind::invoke(
                                             c, "state.endGesture",
                                             [&]
                                             {
                                                 auto& view = stateBinding(c);
                                                 auto& store = view.controller.store();
                                                 return hist::invoke(
                                                     c, store.historyManager(),
                                                     [&]() -> jsi::Value
                                                     {
                                                         bind::expectArgumentCount(c, "endGesture", count, 0);
                                                         store.endGesture(view.controller.schema().field(field).name,
                                                                          view.session);
                                                         return jsi::Value::undefined();
                                                     });
                                             });
                                     }));
            object.set(
                "subscribe",
                bind::closure(ctx, "subscribe", 1,
                              [name](ContextState& c, const jsi::Value&, const jsi::Value* args, std::size_t count) {
                                  return bind::invoke(c, "state.subscribe",
                                                      [&] { return subscribeState(c, name, args, count); });
                              }));
            return freeze(ctx, object.release());
        }

        // ── soundor:presets ──────────────────────────────────────────────────

        const char presetsKey = 0;

        struct PresetListener
        {
            bool active = true;
        };

        struct PresetsBinding
        {
            explicit PresetsBinding(FactoryPresets& value) : service(value), delivered(value.snapshot()) {}
            FactoryPresets& service;
            FactoryPresets::Selection delivered;
            std::optional<FactoryPresets::Selection> cached;
            std::list<PresetListener> listeners;
            char snapshotKey = 0;
            char listKey = 0;
        };

        PresetsBinding& presetsBinding(ContextState& ctx)
        {
            return *bind::contextData<PresetsBinding>(ctx, &presetsKey);
        }

        jsi::Value presetSnapshot(ContextState& ctx)
        {
            auto& view = presetsBinding(ctx);
            const auto next = view.service.snapshot();
            if (! view.cached || *view.cached != next)
            {
                bind::ObjectBuilder object(ctx);
                object.set("factoryId", next.factoryId ? bind::write(ctx, *next.factoryId) : jsi::Value::null());
                object.set("modified", jsi::Value(next.modified));
                bind::retainValue(ctx, &view.snapshotKey, freeze(ctx, object.release()));
                view.cached = next;
            }
            return { ctx.rt, *bind::retainedValue(ctx, &view.snapshotKey) };
        }

        // ── soundor:native ───────────────────────────────────────────────────

        const char controllerKey = 0;
        const char eventsKey = 0;
        const char streamsKey = 0;
        const char nativeKey = 0;

        struct NativeBinding
        {
            // The descriptor's names, which outlive the context.
            std::vector<const char*> events, streams;
            bool methods = false;
            // Streams nothing feeds, when the processor is out of reach.
            std::unique_ptr<Streams> idle;
        };
    } // namespace

    void installState(js::Context& context, Controller& controller)
    {
        bind::setContextData(context, &stateKey, std::make_shared<StateBinding>(controller));
        js::registerNativeModule(
            context, "soundor:state",
            { [](ContextState& ctx, jsi::Object& exports)
              {
                  auto& view = stateBinding(ctx);
                  bind::ObjectBuilder fields(ctx);
                  const auto& schema = view.controller.schema();
                  for (std::size_t i = 0; i < schema.size(); ++i)
                      fields.set(schema.field(i).name.c_str(), stateField(ctx, i));
                  fields.set(
                      "onRestored",
                      bind::closure(ctx, "onRestored", 1,
                                    [](ContextState& c, const jsi::Value&, const jsi::Value* args, std::size_t count) {
                                        return bind::invoke(c, "state.onRestored",
                                                            [&] { return subscribeState(c, "", args, count); });
                                    }));
                  bind::setProperty(ctx, exports, "state", freeze(ctx, fields.release()));
              },
              {},
              {} });
    }

    void dispatchState(js::Context& context)
    {
        auto& ctx = js::stateOf(context);
        auto* view = bind::contextData<StateBinding>(ctx, &stateKey);
        if (view == nullptr || ctx.halted())
            return;
        const auto& schema = view->controller.schema();
        for (const auto& event : view->controller.store().drain())
        {
            const auto field = event.restored ? std::string() : event.field;
            std::vector<const StateListener*> entries;
            for (const auto& entry : view->listeners)
                if (entry.active && entry.field == field)
                    entries.push_back(&entry);
            // Nobody listens to the field: its value is not converted.
            if (entries.empty())
                continue;
            jsi::Value value = jsi::Value::undefined();
            if (! event.restored)
                if (const auto index = schema.indexOf(field))
                    value = stateValue(ctx, *index, event.value);
            for (const auto* entry : entries)
            {
                const auto* retained = bind::retainedValue(ctx, entry);
                if (! entry->active || retained == nullptr || ! bind::isFunction(ctx, *retained))
                    continue;
                auto function = retained->getObject(ctx.rt).getFunction(ctx.rt);
                const jsi::Value args[] = { jsi::Value(ctx.rt, value) };
                bind::call(ctx, function, jsi::Value::undefined(),
                           event.restored ? std::span<const jsi::Value>() : std::span<const jsi::Value>(args),
                           "state subscriber failed");
            }
        }
    }

    void installPresets(js::Context& context, FactoryPresets& presets)
    {
        bind::setContextData(context, &presetsKey, std::make_shared<PresetsBinding>(presets));
        js::registerNativeModule(
            context, "soundor:presets",
            { [](ContextState& ctx, jsi::Object& exports)
              {
                  bind::ObjectBuilder api(ctx);
                  bind::ObjectBuilder factory(ctx);
                  factory.set(
                      "list",
                      bind::closure(ctx, "list", 0,
                                    [](ContextState& c, const jsi::Value&, const jsi::Value*, std::size_t count)
                                    {
                                        return bind::invoke(
                                            c, "presets.factory.list",
                                            [&]() -> jsi::Value
                                            {
                                                bind::expectArgumentCount(c, "list", count, 0);
                                                auto& view = presetsBinding(c);
                                                if (bind::retainedValue(c, &view.listKey) == nullptr)
                                                {
                                                    const auto& all = view.service.factoryPresets();
                                                    jsi::Array array(c.rt, all.size());
                                                    for (std::size_t i = 0; i < all.size(); ++i)
                                                    {
                                                        bind::ObjectBuilder entry(c);
                                                        entry.set("id", bind::write(c, all[i].id));
                                                        entry.set("name", bind::write(c, all[i].name));
                                                        array.setValueAtIndex(c.rt, i, freeze(c, entry.release()));
                                                    }
                                                    bind::retainValue(c, &view.listKey, freeze(c, std::move(array)));
                                                }
                                                return { c.rt, *bind::retainedValue(c, &view.listKey) };
                                            });
                                    }));
                  factory.set(
                      "load",
                      bind::closure(
                          ctx, "load", 1,
                          [](ContextState& c, const jsi::Value&, const jsi::Value* args, std::size_t count)
                          {
                              return bind::invoke(
                                  c, "presets.factory.load",
                                  [&]
                                  {
                                      auto& view = presetsBinding(c);
                                      return hist::invoke(
                                          c, view.service.historyManager(),
                                          [&]() -> jsi::Value
                                          {
                                              if (count < 1 || count > 2 || ! args[0].isString())
                                                  bind::throwTypeError(
                                                      c,
                                                      "load expects a factory preset id and optional History options");
                                              const auto id = args[0].getString(c.rt).utf8(c.rt);
                                              const auto& all = view.service.factoryPresets();
                                              if (std::none_of(all.begin(), all.end(),
                                                               [&](const Preset& preset) { return preset.id == id; }))
                                                  bind::throwTypeError(c, "Unknown factory preset '" + id + "'");
                                              view.service.loadFactory(id, hist::readOptions(c, args, count, 1));
                                              return jsi::Value::undefined();
                                          });
                                  });
                          }));
                  api.set("factory", freeze(ctx, factory.release()));
                  api.set("getSnapshot",
                          bind::closure(ctx, "getSnapshot", 0,
                                        [](ContextState& c, const jsi::Value&, const jsi::Value*, std::size_t count)
                                        {
                                            return bind::invoke(c, "presets.getSnapshot",
                                                                [&]
                                                                {
                                                                    bind::expectArgumentCount(c, "getSnapshot", count,
                                                                                              0);
                                                                    return presetSnapshot(c);
                                                                });
                                        }));
                  api.set(
                      "subscribe",
                      bind::closure(ctx, "subscribe", 1,
                                    [](ContextState& c, const jsi::Value&, const jsi::Value* args, std::size_t count)
                                    {
                                        return bind::invoke(
                                            c, "presets.subscribe",
                                            [&]() -> jsi::Value
                                            {
                                                if (count != 1 || ! bind::isFunction(c, args[0]))
                                                    bind::throwTypeError(c, "subscribe expects a function");
                                                auto& listener = presetsBinding(c).listeners.emplace_back();
                                                bind::retainValue(c, &listener, jsi::Value(c.rt, args[0]));
                                                return bind::closure(
                                                    c, "unsubscribe", 0,
                                                    [entry = &listener](ContextState& view, const jsi::Value&,
                                                                        const jsi::Value*, std::size_t)
                                                    {
                                                        entry->active = false;
                                                        bind::retainValue(view, entry, jsi::Value::undefined());
                                                        return jsi::Value::undefined();
                                                    });
                                            });
                                    }));
                  bind::setProperty(ctx, exports, "presets", freeze(ctx, api.release()));
              },
              {},
              {} });
    }

    void dispatchPresets(js::Context& context)
    {
        auto& ctx = js::stateOf(context);
        auto* view = bind::contextData<PresetsBinding>(ctx, &presetsKey);
        if (view == nullptr || ctx.halted()
            || std::none_of(view->listeners.begin(), view->listeners.end(),
                            [](const PresetListener& listener) { return listener.active; }))
            return;
        const auto next = view->service.snapshot();
        if (next == view->delivered)
            return;
        view->delivered = next;
        std::vector<const PresetListener*> listeners;
        for (const auto& listener : view->listeners)
            if (listener.active)
                listeners.push_back(&listener);
        for (const auto* listener : listeners)
        {
            const auto* value = bind::retainedValue(ctx, listener);
            if (listener->active && value != nullptr && bind::isFunction(ctx, *value))
            {
                auto callback = value->getObject(ctx.rt).getFunction(ctx.rt);
                bind::call(ctx, callback, jsi::Value::undefined(), {}, "preset subscriber failed");
            }
        }
    }

    void installNative(js::Context& context, Controller& controller)
    {
        const auto& plugin = controller.plugin();
        const auto& rust = controller.rustController();
        const bool methods = rust != nullptr && rust->present() && ! rust->contract().methods.empty();
        if (! methods && plugin.events.empty() && plugin.streams.empty())
            return;
        auto binding = std::make_shared<NativeBinding>();
        binding->methods = methods;
        for (const auto& name : plugin.events)
            binding->events.push_back(name.c_str());
        for (const auto& stream : plugin.streams)
            binding->streams.push_back(stream.name.c_str());
        if (methods)
            bind::setRustController(context, &controllerKey, rust);
        if (! plugin.streams.empty())
        {
            const auto& link = controller.link();
            if (link != nullptr && link->streams != nullptr)
                bind::connectStreams(context, link->streams->cores(), &streamsKey);
            else
            {
                binding->idle = std::make_unique<Streams>(plugin);
                bind::connectStreams(context, binding->idle->cores(), &streamsKey);
            }
        }
        bind::setContextData(context, &nativeKey, binding);
        js::registerNativeModule(context, "soundor:native",
                                 { [](ContextState& ctx, jsi::Object& exports)
                                   {
                                       auto& view = *bind::contextData<NativeBinding>(ctx, &nativeKey);
                                       if (view.methods)
                                           bind::installRustMethods(ctx, exports, &controllerKey);
                                       if (! view.events.empty())
                                           bind::installEvents(ctx, exports, view.events, &eventsKey);
                                       if (! view.streams.empty())
                                           bind::installStreams(ctx, exports, view.streams, &streamsKey);
                                   },
                                   {},
                                   {} });
    }
} // namespace soundor::vst3::modules
