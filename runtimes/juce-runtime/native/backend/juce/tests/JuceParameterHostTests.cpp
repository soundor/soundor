// The JUCE parameter adapter against a real AudioProcessorValueTreeState.

#define DOCTEST_CONFIG_IMPLEMENT
#include <soundor/backend/JuceParameterHost.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>
#include <juce_audio_processors/juce_audio_processors.h>

#include <memory>
#include <thread>
#include <vector>

using namespace soundor;

namespace
{
    // A processor with the same parameter shapes a generated one has.
    class TestProcessor final : public juce::AudioProcessor
    {
    public:
        TestProcessor()
        {
            juce::AudioProcessorValueTreeState::ParameterLayout layout;
            layout.add(std::make_unique<juce::AudioParameterBool>(juce::ParameterID { "bypass", 1 }, "Bypass", false));
            layout.add(std::make_unique<juce::AudioParameterFloat>(juce::ParameterID { "gain", 1 }, "Gain",
                                                                   juce::NormalisableRange<float>(-60.0f, 6.0f), 0.0f));
            layout.add(std::make_unique<juce::AudioParameterChoice>(juce::ParameterID { "mode", 1 }, "Mode",
                                                                    juce::StringArray { "mono", "stereo" }, 1));
            layout.add(
                std::make_unique<juce::AudioParameterInt>(juce::ParameterID { "voices", 1 }, "Voices", 1, 16, 4));
            state = std::make_unique<juce::AudioProcessorValueTreeState>(*this, nullptr, "TEST", std::move(layout));
        }

        static std::span<const parameters::Info> infos()
        {
            static const std::vector<parameters::Info> table {
                { "bypass", "Bypass", parameters::Kind::Bool, 0, 1, 0, "", {} },
                { "gain", "Gain", parameters::Kind::Float, -60, 6, 0, "", {} },
                { "mode", "Mode", parameters::Kind::Choice, 0, 1, 1, "", { "mono", "stereo" } },
                { "voices", "Voices", parameters::Kind::Int, 1, 16, 4, "", {} },
            };
            return table;
        }

        juce::RangedAudioParameter& parameter(const char* id) { return *state->getParameter(id); }

        std::unique_ptr<juce::AudioProcessorValueTreeState> state;

        const juce::String getName() const override { return "Test"; }
        void prepareToPlay(double, int) override {}
        void releaseResources() override {}
        void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override {}
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
        void getStateInformation(juce::MemoryBlock&) override {}
        void setStateInformation(const void*, int) override {}
    };

    // Records the gestures JUCE reports to the (would-be) plugin host.
    struct GestureLog final : juce::AudioProcessorParameter::Listener
    {
        void parameterValueChanged(int, float) override {}
        void parameterGestureChanged(int index, bool starting) override
        {
            events.push_back(juce::String(starting ? "begin " : "end ") + juce::String(index));
        }
        std::vector<juce::String> events;
    };

    struct Fixture
    {
        Fixture()
            : host({ .parameters =
                         std::make_shared<backend::JuceParameterHost>(*processor.state, TestProcessor::infos()) })
        {
        }

        js::Value run(const std::string& body)
        {
            auto evaluated = host.context().evaluateModule(
                "import { parameters as p } from 'soundor:parameters';\n" + body, "/t" + std::to_string(++counter));
            REQUIRE_MESSAGE(evaluated.ok(), (evaluated.ok() ? "" : evaluated.error().toString()));
            return host.context().evaluateScript("globalThis.result").value();
        }

        TestProcessor processor;
        RuntimeHost host;
        int counter = 0;
    };
} // namespace

TEST_CASE("reads APVTS values in plain units")
{
    Fixture f;
    CHECK(f.run("globalThis.result = [p.gain.get(), p.mode.get(), p.voices.get(), p.bypass.get()].join();").asString()
          == "0,stereo,4,false");
}

TEST_CASE("writes through to the APVTS, notifying the host")
{
    Fixture f;
    REQUIRE(f.run("p.gain.set(-30); p.mode.set('mono'); p.voices.set(9); p.bypass.set(true); globalThis.result = 0;")
                .isNumber());
    CHECK(f.processor.state->getRawParameterValue("gain")->load() == doctest::Approx(-30));
    CHECK(f.processor.state->getRawParameterValue("mode")->load() == 0);
    CHECK(f.processor.state->getRawParameterValue("voices")->load() == 9);
    CHECK(f.processor.state->getRawParameterValue("bypass")->load() == 1);
}

TEST_CASE("delivers changes made outside the UI, including from another thread")
{
    Fixture f;
    REQUIRE(f.run("globalThis.seen = []; p.gain.subscribe((v) => seen.push(Math.round(v)));"
                  "p.mode.subscribe((v) => seen.push(v)); globalThis.result = 0;")
                .isNumber());
    auto& gain = f.processor.parameter("gain");
    std::thread automation([&] { gain.setValueNotifyingHost(gain.convertTo0to1(-12.0f)); });
    automation.join();
    f.processor.parameter("mode").setValueNotifyingHost(0.0f);
    f.host.tick();
    CHECK(f.host.context().evaluateScript("seen.join()").value().asString() == "-12,mono");
}

TEST_CASE("forwards gestures to JUCE")
{
    Fixture f;
    GestureLog log;
    f.processor.parameter("gain").addListener(&log);
    REQUIRE(f.run("p.gain.beginGesture(); p.gain.set(-6); p.gain.endGesture(); globalThis.result = 0;").isNumber());
    f.processor.parameter("gain").removeListener(&log);
    const auto index = juce::String(f.processor.parameter("gain").getParameterIndex());
    CHECK(log.events == std::vector<juce::String> { "begin " + index, "end " + index });
}

TEST_CASE("detaches from the APVTS when the runtime is torn down")
{
    TestProcessor processor;
    {
        RuntimeHost host(
            { .parameters = std::make_shared<backend::JuceParameterHost>(*processor.state, TestProcessor::infos()) });
        REQUIRE(host.context()
                    .evaluateModule("import { parameters } from 'soundor:parameters';"
                                    "parameters.gain.subscribe(() => {});",
                                    "/ui.js")
                    .ok());
    }
    // No listener is left behind: a change after teardown must not touch freed state.
    processor.parameter("gain").setValueNotifyingHost(0.25f);
}

int main(int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI juce;
    return doctest::Context(argc, argv).run();
}
