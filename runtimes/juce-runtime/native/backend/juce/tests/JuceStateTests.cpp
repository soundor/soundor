#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "generated/state/soundor/SoundorProcessor.h"

#include <soundor/backend/JuceParameterHost.h>
#include <soundor/history/Module.h>
#include <soundor/js/Context.h>
#include <soundor/js/Events.h>
#include <soundor/js/Runtime.h>
#include <soundor/js/Streams.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>

#include <atomic>
#include <cstring>
#include <span>
#include <thread>

namespace
{
    using namespace soundor;
    struct Processor final : AudioProcessor
    {
        using AudioProcessor::bypassParameter;
        using AudioProcessor::gainParameter;
        using AudioProcessor::history;
        using AudioProcessor::nativeEvents;
        using AudioProcessor::nativeStreams;
        using AudioProcessor::state;
        int restored = 0;
        std::vector<std::string> observations;
        const juce::String getName() const override { return "State Test"; }
        juce::AudioProcessorEditor* createEditor() override { return nullptr; }
        bool hasEditor() const override { return false; }
        bool acceptsMidi() const override { return false; }
        bool producesMidi() const override { return false; }
        void stateRestored() override
        {
            CHECK(juce::MessageManager::getInstance()->isThisTheMessageThread());
            ++restored;
            observations.push_back(state.selectedPreset.get().value_or("null"));
            CHECK(getParameters().getRawParameterValue("gain")->load() == 0.75f);
        }
    };
    void restore(Processor& p, const juce::MemoryBlock& bytes)
    {
        p.setStateInformation(bytes.getData(), static_cast<int>(bytes.getSize()));
    }
} // namespace
TEST_CASE("persistent processor state survives editor absence and processor reconstruction")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor original;
    CHECK(original.restored == 0);
    CHECK(! original.state.selectedPreset.get().has_value());
    auto bands = original.state.groups.get();
    CHECK(bands[0].index == UINT64_MAX);
    bands[0].bands[0].gain = 7;
    original.state.groups.set(bands);
    bands[0].bands[0].gain = 10;
    CHECK(original.state.groups.get()[0].bands[0].gain == 7);
    original.state.selectedPreset.set(std::string("Warm"));
    original.getParameters().getParameter("gain")->setValueNotifyingHost(0.75f);
    juce::MemoryBlock saved;
    original.getStateInformation(saved);
    CHECK(original.restored == 0);
    Processor copied;
    restore(copied, saved);
    CHECK(copied.restored == 1);
    CHECK(copied.state.selectedPreset.get() == "Warm");
    CHECK(copied.state.groups.get()[0].bands[0].gain == 7);
    copied.state.selectedPreset.set(std::nullopt);
    CHECK(original.state.selectedPreset.get() == "Warm");
    CHECK(copied.restored == 1);
    auto bad = juce::JSON::fromString(
        juce::String::fromUTF8(static_cast<const char*>(saved.getData()), static_cast<int>(saved.getSize())));
    bad.getDynamicObject()->setProperty("version", 99);
    const auto text = juce::JSON::toString(bad);
    copied.setStateInformation(text.toRawUTF8(), static_cast<int>(text.getNumBytesAsUTF8()));
    CHECK(copied.restored == 1);
    CHECK(! copied.state.selectedPreset.get());
    bad.getDynamicObject()->setProperty("version", 1);
    bad["state"].getDynamicObject()->setProperty("groups", "corrupt");
    const auto corrupt = juce::JSON::toString(bad);
    copied.setStateInformation(corrupt.toRawUTF8(), static_cast<int>(corrupt.getNumBytesAsUTF8()));
    CHECK(copied.restored == 1);
    CHECK(! copied.state.selectedPreset.get());
}
TEST_CASE("legacy APVTS restoration is retained and initializes state defaults")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor original;
    original.getParameters().getParameter("gain")->setValueNotifyingHost(0.75f);
    auto xml = original.getParameters().copyState().createXml();
    juce::MemoryBlock bytes;
    juce::AudioProcessor::copyXmlToBinary(*xml, bytes);
    Processor target;
    target.state.selectedPreset.set(std::string("Old"));
    restore(target, bytes);
    CHECK(target.restored == 1);
    CHECK(! target.state.selectedPreset.get());
}
TEST_CASE("off-thread restorations queue each complete operation for the message thread")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor original;
    original.getParameters().getParameter("gain")->setValueNotifyingHost(0.75f);
    original.state.selectedPreset.set(std::string("One"));
    juce::MemoryBlock one, two;
    original.getStateInformation(one);
    original.state.selectedPreset.set(std::string("Two"));
    original.getStateInformation(two);
    Processor target;
    std::thread worker(
        [&]
        {
            restore(target, one);
            restore(target, two);
        });
    worker.join();
    CHECK(target.restored == 0);
    juce::MessageManager::getInstance()->runDispatchLoopUntil(50);
    CHECK(target.observations == std::vector<std::string> { "One", "Two" });
}
TEST_CASE("state bridge subscriptions and immutable cached reads")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    js::Runtime runtime;
    js::Context context(runtime);
    persistent::install(context, processor.state);
    const auto run = [&](const char* text)
    {
        const auto result = context.evaluateScript(text);
        REQUIRE(result.ok());
    };
    REQUIRE(context
                .evaluateModule("(function(exports, require) { globalThis.state = require('soundor:state').state; })",
                                "/test.js")
                .ok());
    run("globalThis.events = []; globalThis.off = state.selectedPreset.subscribe(v => events.push(v)); "
        "state.onRestored(() => events.push('restored')); if(state.groups.get() !== state.groups.get()) throw "
        "Error('unstable'); if(!Object.isFrozen(state.groups.get()[0].bands)) throw Error('mutable'); "
        "state.selectedPreset.set('JS');");
    persistent::dispatch(context);
    run("if (events.join(',') !== 'JS') throw Error('missing JS change'); off();");
    processor.state.selectedPreset.set(std::string("Native"));
    persistent::dispatch(context);
    run("if(events.length !== 1 || state.selectedPreset.get() !== 'Native') throw Error('unsubscribe/read failed');");
}

