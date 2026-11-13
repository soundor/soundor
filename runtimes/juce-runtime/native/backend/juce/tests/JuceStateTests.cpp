#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "generated/state/soundor/SoundorProcessor.h"

#include <soundor/backend/JuceParameterHost.h>
#include <soundor/history/Module.h>
#include <soundor/js/Context.h>
#include <soundor/js/Events.h>
#include <soundor/js/Runtime.h>

#include <doctest/doctest.h>

#include <thread>

namespace
{
    using namespace soundor;
    struct Processor final : AudioProcessor
    {
        using AudioProcessor::bypassParameter;
        using AudioProcessor::gainParameter;
        using AudioProcessor::nativeEvents;
        using AudioProcessor::state;
        using AudioProcessor::stateHistory;
        int restored = 0;
        std::vector<std::string> observations;
        void process(juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}
        const juce::String getName() const override { return "State Test"; }
        void prepareToPlay(double, int) override {}
        void releaseResources() override {}
        juce::AudioProcessorEditor* createEditor() override { return nullptr; }
        bool hasEditor() const override { return false; }
        bool acceptsMidi() const override { return false; }
        bool producesMidi() const override { return false; }
        double getTailLengthSeconds() const override { return 0; }
        int getNumPrograms() override { return 1; }
        int getCurrentProgram() override { return 0; }
        void setCurrentProgram(int) override {}
        const juce::String getProgramName(int) override { return {}; }
        void changeProgramName(int, const juce::String&) override {}
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
    copied.setStateInformation(text.toRawUTF8(), text.getNumBytesAsUTF8());
    CHECK(copied.restored == 1);
    CHECK(! copied.state.selectedPreset.get());
    bad.getDynamicObject()->setProperty("version", 1);
    bad["state"].getDynamicObject()->setProperty("groups", "corrupt");
    const auto corrupt = juce::JSON::toString(bad);
    copied.setStateInformation(corrupt.toRawUTF8(), corrupt.getNumBytesAsUTF8());
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
    p.stateHistory.transaction("Load Preset",
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
    CHECK(p.stateHistory.status().undoLabel == "Load Preset");
    p.stateHistory.undo();
    CHECK(p.gainParameter.load() == initial);
    CHECK(! p.state.selectedPreset.get());
    p.stateHistory.redo();
    CHECK(p.gainParameter.load() == 0.75f);
    CHECK(p.state.selectedPreset.get() == "Preset");
    CHECK_THROWS(p.stateHistory.transaction("Failed",
                                            [&]
                                            {
                                                p.gainParameter.set(0.5f);
                                                p.state.selectedPreset.set(std::string("Bad"));
                                                throw std::runtime_error("fail");
                                            }));
    CHECK(p.gainParameter.load() == 0.75f);
    CHECK(p.state.selectedPreset.get() == "Preset");
    Processor other;
    CHECK(! other.stateHistory.canUndo());
}
TEST_CASE("processor History gestures and poisoned nested transactions preserve ownership")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    p.bypassParameter.beginGesture(history::Options(std::string("Toggle")));
    p.bypassParameter.beginGesture(history::Options(std::string("Ignored")));
    p.bypassParameter.set(true, history::Options(true));
    CHECK_THROWS(p.stateHistory.transaction("Conflict", [&] { p.bypassParameter.set(false); }));
    p.stateHistory.transaction("Other field", [&] { p.state.selectedPreset.set(std::string("OK")); });
    p.bypassParameter.endGesture();
    p.bypassParameter.endGesture();
    CHECK(p.stateHistory.status().undoLabel == "Toggle");
    p.stateHistory.undo();
    CHECK(! p.bypassParameter.load());
    CHECK_THROWS_AS(p.stateHistory.transaction("Outer",
                                               [&]
                                               {
                                                   try
                                                   {
                                                       p.stateHistory.transaction("Inner",
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
        history::install(context, p.stateHistory);
        persistent::install(context, p.state);
        parameters::install(context,
                            std::make_shared<backend::JuceParameterHost>(p.getParameters(), p.parameterInfos()));
        REQUIRE(context
                    .evaluateModule(
                        "(function(exports, require) { globalThis.h = require('soundor:state-history').stateHistory; "
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
        CHECK(p.stateHistory.status().undoLabel == "JS Preset");
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
    CHECK(p.stateHistory.canUndo());
    p.stateHistory.undo();
    CHECK(p.gainParameter.load() == initial);
    CHECK(! p.state.selectedPreset.get());
    p.stateHistory.redo();
    CHECK(p.state.selectedPreset.get() == "JS");
}
TEST_CASE("host automation alone creates no History; gesture records observed final effective value")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    p.gainParameter.juceParameter().setValueNotifyingHost(0.2f);
    CHECK(! p.stateHistory.canUndo());
    p.gainParameter.beginGesture(history::Options(true));
    p.gainParameter.juceParameter().setValueNotifyingHost(0.3f);
    p.gainParameter.endGesture();
    CHECK(! p.stateHistory.canUndo());
    p.gainParameter.beginGesture(history::Options(true));
    p.gainParameter.set(0.5f);
    p.gainParameter.juceParameter().setValueNotifyingHost(0.75f);
    p.gainParameter.endGesture();
    CHECK(p.stateHistory.canUndo());
    p.stateHistory.undo();
    CHECK(p.gainParameter.load() == doctest::Approx(0.3));
    p.stateHistory.redo();
    CHECK(p.gainParameter.load() == 0.75f);
    juce::MemoryBlock saved;
    p.getStateInformation(saved);
    restore(p, saved);
    CHECK(! p.stateHistory.canUndo());
    CHECK(! p.stateHistory.canRedo());
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
                    p.stateHistory.undo();
                else if (op == "redo")
                    p.stateHistory.redo();
                else if (op == "transaction")
                    p.stateHistory.transaction(step["label"].toString().toStdString(), [&] { execute(step["steps"]); });
                else
                    FAIL("unknown History operation");
            }
        };
        execute(scenario["steps"]);
        CHECK(p.bypassParameter.load() == static_cast<bool>(scenario["bypass"]));
        const auto optional = [](const juce::var& v) -> std::optional<std::string>
        { return v.isVoid() ? std::nullopt : std::optional(v.toString().toStdString()); };
        CHECK(p.state.selectedPreset.get() == optional(scenario["selected"]));
        CHECK(p.stateHistory.status().undoLabel == optional(scenario["undo"]));
        CHECK(p.stateHistory.status().redoLabel == optional(scenario["redo"]));
    }
}

TEST_CASE("History edits and replay preserve JUCE one-shot and explicit host gesture order")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    struct Listener final : juce::AudioProcessorParameter::Listener
    {
        std::vector<std::string> events;
        void parameterValueChanged(int, float) override { events.push_back("value"); }
        void parameterGestureChanged(int, bool begin) override { events.push_back(begin ? "begin" : "end"); }
    } listener;
    auto& parameter = p.bypassParameter.juceParameter();
    parameter.addListener(&listener);
    p.bypassParameter.set(true, history::Options(true));
    CHECK(listener.events == std::vector<std::string> { "begin", "value", "end" });
    listener.events.clear();
    p.stateHistory.undo();
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
    CHECK(! p.stateHistory.canUndo());
    p.bypassParameter.endGesture();
    CHECK(p.stateHistory.status().undoLabel == "Native Drag");
    p.stateHistory.clear();
    {
        backend::JuceParameterHost editor(p.getParameters(), p.parameterInfos());
        editor.beginEdit(1, history::Options(true));
        editor.edit(1, 0, {});
    }
    CHECK(! p.stateHistory.canUndo());
    p.bypassParameter.set(true, history::Options(true));
    CHECK(p.stateHistory.canUndo());
}

TEST_CASE("background project snapshots wait for complete transactional publication")
{
    juce::ScopedJuceInitialiser_GUI init;
    Processor p;
    std::atomic<bool> requested { false }, completed { false };
    std::thread reader;
    juce::MemoryBlock saved;
    p.stateHistory.transaction("Atomic Preset",
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
    history::install(context, p.stateHistory);
    REQUIRE(context
                .evaluateModule("(function(exports, require) { globalThis.historyEvents = 0; "
                                "require('soundor:state-history').stateHistory.subscribe(() => ++historyEvents); })",
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
    native::install(context, nullptr, processor.nativeEvents);
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
