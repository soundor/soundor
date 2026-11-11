// Soundor's JUCE parameters against a real AudioProcessorValueTreeState, with
// the behavior the JUCE runtime generates (generated/TestParameters.cpp, from
// parameter-codegen.test.ts): what hosts see with the editor closed, what the
// UI sees through soundor:parameters, and parity with the Web runtime's
// JavaScript (generated/ParameterParity.h).

#define DOCTEST_CONFIG_IMPLEMENT
#include "generated/ParameterParity.h"
#include "support/Modules.h"

#include <soundor/backend/JuceParameter.h>
#include <soundor/backend/JuceParameterHost.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>
#include <juce_audio_processors/juce_audio_processors.h>

#include <cmath>
#include <cstring>
#include <iterator>
#include <limits>
#include <memory>
#include <string>
#include <thread>
#include <vector>

using namespace soundor;

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::generated
{
    std::span<const parameters::Info> parameterInfos();
    std::span<const backend::ParameterBehavior> parameterBehaviors();
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::generated

namespace
{
    // A processor built as a generated one is.
    class TestProcessor final : public juce::AudioProcessor
    {
    public:
        TestProcessor()
        {
            const auto infos = generated::parameterInfos();
            const auto behaviors = generated::parameterBehaviors();
            juce::AudioProcessorValueTreeState::ParameterLayout layout;
            std::vector<backend::JuceParameter*> readOnly;
            for (std::size_t index = 0; index < infos.size(); ++index)
            {
                auto parameter = std::make_unique<backend::JuceParameter>(infos[index], behaviors[index]);
                if (infos[index].access == parameters::Access::ReadOnly)
                    readOnly.push_back(parameter.get());
                layout.add(std::move(parameter));
            }
            state = std::make_unique<juce::AudioProcessorValueTreeState>(*this, nullptr, "SOUNDOR", std::move(layout));
            published = std::make_unique<backend::PublishedParameters>(std::move(readOnly));
        }

        backend::JuceParameter& parameter(const char* id)
        {
            return *dynamic_cast<backend::JuceParameter*>(state->getParameter(id));
        }

        std::unique_ptr<juce::AudioProcessorValueTreeState> state;
        std::unique_ptr<backend::PublishedParameters> published;

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
        void getStateInformation(juce::MemoryBlock& data) override
        {
            if (auto xml = state->copyState().createXml())
                copyXmlToBinary(*xml, data);
        }
        void setStateInformation(const void* data, int size) override
        {
            if (auto xml = getXmlFromBinary(data, size))
                state->replaceState(juce::ValueTree::fromXml(*xml));
        }
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
                         std::make_shared<backend::JuceParameterHost>(*processor.state, generated::parameterInfos()) })
        {
        }

        js::Value run(const std::string& body)
        {
            auto evaluated = host.context().evaluateModule(
                soundor::test::module("import { parameters as p } from 'soundor:parameters';\n" + body),
                "/t" + std::to_string(++counter));
            REQUIRE_MESSAGE(evaluated.ok(), (evaluated.ok() ? "" : evaluated.error().toString()));
            return host.context().evaluateScript("globalThis.result").value();
        }

        std::string error(const std::string& body)
        {
            auto evaluated = host.context().evaluateModule(
                soundor::test::module("import { parameters as p } from 'soundor:parameters';\n" + body),
                "/t" + std::to_string(++counter));
            REQUIRE_FALSE(evaluated.ok());
            return evaluated.error().toString();
        }

        TestProcessor processor;
        RuntimeHost host;
        int counter = 0;
    };

    const backend::ParameterBehavior& behaviorOf(const char* id)
    {
        const auto infos = generated::parameterInfos();
        for (std::size_t index = 0; index < infos.size(); ++index)
            if (infos[index].id == id)
                return generated::parameterBehaviors()[index];
        FAIL("no parameter " << id);
        throw std::logic_error(id);
    }
} // namespace