TEST_CASE("shared logical snapshot corpus preserves precision and rejects incompatible data")
{
    juce::ScopedJuceInitialiser_GUI init;
    const auto corpus = backend::parseStateJson(juce::File(SOUNDOR_STATE_CORPUS).loadFileAsString().toStdString());
    REQUIRE(corpus.isArray());
    for (const auto& item : *corpus.getArray())
    {
        Processor processor;
        const auto text = backend::stateJson(item["snapshot"]);
        processor.setStateInformation(text.data(), static_cast<int>(text.size()));
        const bool valid = static_cast<bool>(item["valid"]);
        CHECK(processor.restored == (valid ? 1 : 0));
        if (! valid)
            continue;
        CHECK(processor.state.signedValue.get() == INT64_MIN);
        CHECK(processor.state.unsignedValue.get() == UINT64_MAX);
        if (item["snapshot"]["state"].hasProperty("precise"))
            CHECK(processor.state.precise.get() == static_cast<double>(item["snapshot"]["state"]["precise"]));
        juce::MemoryBlock saved;
        processor.getStateInformation(saved);
        Processor reopened;
        restore(reopened, saved);
        CHECK(reopened.state.precise.get() == processor.state.precise.get());
    }
}
TEST_CASE("native state subscribers see complete replacements and unsubscribe")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    int changes = 0;
    auto off = processor.state.enabled.subscribe(
        [&](bool value)
        {
            ++changes;
            CHECK(! value);
            CHECK(processor.state.selectedPreset.get() == "Complete");
        });
    auto data = processor.state.snapshot();
    data.getDynamicObject()->setProperty("selectedPreset", "Complete");
    data.getDynamicObject()->setProperty("enabled", false);
    processor.state.apply(PersistentState::prepare(data));
    CHECK(changes == 1);
    off();
    processor.state.enabled.set(true);
    CHECK(changes == 1);
}

TEST_CASE("persistent doubles retain every bit across native reads and saving")
{
    juce::ScopedJuceInitialiser_GUI init;
    for (const double value : { std::nextafter(1.0, 2.0), 0.000012345678901234567,
                                std::numeric_limits<double>::denorm_min(), std::numeric_limits<double>::max() })
    {
        Processor processor;
        processor.getParameters().getParameter("gain")->setValueNotifyingHost(0.75f);
        processor.state.precise.set(value);
        CHECK(processor.state.precise.get() == value);
        juce::MemoryBlock saved;
        processor.getStateInformation(saved);
        Processor copy;
        restore(copy, saved);
        CHECK(copy.state.precise.get() == value);
    }
}
TEST_CASE("pending restoration is cancelled safely when the processor is destroyed")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor source;
    source.getParameters().getParameter("gain")->setValueNotifyingHost(0.75f);
    juce::MemoryBlock saved;
    source.getStateInformation(saved);
    {
        auto target = std::make_unique<Processor>();
        std::thread worker([&] { restore(*target, saved); });
        worker.join();
        CHECK(target->restored == 0);
    }
    juce::MessageManager::getInstance()->runDispatchLoopUntil(10);
}

TEST_CASE("frontend field notifications precede restoration callbacks")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    processor.getParameters().getParameter("gain")->setValueNotifyingHost(0.75f);
    processor.state.selectedPreset.set(std::string("Saved"));
    juce::MemoryBlock saved;
    processor.getStateInformation(saved);
    processor.state.selectedPreset.set(std::nullopt);
    js::Runtime runtime;
    js::Context context(runtime);
    persistent::install(context, processor.state);
    REQUIRE(context
                .evaluateModule("(function(exports, require) { globalThis.state = require('soundor:state').state; })",
                                "/state.js")
                .ok());
    REQUIRE(
        context
            .evaluateScript(
                "globalThis.events = []; state.selectedPreset.subscribe(v => events.push(v)); state.onRestored(() => { "
                "if(state.selectedPreset.get() !== 'Saved') throw Error('old state'); events.push('restored'); });")
            .ok());
    REQUIRE(context.evaluateScript("state.selectedPreset.beginGesture(); state.groups.beginGesture();").ok());
    CHECK(processor.state.storage().gestureDepth("selectedPreset") == 1);
    restore(processor, saved);
    CHECK(processor.state.storage().gestureDepth("selectedPreset") == 0);
    CHECK(processor.state.storage().gestureDepth("groups") == 0);
    persistent::dispatch(context);
    CHECK(context.evaluateScript("events.join(',')").value().asString() == "Saved,restored");
}

TEST_CASE("state gestures share processor storage and clean up only their UI session")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    auto& store = processor.state.storage();
    processor.state.enabled.endGesture();
    processor.state.enabled.beginGesture();
    processor.state.enabled.beginGesture();
    CHECK(store.gestureDepth("enabled") == 2);
    processor.state.enabled.endGesture();
    {
        js::Runtime runtime;
        js::Context context(runtime);
        persistent::install(context, processor.state);
        REQUIRE(
            context
                .evaluateModule("(function(exports, require) { globalThis.state = require('soundor:state').state; })",
                                "/state.js")
                .ok());
        REQUIRE(context
                    .evaluateScript(
                        "state.enabled.beginGesture(); state.enabled.beginGesture();"
                        "state.groups.beginGesture(); state.selectedPreset.beginGesture();"
                        "state.precise.beginGesture(); state.precise.endGesture(); state.precise.endGesture();"
                        "state.enabled.set(v => !v); state.selectedPreset.set('Warm'); state.enabled.endGesture();")
                    .ok());
        CHECK(store.gestureDepth("enabled") == 2);
        CHECK(store.gestureDepth("groups") == 1);
        CHECK(store.gestureDepth("selectedPreset") == 1);
        CHECK(store.gestureDepth("precise") == 0);
        CHECK(! processor.state.enabled.get());
    }
    CHECK(store.gestureDepth("enabled") == 1); // Native owner survives UI teardown.
    CHECK(store.gestureDepth("groups") == 0);
    CHECK(store.gestureDepth("selectedPreset") == 0);
    CHECK(processor.state.selectedPreset.get() == "Warm");
    processor.state.enabled.endGesture();
    processor.state.enabled.endGesture();
    CHECK(store.gestureDepth("enabled") == 0);
}

