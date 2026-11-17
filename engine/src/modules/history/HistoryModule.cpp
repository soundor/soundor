#include "HistoryBindings.h"

#include <soundor/history/Module.h>

#include <algorithm>
#include <list>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::history
{
    namespace
    {
        namespace bind = js::bind;
        const char bindingKey = 0;
        struct Listener
        {
            bool active = true;
            std::size_t id = 0;
        };
        struct Event
        {
            Status status;
            std::size_t lastListener;
        };
        struct Binding
        {
            explicit Binding(StateHistory& owner) : manager(owner) {}
            void connect(const std::shared_ptr<Binding>& self)
            {
                unsubscribe = manager.subscribe(
                    [weak = std::weak_ptr<Binding>(self)](const Status& status)
                    {
                        if (const auto view = weak.lock())
                        {
                            if (std::any_of(view->listeners.begin(), view->listeners.end(),
                                            [](const auto& listener) { return listener.active; }))
                                view->pending.push_back({ status, view->nextListener });
                        }
                    });
            }
            ~Binding()
            {
                if (unsubscribe)
                    unsubscribe();
            }
            StateHistory& manager;
            std::size_t cached = static_cast<std::size_t>(-1);
            std::size_t nextListener = 0;
            std::function<void()> unsubscribe;
            std::list<Event> pending;
            const char snapshotKey = 0;
            std::list<Listener> listeners;
        };
        Binding& binding(bind::ContextState& ctx)
        {
            return *bind::contextData<Binding>(ctx, &bindingKey);
        }
        jsi::Value statusValue(bind::ContextState& ctx, const Status& status)
        {
            bind::ObjectBuilder result(ctx);
            result.set("canUndo", jsi::Value(status.canUndo));
            result.set("canRedo", jsi::Value(status.canRedo));
            result.set("undoLabel", status.undoLabel ? bind::write(ctx, *status.undoLabel) : jsi::Value::null());
            result.set("redoLabel", status.redoLabel ? bind::write(ctx, *status.redoLabel) : jsi::Value::null());
            auto object = result.release();
            ctx.rt.global()
                .getPropertyAsObject(ctx.rt, "Object")
                .getPropertyAsFunction(ctx.rt, "freeze")
                .call(ctx.rt, object);
            return object;
        }
        jsi::Value snapshot(bind::ContextState& ctx)
        {
            auto& view = binding(ctx);
            const std::lock_guard lock(view.manager.mutex());
            if (view.cached != view.manager.revision())
            {
                bind::retainValue(ctx, &view.snapshotKey, statusValue(ctx, view.manager.status()));
                view.cached = view.manager.revision();
            }
            return { ctx.rt, *bind::retainedValue(ctx, &view.snapshotKey) };
        }
    } // namespace
    void install(js::Context& context, StateHistory& manager)
    {
        auto contextBinding = std::make_shared<Binding>(manager);
        contextBinding->connect(contextBinding);
        bind::setContextData(context, &bindingKey, std::move(contextBinding));
        js::registerNativeModule(
            context, "soundor:history",
            { [](bind::ContextState& ctx, jsi::Object& exports)
              {
                  bind::ObjectBuilder api(ctx);
                  const auto method = [&](const char* name, auto function)
                  {
                      api.set(name, bind::closure(ctx, name, 0,
                                                  [function](auto& c, const auto&, const auto*, auto) {
                                                      return bind::invoke(c, "history",
                                                                          [&] {
                                                                              return invoke(c, binding(c).manager, [&]
                                                                                            { return function(c); });
                                                                          });
                                                  }));
                  };
                  method("undo",
                         [](auto& c)
                         {
                             binding(c).manager.undo();
                             return jsi::Value::undefined();
                         });
                  method("redo",
                         [](auto& c)
                         {
                             binding(c).manager.redo();
                             return jsi::Value::undefined();
                         });
                  method("clear",
                         [](auto& c)
                         {
                             binding(c).manager.clear();
                             return jsi::Value::undefined();
                         });
                  method("canUndo", [](auto& c) { return jsi::Value(binding(c).manager.canUndo()); });
                  method("canRedo", [](auto& c) { return jsi::Value(binding(c).manager.canRedo()); });
                  method("undoLabel",
                         [](auto& c)
                         {
                             auto v = binding(c).manager.status().undoLabel;
                             return v ? bind::write(c, *v) : jsi::Value::null();
                         });
                  method("redoLabel",
                         [](auto& c)
                         {
                             auto v = binding(c).manager.status().redoLabel;
                             return v ? bind::write(c, *v) : jsi::Value::null();
                         });
                  method("snapshot", [](auto& c) { return snapshot(c); });
                  api.set("transaction",
                          bind::closure(
                              ctx, "transaction", 2,
                              [](auto& c, const auto&, const auto* args, auto count)
                              {
                                  return bind::invoke(
                                      c, "history.transaction",
                                      [&]
                                      {
                                          return invoke(
                                              c, binding(c).manager,
                                              [&]() -> jsi::Value
                                              {
                                                  if (count != 2 || ! args[0].isString()
                                                      || ! bind::isFunction(c, args[1]))
                                                      bind::throwTypeError(
                                                          c, "transaction expects a label and synchronous callback");
                                                  auto result = jsi::Value::undefined();
                                                  binding(c).manager.transaction(
                                                      args[0].getString(c.rt).utf8(c.rt),
                                                      [&]
                                                      {
                                                          result = args[1].getObject(c.rt).getFunction(c.rt).call(c.rt);
                                                          if (result.isObject()
                                                              && bind::isFunction(
                                                                  c, result.getObject(c.rt).getProperty(c.rt, "then")))
                                                              bind::throwTypeError(
                                                                  c, "StateHistory transactions must be synchronous");
                                                      });
                                                  return result;
                                              });
                                      });
                              }));
                  api.set("subscribe",
                          bind::closure(
                              ctx, "subscribe", 1,
                              [](auto& c, const auto&, const auto* args, auto count)
                              {
                                  return bind::invoke(
                                      c, "history.subscribe",
                                      [&]() -> jsi::Value
                                      {
                                          if (count != 1 || ! bind::isFunction(c, args[0]))
                                              bind::throwTypeError(c, "subscribe expects a function");
                                          auto& view = binding(c);
                                          const std::lock_guard subscriptionLock(view.manager.mutex());
                                          auto& entry = view.listeners.emplace_back(true, ++view.nextListener);
                                          bind::retainValue(c, &entry, jsi::Value(c.rt, args[0]));
                                          return bind::closure(
                                              c, "unsubscribe", 0,
                                              [&entry](auto& inner, const auto&, const auto*, auto)
                                              {
                                                  const std::lock_guard removalLock(binding(inner).manager.mutex());
                                                  entry.active = false;
                                                  bind::retainValue(inner, &entry, jsi::Value::undefined());
                                                  return jsi::Value::undefined();
                                              });
                                      });
                              }));
                  auto value = api.release();
                  ctx.rt.global()
                      .getPropertyAsObject(ctx.rt, "Object")
                      .getPropertyAsFunction(ctx.rt, "freeze")
                      .call(ctx.rt, value);
                  bind::setProperty(ctx, exports, "history", std::move(value));
              },
              {},
              {} });
    }
    void dispatch(js::Context& context)
    {
        auto& ctx = js::stateOf(context);
        auto* view = bind::contextData<Binding>(ctx, &bindingKey);
        if (! view || ctx.halted())
            return;
        std::list<Event> events;
        {
            const std::lock_guard lock(view->manager.mutex());
            events.splice(events.end(), view->pending);
        }
        for (const auto& event : events)
        {
            auto value = statusValue(ctx, event.status);
            for (auto& listener : view->listeners)
            {
                if (listener.id > event.lastListener)
                    break;
                if (! listener.active)
                    continue;
                const auto* callback = bind::retainedValue(ctx, &listener);
                if (! callback)
                    continue;
                auto function = callback->getObject(ctx.rt).getFunction(ctx.rt);
                const jsi::Value args[] = { jsi::Value(ctx.rt, value) };
                bind::call(ctx, function, jsi::Value::undefined(), args, "StateHistory subscriber failed");
            }
        }
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::history