TEST_CASE("computes what the Web runtime's JavaScript computes")
{
    std::size_t exact = 0;
    for (const auto& probe : parity::numbers)
    {
        const auto& behavior = behaviorOf(probe.parameter);
        const double output = probe.kind == parity::Kind::ToValue        ? behavior.toValue(probe.input)
                              : probe.kind == parity::Kind::ToNormalized ? behavior.toNormalized(probe.input)
                                                                         : behavior.constrain(probe.input);
        INFO(std::string(probe.parameter) << " " << static_cast<int>(probe.kind) << " " << probe.input << " → "
                                          << output << " (JavaScript: " << probe.output << ")");
        // exp, log and pow are each platform's math library's, which may
        // differ in the last bit: a normalized position by a double's, a value
        // by a float's. Everything else is exact.
        if (probe.kind == parity::Kind::ToNormalized)
            CHECK(std::abs(output - probe.output) <= 4 * std::numeric_limits<double>::epsilon());
        else
            CHECK(static_cast<float>(output)
                  == doctest::Approx(static_cast<float>(probe.output)).epsilon(std::numeric_limits<float>::epsilon()));
        exact += std::memcmp(&output, &probe.output, sizeof output) == 0 ? 1 : 0;
    }
    // All but a few, where a library function's last bit differs.
    CHECK(exact >= std::size(parity::numbers) * 99 / 100);
    for (const auto& probe : parity::formats)
    {
        INFO(std::string(probe.parameter) << " " << probe.value);
        CHECK(behaviorOf(probe.parameter).format(probe.value) == probe.text);
    }
    for (const auto& probe : parity::parses)
    {
        INFO(std::string(probe.parameter) << " '" << probe.text << "'");
        const auto value = behaviorOf(probe.parameter).parse(probe.text);
        REQUIRE(value.has_value() == probe.ok);
        if (value)
            CHECK(*value == probe.value);
    }
}

TEST_CASE("hosts read and write text with no editor open")
{
    TestProcessor processor;
    auto& frequency = processor.parameter("frequency");
    CHECK(frequency.getText(frequency.convertTo0to1(1250.0f), 0) == "1.25 kHz");
    CHECK(frequency.getText(frequency.convertTo0to1(500.0f), 0) == "500 Hz");
    CHECK(frequency.getText(frequency.convertTo0to1(1250.0f), 4) == "1.25");
    CHECK(frequency.convertFrom0to1(frequency.getValueForText("1.25 kHz")) == doctest::Approx(1250).epsilon(1e-6));
    CHECK(frequency.convertFrom0to1(frequency.getValueForText("500 Hz")) == doctest::Approx(500).epsilon(1e-6));
    CHECK(frequency.getLabel() == "Hz");

    auto& gain = processor.parameter("gain");
    gain.setPlain(-3.5);
    CHECK(gain.getCurrentValueAsText() == "-3.50 dB");
    CHECK(gain.convertFrom0to1(gain.getValueForText("-12.345 dB")) == doctest::Approx(-12.35f));
    // Text that is no value leaves the parameter where it is, never at 0.
    CHECK(gain.getValueForText("loud") == gain.getValue());
    CHECK(gain.getValueForText("30 dB") == gain.getValue());

    auto& filter = processor.parameter("filterType");
    CHECK(filter.getText(1.0f, 0) == "High Pass");
    CHECK(filter.getValueForText("low pass") == 0.5f);
    CHECK(filter.getAllValueStrings() == juce::StringArray { "Bell", "Low Pass", "High Pass" });
    auto& bypass = processor.parameter("bypass");
    CHECK(bypass.getText(1.0f, 0) == "On");
    CHECK(bypass.getValueForText("off") == 0.0f);
}

TEST_CASE("tells hosts what each parameter is")
{
    TestProcessor processor;
    auto& frequency = processor.parameter("frequency");
    CHECK(frequency.isAutomatable());
    CHECK_FALSE(frequency.isDiscrete());
    CHECK(frequency.getCategory() == juce::AudioProcessorParameter::genericParameter);
    CHECK(frequency.getName(100) == "Frequency");
    CHECK(frequency.getDefaultValue() == doctest::Approx(std::log(50.0) / std::log(1000.0)));

    // Manual: the UI's and the host's controls, not automation.
    auto& voices = processor.parameter("voices");
    CHECK_FALSE(voices.isAutomatable());
    CHECK(voices.isDiscrete());
    CHECK(voices.getNumSteps() == 16);

    // Read-only: a meter to hosts (VST3 kIsReadOnly, AU MeterReadOnly).
    auto& reduction = processor.parameter("reduction");
    CHECK_FALSE(reduction.isAutomatable());
    CHECK(reduction.getCategory() == juce::AudioProcessorParameter::outputMeter);

    CHECK(processor.parameter("octave").getNumSteps() == 5);
    CHECK(processor.parameter("filterType").getNumSteps() == 3);
    CHECK(processor.parameter("bypass").isBoolean());
    CHECK(processor.parameter("bypass").getNumSteps() == 2);
}