TEST_CASE("restoration invalidates gestures without serializing them or touching automation")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    struct AutomationListener final : juce::AudioProcessorParameter::Listener
    {
        int gestures = 0;
        void parameterValueChanged(int, float) override {}
        void parameterGestureChanged(int, bool) override { ++gestures; }
    } listener;
    auto* gain = processor.getParameters().getParameter("gain");
    gain->addListener(&listener);
    processor.state.enabled.beginGesture();
    auto& store = processor.state.storage();
    const auto oldSession = store.connect();
    store.beginGesture("enabled", oldSession);
    juce::MemoryBlock withGesture, withoutGesture;
    processor.getStateInformation(withGesture);
    processor.state.enabled.endGesture();
    store.endGesture("enabled", oldSession);
    processor.getStateInformation(withoutGesture);
    CHECK(withGesture == withoutGesture);
    store.beginGesture("enabled", oldSession);
    processor.state.apply(PersistentState::prepare(processor.state.snapshot()));
    CHECK(store.gestureDepth("enabled") == 0);
    const auto newSession = store.connect();
    store.beginGesture("enabled", newSession);
    store.disconnect(oldSession);
    CHECK(store.gestureDepth("enabled") == 1);
    store.disconnect(newSession);
    CHECK(store.gestureDepth("enabled") == 0);
    CHECK(listener.gestures == 0);
    gain->removeListener(&listener);
    // Destruction with native gestures open owns no JS values or callbacks.
    processor.state.enabled.beginGesture();
}

TEST_CASE("state bridge resolves synchronous updaters once and persists immutable replacements")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    js::Runtime runtime;
    js::Context context(runtime);
    persistent::install(context, processor.state);
    REQUIRE(context
                .evaluateModule("(function(exports, require) { globalThis.state = require('soundor:state').state; })",
                                "/updater.js")
                .ok());
    const auto result = context.evaluateScript(R"(
      let calls = 0;
      state.precise.set(v => { calls++; return v + 1; });
      state.precise.set(v => v + 1);
      if (calls !== 1 || state.precise.get() < 2) throw Error('stale updater');
      state.selectedPreset.set(v => v ?? 'Default');
      state.selectedPreset.set(v => v + '!');
      state.enabled.set(v => !v);
      const before = state.groups.get();
      state.groups.set(groups => groups.map(group => ({...group, bands: group.bands.map(band => ({...band, gain: band.gain + 1}))})));
      if (before[0].bands[0].gain !== -3.125 || state.groups.get()[0].bands[0].gain !== -2.125) throw Error('mutable');
      for (const updater of [() => { throw Error('failed'); }, async function() { return 'Async'; }, () => ({then() {}}), () => 42]) {
        let failed = false;
        try { state.selectedPreset.set(updater); } catch { failed = true; }
        if (!failed || state.selectedPreset.get() !== 'Default!') throw Error('invalid updater committed');
      }
    )");
    REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
    CHECK(processor.state.selectedPreset.get() == "Default!");
    CHECK(processor.state.storage().gestureDepth("groups") == 0);
    CHECK(processor.state.storage().gestureDepth("precise") == 0);
    CHECK(! processor.state.enabled.get());
    processor.getParameters().getParameter("gain")->setValueNotifyingHost(0.75f);
    juce::MemoryBlock saved;
    processor.getStateInformation(saved);
    Processor copy;
    restore(copy, saved);
    CHECK(copy.state.selectedPreset.get() == "Default!");
    CHECK(copy.state.groups.get()[0].bands[0].gain == -2.125);
}

