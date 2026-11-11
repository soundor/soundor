#define DOCTEST_CONFIG_IMPLEMENT_WITH_MAIN
#include "generated/state/soundor/SoundorProcessor.h"

#include <soundor/js/Runtime.h>

#include <doctest/doctest.h>

#include <thread>

namespace
{
    using namespace soundor;
    struct Processor final : AudioProcessor
    {
        using AudioProcessor::state;
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