TEST_CASE("automation maps through the declared curve and snaps to the step")
{
    TestProcessor processor;
    auto& frequency = processor.parameter("frequency");
    frequency.setValueNotifyingHost(0.5f);
    CHECK(frequency.plain() == doctest::Approx(std::sqrt(20.0 * 20000.0)).epsilon(1e-6));
    CHECK(processor.state->getRawParameterValue("frequency")->load() == frequency.plain());

    auto& gain = processor.parameter("gain");
    gain.setValueNotifyingHost(0.51f);
    CHECK(gain.plain() == 0.48f);
    CHECK(processor.state->getRawParameterValue("gain")->load() == 0.48f);

    // As JUCE's AudioParameterInt, so sessions keep their meaning.
    auto& voices = processor.parameter("voices");
    for (const float t : { 0.0f, 0.04f, 0.5f, 0.97f, 1.0f })
    {
        voices.setValueNotifyingHost(t);
        CHECK(voices.plain() == 1.0f + std::floor(t * 15.0f + 0.5f));
    }
    auto& filter = processor.parameter("filterType");
    filter.setValueNotifyingHost(0.74f);
    CHECK(filter.plain() == 1.0f);
}

TEST_CASE("sessions keep their values")
{
    juce::MemoryBlock saved;
    {
        TestProcessor processor;
        processor.parameter("frequency").setPlain(1234);
        processor.parameter("filterType").setPlain(2);
        processor.parameter("voices").setPlain(9);
        processor.getStateInformation(saved);
    }
    TestProcessor restored;
    restored.setStateInformation(saved.getData(), static_cast<int>(saved.getSize()));
    CHECK(restored.parameter("frequency").plain() == doctest::Approx(1234).epsilon(1e-6));
    CHECK(restored.parameter("filterType").plain() == 2);
    CHECK(restored.parameter("voices").plain() == 9);
}

TEST_CASE("reads values in their declared types, with their metadata")
{
    Fixture f;
    CHECK(f.run("globalThis.result = [p.gain.get(), p.filterType.get(), p.voices.get(), p.bypass.get()].join();")
              .asString()
          == "0,bell,4,false");
    CHECK(
        f.run("globalThis.result = JSON.stringify(p.gain.info);").asString()
        == R"({"id":"gain","label":"Gain","access":"automatable","type":"float32","min":-24,"max":24,"default":0,"step":0.01,"unit":"dB"})");
    CHECK(f.run("globalThis.result = p.frequency.format(1250) + '|' + p.frequency.parse('2 kHz') + '|'"
                " + p.frequency.toNormalized(20000) + '|' + p.filterType.fromNormalized(0.5);")
              .asString()
          == "1.25 kHz|2000|1|lowpass");
}

TEST_CASE("writes exactly through to the APVTS, notifying the host")
{
    Fixture f;
    REQUIRE(f.run("p.gain.set(-3.456); p.filterType.set('highpass'); p.voices.set(9.4); p.bypass.set(true);"
                  "p.frequency.set(1000); globalThis.result = 0;")
                .isNumber());
    CHECK(f.processor.parameter("gain").plain() == -3.46f);
    CHECK(f.processor.parameter("frequency").plain() == 1000.0f);
    CHECK(f.processor.state->getRawParameterValue("filterType")->load() == 2);
    CHECK(f.processor.state->getRawParameterValue("voices")->load() == 9);
    CHECK(f.processor.state->getRawParameterValue("bypass")->load() == 1);
    CHECK(f.run("globalThis.result = p.frequency.get();").asNumber() == 1000);
}