TEST_CASE("processor History buffers native parameter and state transactions with the editor closed")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    const auto initial = p.gainParameter.load();
    bool observed = false;
    auto off = p.state.selectedPreset.subscribe(
        [&](auto value)
        {
            CHECK(value == "Preset");
            CHECK(p.gainParameter.load() == 0.75f);
            observed = true;
        });
    p.history.transaction("Load Preset",
                          [&]
                          {
                              p.gainParameter.set(0.75f);
                              p.state.selectedPreset.set(std::string("Preset"));
                              CHECK(p.gainParameter.get() == 0.75f);
                              CHECK(p.gainParameter.load() == initial);
                              CHECK(! observed);
                          });
    CHECK(observed);
    off();
    CHECK(p.history.status().undoLabel == "Load Preset");
    p.history.undo();
    CHECK(p.gainParameter.load() == initial);
    CHECK(! p.state.selectedPreset.get());
    p.history.redo();
    CHECK(p.gainParameter.load() == 0.75f);
    CHECK(p.state.selectedPreset.get() == "Preset");
    CHECK_THROWS(p.history.transaction("Failed",
                                       [&]
                                       {
                                           p.gainParameter.set(0.5f);
                                           p.state.selectedPreset.set(std::string("Bad"));
                                           throw std::runtime_error("fail");
                                       }));
    CHECK(p.gainParameter.load() == 0.75f);
    CHECK(p.state.selectedPreset.get() == "Preset");
    Processor other;
    CHECK(! other.history.canUndo());
}
TEST_CASE("processor History gestures and poisoned nested transactions preserve ownership")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    p.bypassParameter.beginGesture(history::Options(std::string("Toggle")));
    p.bypassParameter.beginGesture(history::Options(std::string("Ignored")));
    p.bypassParameter.set(true, history::Options(true));
    CHECK_THROWS(p.history.transaction("Conflict", [&] { p.bypassParameter.set(false); }));
    p.history.transaction("Other field", [&] { p.state.selectedPreset.set(std::string("OK")); });
    p.bypassParameter.endGesture();
    p.bypassParameter.endGesture();
    CHECK(p.history.status().undoLabel == "Toggle");
    p.history.undo();
    CHECK(! p.bypassParameter.load());
    CHECK_THROWS_AS(p.history.transaction("Outer",
                                          [&]
                                          {
                                              try
                                              {
                                                  p.history.transaction("Inner",
                                                                        [&]
                                                                        {
                                                                            p.bypassParameter.set(true);
                                                                            throw std::runtime_error("bad");
                                                                        });
                                              }
                                              catch (...)
                                              {
                                              }
                                              p.state.selectedPreset.set(std::string("discard"));
                                          }),
                    history::TransactionAbortedError);
    CHECK(! p.bypassParameter.load());
    CHECK(p.state.selectedPreset.get() == "OK");
}
TEST_CASE("JavaScript and native code share processor History across editor recreation")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    const auto initial = p.gainParameter.load();
    {
        js::Runtime runtime;
        js::Context context(runtime);
        history::install(context, p.history);
        persistent::install(context, p.state);
        parameters::install(context,
                            std::make_shared<backend::JuceParameterHost>(p.getParameters(), p.parameterInfos()));
        REQUIRE(context
                    .evaluateModule("(function(exports, require) { globalThis.h = require('soundor:history').history; "
                                    "globalThis.s = require('soundor:state').state; globalThis.p = "
                                    "require('soundor:parameters').parameters; })",
                                    "/history.js")
                    .ok());
        const auto run = [&](const char* text)
        {
            const auto result = context.evaluateScript(text);
            REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
        };
        run("globalThis.historyEvents = []; globalThis.historyOff = h.subscribe(s => historyEvents.push(s.undoLabel)); "
            "if(h.snapshot() !== h.snapshot() || !Object.isFrozen(h.snapshot())) throw Error('unstable history "
            "snapshot');");
        run("h.transaction('JS Preset', () => { p.gain.set(v => v + 0.1); p.gain.set(v => v + 0.1); "
            "s.selectedPreset.set('JS'); if(s.selectedPreset.get() !== 'JS') throw Error('staging'); });");
        CHECK(p.state.selectedPreset.get() == "JS");
        CHECK(p.history.status().undoLabel == "JS Preset");
        run("let before = p.gain.get(); try { h.transaction('Bad', () => { p.gain.set(0.9); try { "
            "s.selectedPreset.set(3); } catch(e) {} }); throw Error('not poisoned'); } catch(e) { if(e.name !== "
            "'TransactionAbortedError' || !e.cause) throw e; } if(p.gain.get() !== before) throw Error('partial');");
        run("try { h.transaction('Async', async function() { s.selectedPreset.set('Bad'); }); throw Error('accepted "
            "async'); } catch(e) { if(e.message === 'accepted async') throw e; } if(s.selectedPreset.get() !== 'JS') "
            "throw Error('async committed');");
        run("p.bypass.beginGesture({history:{label:'Drag'}}); p.bypass.set(v=>!v); p.bypass.endGesture(); "
            "if(h.undoLabel() !== 'Drag') throw Error('label'); h.undo();");
        history::dispatch(context);
        run("if(historyEvents.join(',') !== 'JS Preset,Drag,JS Preset') throw Error('missing History statuses: ' + "
            "historyEvents.join(',')); historyOff();");
    }
    // Closing the context does not clear committed processor History.
    CHECK(p.history.canUndo());
    p.history.undo();
    CHECK(p.gainParameter.load() == initial);
    CHECK(! p.state.selectedPreset.get());
    p.history.redo();
    CHECK(p.state.selectedPreset.get() == "JS");
}
TEST_CASE("host automation alone creates no History; gesture records observed final effective value")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    p.gainParameter.juceParameter().setValueNotifyingHost(0.2f);
    CHECK(! p.history.canUndo());
    p.gainParameter.beginGesture(history::Options(true));
    p.gainParameter.juceParameter().setValueNotifyingHost(0.3f);
    p.gainParameter.endGesture();
    CHECK(! p.history.canUndo());
    p.gainParameter.beginGesture(history::Options(true));
    p.gainParameter.set(0.5f);
    p.gainParameter.juceParameter().setValueNotifyingHost(0.75f);
    p.gainParameter.endGesture();
    CHECK(p.history.canUndo());
    p.history.undo();
    CHECK(p.gainParameter.load() == doctest::Approx(0.3));
    p.history.redo();
    CHECK(p.gainParameter.load() == 0.75f);
    juce::MemoryBlock saved;
    p.getStateInformation(saved);
    restore(p, saved);
    CHECK(! p.history.canUndo());
    CHECK(! p.history.canRedo());
}

TEST_CASE("shared History conformance corpus matches Web and simulated runtimes")
{
    juce::ScopedJuceInitialiser_GUI init;
    const auto file = juce::File(SOUNDOR_STATE_CORPUS).getSiblingFile("history-cases.json");
    const auto corpus = backend::parseStateJson(file.loadFileAsString().toStdString());
    REQUIRE(corpus.isArray());
    for (const auto& scenario : *corpus.getArray())
    {
        INFO(scenario["name"].toString().toStdString());
        Processor p;
        std::function<void(const juce::var&)> execute = [&](const juce::var& steps)
        {
            REQUIRE(steps.isArray());
            for (const auto& step : *steps.getArray())
            {
                const auto op = step["op"].toString();
                const bool parameter = step["field"].toString() == "bypass";
                history::Options options;
                if (step["history"].isBool())
                    options = history::Options(static_cast<bool>(step["history"]));
                else if (step["history"].isObject())
                    options = history::Options(step["history"]["label"].toString().toStdString());
                if (op == "set")
                {
                    if (parameter)
                        p.bypassParameter.set(static_cast<bool>(step["value"]), options);
                    else
                        p.state.selectedPreset.set(step["value"].isVoid()
                                                       ? std::nullopt
                                                       : std::optional(step["value"].toString().toStdString()),
                                                   options);
                }
                else if (op == "begin")
                {
                    if (parameter)
                        p.bypassParameter.beginGesture(options);
                    else
                        p.state.selectedPreset.beginGesture(options);
                }
                else if (op == "end")
                {
                    if (parameter)
                        p.bypassParameter.endGesture();
                    else
                        p.state.selectedPreset.endGesture();
                }
                else if (op == "host")
                    p.bypassParameter.juceParameter().setValueNotifyingHost(static_cast<bool>(step["value"]) ? 1.0f
                                                                                                             : 0.0f);
                else if (op == "undo")
                    p.history.undo();
                else if (op == "redo")
                    p.history.redo();
                else if (op == "transaction")
                    p.history.transaction(step["label"].toString().toStdString(), [&] { execute(step["steps"]); });
                else
                    FAIL("unknown History operation");
            }
        };
        execute(scenario["steps"]);
        CHECK(p.bypassParameter.load() == static_cast<bool>(scenario["bypass"]));
        const auto optional = [](const juce::var& v) -> std::optional<std::string>
        { return v.isVoid() ? std::nullopt : std::optional(v.toString().toStdString()); };
        CHECK(p.state.selectedPreset.get() == optional(scenario["selected"]));
        CHECK(p.history.status().undoLabel == optional(scenario["undo"]));
        CHECK(p.history.status().redoLabel == optional(scenario["redo"]));
    }
}

TEST_CASE("History edits and replay preserve JUCE one-shot and explicit host gesture order")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    struct Listener final : juce::AudioProcessorParameter::Listener
    {
        std::vector<std::string> events;
        void parameterValueChanged(int, float) override { events.emplace_back("value"); }
        void parameterGestureChanged(int, bool begin) override { events.emplace_back(begin ? "begin" : "end"); }
    } listener;
    auto& parameter = p.bypassParameter.juceParameter();
    parameter.addListener(&listener);
    p.bypassParameter.set(true, history::Options(true));
    CHECK(listener.events == std::vector<std::string> { "begin", "value", "end" });
    listener.events.clear();
    p.history.undo();
    CHECK(listener.events == std::vector<std::string> { "begin", "value", "end" });
    listener.events.clear();
    p.bypassParameter.beginGesture(history::Options(true));
    p.bypassParameter.beginGesture();
    p.bypassParameter.set(true);
    p.bypassParameter.set(false);
    p.bypassParameter.set(true);
    p.bypassParameter.endGesture();
    p.bypassParameter.endGesture();
    CHECK(listener.events == std::vector<std::string> { "begin", "value", "value", "value", "end" });
    listener.events.clear();
    p.bypassParameter.set(true, history::Options(true));
    CHECK(listener.events.empty());
    parameter.removeListener(&listener);
}

TEST_CASE("editor cleanup releases only its gesture contribution and never records unfinished edits")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    p.bypassParameter.beginGesture(history::Options(std::string("Native Drag")));
    {
        backend::JuceParameterHost editor(p.getParameters(), p.parameterInfos());
        CHECK_THROWS(editor.beginEdit(1, history::Options(true)));
        editor.beginEdit(1, {});
        editor.edit(1, 1, {});
    }
    CHECK(! p.history.canUndo());
    p.bypassParameter.endGesture();
    CHECK(p.history.status().undoLabel == "Native Drag");
    p.history.clear();
    {
        backend::JuceParameterHost editor(p.getParameters(), p.parameterInfos());
        editor.beginEdit(1, history::Options(true));
        editor.edit(1, 0, {});
    }
    CHECK(! p.history.canUndo());
    p.bypassParameter.set(true, history::Options(true));
    CHECK(p.history.canUndo());
}

TEST_CASE("background project snapshots wait for complete transactional publication")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    std::atomic<bool> requested { false }, completed { false };
    std::thread reader;
    juce::MemoryBlock saved;
    p.history.transaction("Atomic Preset",
                          [&]
                          {
                              p.gainParameter.set(0.75f);
                              p.state.selectedPreset.set(std::string("Atomic"));
                              reader = std::thread(
                                  [&]
                                  {
                                      requested.store(true, std::memory_order_release);
                                      p.getStateInformation(saved);
                                      completed.store(true, std::memory_order_release);
                                  });
                              while (! requested.load(std::memory_order_acquire))
                                  std::this_thread::yield();
                              CHECK(! completed.load(std::memory_order_acquire));
                          });
    reader.join();
    CHECK(completed.load(std::memory_order_acquire));
    Processor restored;
    restore(restored, saved);
    CHECK(restored.state.selectedPreset.get() == "Atomic");
    CHECK(restored.gainParameter.load() == 0.75f);
}

TEST_CASE("native control-thread History events are queued safely for JavaScript UI dispatch")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    js::Runtime runtime;
    js::Context context(runtime);
    history::install(context, p.history);
    REQUIRE(context
                .evaluateModule("(function(exports, require) { globalThis.historyEvents = 0; "
                                "require('soundor:history').history.subscribe(() => ++historyEvents); })",
                                "/history-events.js")
                .ok());
    std::atomic<bool> finished { false };
    std::thread writer(
        [&]
        {
            for (int n = 0; n < 100; ++n)
                p.state.selectedPreset.set(std::to_string(n), history::Options(true));
            finished.store(true, std::memory_order_release);
        });
    while (! finished.load(std::memory_order_acquire))
    {
        history::dispatch(context);
        std::this_thread::yield();
    }
    writer.join();
    history::dispatch(context);
    const auto result = context.evaluateScript(
        "if(historyEvents !== 100) throw Error('missing native History events: ' + historyEvents);");
    REQUIRE(result.ok());
}