TEST_CASE("a read-only parameter is published by the processing, never written by the UI")
{
    Fixture f;
    CHECK(f.error("p.reduction.set(-3);")
          == "TypeError: Parameter 'reduction' is read-only: only the plugin's processing sets it");
    REQUIRE(
        f.run("globalThis.seen = []; p.reduction.subscribe((v) => seen.push(v)); globalThis.result = 0;").isNumber());
    backend::ParameterOutput<float> reduction(f.processor.parameter("reduction"));
    std::thread audio([&] { reduction.publish(-6.5f); });
    audio.join();
    CHECK(reduction.load() == -6.5f);
    f.host.tick();
    CHECK(f.host.context().evaluateScript("seen.join()").value().asString() == "");
    f.processor.published->flush(); // what its timer does on the message thread
    f.host.tick();
    CHECK(f.host.context().evaluateScript("seen.join()").value().asString() == "-6.5");
    CHECK(f.processor.parameter("reduction").getCurrentValueAsText() == "-6.5 dB");
}

TEST_CASE("typed handles read the value as declared")
{
    TestProcessor processor;
    enum class FilterType : std::uint32_t
    {
        bell,
        lowpass,
        highpass
    };
    processor.parameter("filterType").setPlain(1);
    processor.parameter("bypass").setPlain(1);
    processor.parameter("octave").setPlain(3);
    CHECK(backend::ParameterValue<FilterType>(processor.parameter("filterType")).load() == FilterType::lowpass);
    CHECK(backend::ParameterValue<bool>(processor.parameter("bypass")).load());
    CHECK(backend::ParameterValue<std::int8_t>(processor.parameter("octave")).load() == 4);
}

TEST_CASE("delivers changes made outside the UI, including from another thread")
{
    Fixture f;
    REQUIRE(f.run("globalThis.seen = []; p.gain.subscribe((v) => seen.push(v));"
                  "p.filterType.subscribe((v) => seen.push(v)); globalThis.result = 0;")
                .isNumber());
    auto& gain = f.processor.parameter("gain");
    std::thread automation([&] { gain.setValueNotifyingHost(gain.convertTo0to1(-12.0f)); });
    automation.join();
    f.processor.parameter("filterType").setValueNotifyingHost(0.0f);
    f.host.tick();
    CHECK(f.host.context().evaluateScript("seen.join()").value().asString() == "-12,bell");
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
        RuntimeHost host({ .parameters = std::make_shared<backend::JuceParameterHost>(*processor.state,
                                                                                      generated::parameterInfos()) });
        REQUIRE(host.context()
                    .evaluateModule(soundor::test::module("import { parameters } from 'soundor:parameters';"
                                                          "parameters.gain.subscribe(() => {});"),
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

TEST_CASE("one-shot boolean writes reach JUCE in begin-value-end order and no-ops stay silent")
{
    Fixture f;
    struct Log final : juce::AudioProcessorParameter::Listener
    {
        std::vector<std::string> events;
        void parameterValueChanged(int, float) override { events.push_back("value"); }
        void parameterGestureChanged(int, bool starting) override { events.push_back(starting ? "begin" : "end"); }
    } log;
    auto& parameter = f.processor.parameter("bypass");
    parameter.addListener(&log);
    CHECK(f.run("p.bypass.set(v => !v); globalThis.result = p.bypass.get();").asBoolean());
    CHECK(log.events == std::vector<std::string> { "begin", "value", "end" });
    log.events.clear();
    REQUIRE(f.run("p.bypass.set(true); globalThis.result = 0;").isNumber());
    CHECK(log.events.empty());
    REQUIRE(f.run("p.bypass.beginGesture(); p.bypass.beginGesture(); p.bypass.set(false); p.bypass.set(true);"
                  "p.bypass.endGesture(); p.bypass.endGesture(); globalThis.result = 0;")
                .isNumber());
    CHECK(log.events == std::vector<std::string> { "begin", "value", "value", "end" });
    log.events.clear();
    parameter.setValueNotifyingHost(0);
    CHECK(log.events == std::vector<std::string> { "value" });
    parameter.removeListener(&log);
}