TEST_CASE("the processor's native events reach an editor runtime from another thread")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    js::Runtime runtime;
    js::Context context(runtime);
    native::install(context, nullptr, processor.nativeEvents, processor.nativeStreams);
    REQUIRE(context
                .evaluateModule("(function (exports, require) { const { events } = require('soundor:native');"
                                "globalThis.seen = [];"
                                "events.bandChanged.subscribe((e) => seen.push(e.index + ':' + e.band.frequency)); })",
                                "/ui.js")
                .ok());
    std::thread worker(
        [&processor]
        {
            processor.nativeEvents.bandChanged(
                { .band = { .frequency = 440, .gain = 0, .label = std::nullopt }, .index = 2 });
        });
    worker.join();
    CHECK(js::deliverEvents(context) == 1);
    CHECK(context.evaluateScript("seen.join()").value().asString() == "2:440");
}

TEST_CASE("the processor's native streams carry the audio thread's latest value to the UI")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    js::Runtime runtime;
    js::Context context(runtime);
    native::install(context, nullptr, processor.nativeEvents, processor.nativeStreams);
    REQUIRE(context
                .evaluateModule("(function (exports, require) { const { streams } = require('soundor:native');"
                                "globalThis.seen = [];"
                                "streams.meter.subscribe((v, s) => seen.push(s + ':' + Array.from(v).join('/'))); })",
                                "/ui.js")
                .ok());
    // As the audio processing would, on another thread: in place, without allocating.
    std::thread audio(
        [&processor]
        {
            for (int block = 1; block <= 3; ++block)
            {
                const std::span<float> levels = processor.nativeStreams.meter.buffer();
                levels[0] = static_cast<float>(block);
                levels[1] = 0.5F;
                processor.nativeStreams.meter.commit(2);
            }
        });
    audio.join();
    CHECK(js::deliverStreams(context) == 1);
    CHECK(context.evaluateScript("seen.join()").value().asString() == "3:3/0.5");
}

TEST_CASE("RuntimeHost::tick delivers state and History notifications through dispatchModules")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    RuntimeHost::Options options;
    options.installModules = [&processor](js::Context& context)
    {
        history::install(context, processor.history);
        persistent::install(context, processor.state);
    };
    options.dispatchModules = [](js::Context& context)
    {
        history::dispatch(context);
        persistent::dispatch(context);
    };
    RuntimeHost host(std::move(options));
    REQUIRE(host.context()
                .evaluateModule("(function(exports, require) { const { state } = require('soundor:state');"
                                "const { history } = require('soundor:history');"
                                "globalThis.state = state; globalThis.seen = [];"
                                "state.selectedPreset.subscribe((v) => seen.push('preset ' + v));"
                                "history.subscribe((s) => seen.push('undo ' + s.canUndo)); })",
                                "/ui.js")
                .ok());
    processor.state.selectedPreset.set(std::string("Warm"), history::Options(true));
    // A field nobody subscribed to: delivered to nobody, read as it is.
    processor.state.enabled.set(false);
    CHECK(host.context().evaluateScript("seen.join()").value().asString().empty());
    host.tick();
    CHECK(host.context().evaluateScript("seen.join()").value().asString() == "undo true,preset Warm");
    CHECK(host.context().evaluateScript("String(state.enabled.get())").value().asString() == "false");
    CHECK(host.statistics().tick.modules > 0);
}

TEST_CASE("declarative audio negotiates complete bus layouts and reports metadata")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    CHECK(processor.getMainBusNumInputChannels() == 2);
    CHECK(processor.getMainBusNumOutputChannels() == 2);
    CHECK(processor.getBusCount(true) == 2);
    CHECK(! processor.getBus(true, 1)->isEnabled());
    auto layout = processor.getBusesLayout();
    CHECK(processor.isBusesLayoutSupported(layout));
    layout.inputBuses.set(0, juce::AudioChannelSet::mono());
    CHECK(! processor.isBusesLayoutSupported(layout));
    layout.outputBuses.set(0, juce::AudioChannelSet::mono());
    CHECK(processor.isBusesLayoutSupported(layout));
    layout.inputBuses.set(1, juce::AudioChannelSet::stereo());
    CHECK(! processor.isBusesLayoutSupported(layout));
    layout.inputBuses.set(1, juce::AudioChannelSet::mono());
    CHECK(processor.isBusesLayoutSupported(layout));
    CHECK(processor.getLatencySamples() == 128);
    processor.setTailLengthSeconds(2.5);
    CHECK(processor.getTailLengthSeconds() == 2.5);
    CHECK_THROWS(processor.setTailLengthSeconds(-1));
    CHECK(processor.getBypassParameter() == processor.getParameters().getParameter("bypass"));
    CHECK(processor.getParameterTree().getSubgroups(false)[0]->getName() == "Output");
}

TEST_CASE("factory preset catalog shares native host programs and opt-in History")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    REQUIRE(processor.presets().factoryPresets().size() == 2);
    CHECK(processor.getNumPrograms() == 2);
    CHECK(processor.getProgramName(1) == "Warm");
    CHECK(processor.presets().snapshot().factoryId == "init");
    processor.presets().loadFactory("warm", history::Options(true));
    CHECK(processor.gainParameter.get() == 0.75f);
    CHECK(processor.state.selectedPreset.get() == "Warm");
    CHECK(processor.getCurrentProgram() == 1);
    CHECK(processor.history.status().undoLabel == "Load Warm");
    processor.history.undo();
    CHECK(processor.gainParameter.get() == 0.5f);
    CHECK(processor.presets().snapshot().factoryId == "init");
    CHECK(processor.getCurrentProgram() == 0);
    processor.history.redo();
    CHECK(processor.presets().snapshot().factoryId == "warm");
    processor.gainParameter.set(0.6f);
    CHECK(processor.presets().snapshot().modified);
    processor.history.clear();
    processor.setCurrentProgram(0);
    CHECK(processor.gainParameter.get() == 0.5f);
    CHECK(! processor.history.canUndo());
    CHECK_THROWS_AS(processor.presets().loadFactory("missing"), std::invalid_argument);
    processor.history.transaction("Preset and adjustment",
                                  [&]
                                  {
                                      processor.presets().loadFactory("warm");
                                      processor.gainParameter.set(0.8f);
                                  });
    CHECK(processor.history.status().undoLabel == "Preset and adjustment");
    processor.history.undo();
    CHECK(processor.gainParameter.get() == 0.5f);
    CHECK(processor.presets().snapshot().factoryId == "init");
}

TEST_CASE("factory preset JavaScript API shares C++ values, History, and immutable snapshots")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    js::Runtime runtime;
    js::Context context(runtime);
    factory::install(context, processor.presets());
    history::install(context, processor.history);
    parameters::install(
        context, std::make_shared<backend::JuceParameterHost>(processor.getParameters(), processor.parameterInfos()));
    REQUIRE(
        context
            .evaluateModule("(function(exports, require) { globalThis.presets = require('soundor:presets').presets; "
                            "globalThis.h = require('soundor:history').history; "
                            "globalThis.p = require('soundor:parameters').parameters; })",
                            "/presets.js")
            .ok());
    const auto run = [&](const char* script)
    {
        const auto result = context.evaluateScript(script);
        REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
    };
    run("if (presets.factory.list().length !== 2 || !Object.isFrozen(presets.factory.list()[0])) throw "
        "Error('catalog');"
        "if (presets.getSnapshot() !== presets.getSnapshot() || !Object.isFrozen(presets.getSnapshot())) throw "
        "Error('snapshot');"
        "globalThis.events = 0; globalThis.off = presets.subscribe(() => events++);"
        "presets.factory.load('warm', { history: true });"
        "if (p.gain.get() !== 0.75 || presets.getSnapshot().modified) throw Error('load');");
    factory::dispatch(context);
    run("if (events !== 1) throw Error('notification'); h.undo();"
        "if (p.gain.get() !== 0.5 || presets.getSnapshot().factoryId !== 'init') throw Error('undo');"
        "h.redo(); p.gain.set(0.2); if (!presets.getSnapshot().modified) throw Error('modified'); off();");
    CHECK(processor.state.selectedPreset.get() == "Warm");
}

TEST_CASE("host-saved factory and custom snapshots retain the existing wire format")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor processor;
    processor.presets().loadFactory("warm", history::Options(true));
    juce::MemoryBlock saved;
    processor.getStateInformation(saved);
    const auto document =
        backend::parseStateJson(std::string(static_cast<const char*>(saved.getData()), saved.getSize()));
    CHECK(document.getDynamicObject()->getProperties().size() == 3);
    processor.presets().loadFactory("init", history::Options(true));
    restore(processor, saved);
    CHECK(processor.presets().snapshot().factoryId == "warm");
    CHECK(! processor.presets().snapshot().modified);
    CHECK(! processor.history.canUndo());
    processor.state.selectedPreset.set(std::string("User preset"));
    processor.getStateInformation(saved);
    processor.presets().loadFactory("init");
    restore(processor, saved);
    CHECK(! processor.presets().snapshot().factoryId.has_value());
    CHECK(processor.state.selectedPreset.get() == "User preset");
}

namespace
{
    // The fixture's audio state (`audio: true`), as the Rust processing reads
    // it: describeAudioState()'s layout of enabled, gates, level, seed, steps.
    struct AudioView
    {
        bool enabled = false;
        std::vector<bool> gates;
        float level = 0;
        std::uint64_t seed = 0;
        std::vector<std::int32_t> steps;
    };
    template <typename T>
    T readAt(const std::byte* bytes, std::size_t offset)
    {
        T value {};
        std::memcpy(&value, bytes + offset, sizeof value);
        return value;
    }
    AudioView decodeAudio(const void* snapshot)
    {
        REQUIRE(snapshot != nullptr);
        const auto* bytes = static_cast<const std::byte*>(snapshot);
        AudioView view;
        view.enabled = readAt<std::uint8_t>(bytes, 0) != 0;
        for (std::uint32_t index = 0, length = readAt<std::uint32_t>(bytes, 4); index < length; ++index)
            view.gates.push_back(readAt<std::uint8_t>(bytes, 8 + index) != 0);
        view.level = readAt<float>(bytes, 12);
        view.seed = readAt<std::uint64_t>(bytes, 16);
        for (std::uint32_t index = 0, length = readAt<std::uint32_t>(bytes, 24); index < length; ++index)
            view.steps.push_back(readAt<std::int32_t>(bytes, 28 + 4 * std::size_t { index }));
        return view;
    }
    // What the audio thread's next block sees.
    AudioView audio(Processor& p)
    {
        return decodeAudio(p.state.audioState().acquire());
    }
} // namespace

TEST_CASE("the processing's state starts as the config's defaults and follows every set")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    CHECK(p.state.audioState().size() == 48);
    auto view = audio(p);
    CHECK(view.enabled);
    CHECK(view.gates == std::vector<bool> { true });
    CHECK(view.level == 0.5f);
    CHECK(view.seed == 3);
    CHECK(view.steps == std::vector<std::int32_t> { 1, 2, 3 });

    p.state.level.set(0.25f);
    p.state.seed.set(UINT64_MAX);
    p.state.enabled.set(false);
    view = audio(p);
    CHECK(view.level == 0.25f);
    CHECK(view.seed == UINT64_MAX);
    CHECK_FALSE(view.enabled);

    // Arrays of every length up to maxLength.
    for (const auto& steps :
         { std::vector<std::int32_t> {}, std::vector<std::int32_t> { 9 }, std::vector<std::int32_t> { 4, 3, 2, 1 } })
    {
        p.state.steps.set(steps);
        CHECK(audio(p).steps == steps);
    }
    p.state.gates.set({ false, true, true });
    CHECK(audio(p).gates == std::vector<bool> { false, true, true });

    // UI-only fields publish nothing.
    const auto published = p.state.audioState().statistics().published;
    p.state.selectedPreset.set(std::string("UI only"));
    CHECK(p.state.audioState().statistics().published == published);
}

TEST_CASE("an array beyond its maxLength is refused on every path, and the processing keeps the last value")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    p.state.steps.set({ 5, 6 });
    CHECK_THROWS(p.state.steps.set({ 1, 2, 3, 4, 5 }));
    CHECK_THROWS(p.state.gates.set({ true, true, true, true }));
    CHECK(p.state.steps.get() == std::vector<std::int32_t> { 5, 6 });
    CHECK(audio(p).steps == std::vector<std::int32_t> { 5, 6 });

    // A host's saved state with too many elements is refused whole.
    p.getParameters().getParameter("gain")->setValueNotifyingHost(0.75f);
    juce::MemoryBlock saved;
    p.getStateInformation(saved);
    auto data = juce::JSON::fromString(
        juce::String::fromUTF8(static_cast<const char*>(saved.getData()), static_cast<int>(saved.getSize())));
    juce::Array<juce::var> tooMany;
    for (int index = 0; index < 5; ++index)
        tooMany.add(index);
    data["state"].getDynamicObject()->setProperty("steps", tooMany);
    data["state"].getDynamicObject()->setProperty("level", 0.125);
    const auto text = juce::JSON::toString(data);
    p.setStateInformation(text.toRawUTF8(), static_cast<int>(text.getNumBytesAsUTF8()));
    CHECK(p.restored == 0);
    CHECK(audio(p).steps == std::vector<std::int32_t> { 5, 6 });
    CHECK(audio(p).level == 0.5f);
}

TEST_CASE("transactions, History, presets and restoration all reach the processing, coherently")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    // A transaction's fields arrive together: one snapshot holds all of them.
    p.history.transaction("Pattern",
                          [&]
                          {
                              p.state.steps.set({ 8, 8 });
                              p.state.level.set(0.75f);
                              CHECK(audio(p).steps == std::vector<std::int32_t> { 1, 2, 3 });
                          });
    auto view = audio(p);
    CHECK(view.steps == std::vector<std::int32_t> { 8, 8 });
    CHECK(view.level == 0.75f);

    p.history.undo();
    view = audio(p);
    CHECK(view.steps == std::vector<std::int32_t> { 1, 2, 3 });
    CHECK(view.level == 0.5f);
    p.history.redo();
    CHECK(audio(p).steps == std::vector<std::int32_t> { 8, 8 });

    // A factory preset (Warm sets steps to [7, 5]), and the defaults back.
    p.presets().loadFactory("warm", history::Options(true));
    CHECK(audio(p).steps == std::vector<std::int32_t> { 7, 5 });
    p.history.undo();
    CHECK(audio(p).steps == std::vector<std::int32_t> { 8, 8 });
    p.setCurrentProgram(0);
    CHECK(audio(p).steps == std::vector<std::int32_t> { 1, 2, 3 });

    // A host restoring a saved project.
    Processor original;
    original.state.steps.set({ 4 });
    original.state.seed.set(42);
    original.getParameters().getParameter("gain")->setValueNotifyingHost(0.75f);
    juce::MemoryBlock saved;
    original.getStateInformation(saved);
    restore(p, saved);
    CHECK(p.restored == 1);
    view = audio(p);
    CHECK(view.steps == std::vector<std::int32_t> { 4 });
    CHECK(view.seed == 42);
    // Each instance has its own.
    CHECK(audio(original).steps == std::vector<std::int32_t> { 4 });
    Processor fresh;
    CHECK(audio(fresh).steps == std::vector<std::int32_t> { 1, 2, 3 });
}

TEST_CASE("the audio thread reads whole snapshots while the UI keeps writing")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    p.history.transaction("Start",
                          [&]
                          {
                              p.state.steps.set({ 1 });
                              p.state.level.set(1.0f);
                          });
    std::atomic<bool> done { false };
    std::atomic<int> torn { 0 }, blocks { 0 };
    // As processBlock would: one acquire() a block, read through the block.
    std::thread audioThread(
        [&]
        {
            while (! done.load(std::memory_order_acquire))
            {
                const auto* bytes = static_cast<const std::byte*>(p.state.audioState().acquire());
                const auto length = readAt<std::uint32_t>(bytes, 24);
                const auto level = readAt<float>(bytes, 12);
                // Every write below has steps all equal to their length, and
                // level the same number: a mix of two writes is torn.
                bool whole = length <= 4 && (length == 0 || level == static_cast<float>(length));
                for (std::uint32_t index = 0; index < length && whole; ++index)
                    whole = readAt<std::int32_t>(bytes, 28 + 4 * std::size_t { index })
                            == static_cast<std::int32_t>(length);
                if (! whole)
                    ++torn;
                ++blocks;
            }
        });
    for (int write = 0; write < 4000; ++write)
    {
        const auto length = static_cast<std::size_t>(1 + write % 4);
        p.history.transaction("Write",
                              [&]
                              {
                                  p.state.steps.set(
                                      std::vector<std::int32_t>(length, static_cast<std::int32_t>(length)));
                                  p.state.level.set(static_cast<float>(length));
                              });
    }
    done.store(true, std::memory_order_release);
    audioThread.join();
    CHECK(torn == 0);
    CHECK(blocks > 0);
    // The latest value wins.
    const auto view = audio(p);
    CHECK(view.steps == std::vector<std::int32_t>(4, 4));
}
