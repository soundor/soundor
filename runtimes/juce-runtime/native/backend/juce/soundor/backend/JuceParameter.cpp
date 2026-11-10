#include "JuceParameter.h"

#include <algorithm>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    namespace
    {
        juce::AudioProcessorParameterWithIDAttributes attributesOf(const parameters::Info& info)
        {
            auto attributes = juce::AudioProcessorParameterWithIDAttributes()
                                  .withLabel(juce::String::fromUTF8(info.unit.data(), int(info.unit.size())))
                                  .withAutomatable(info.access == parameters::Access::Automatable);
            // JUCE marks a meter read-only to hosts: VST3's kIsReadOnly, AU's
            // MeterReadOnly.
            if (info.access == parameters::Access::ReadOnly)
                attributes = attributes.withCategory(juce::AudioProcessorParameter::outputMeter);
            return attributes;
        }

        juce::NormalisableRange<float> rangeOf(const parameters::Info& info, const ParameterBehavior& behavior)
        {
            const auto start = static_cast<float>(info.min);
            // A one-option choice spans nothing, which NormalisableRange refuses.
            const auto end = std::max(static_cast<float>(info.max), start + 1.0f);
            // The APVTS converts with these: the generated functions.
            return {
                start,
                end,
                [toValue = behavior.toValue](float, float, float normalized)
                { return static_cast<float>(toValue(static_cast<double>(normalized))); },
                [toNormalized = behavior.toNormalized](float, float, float value)
                { return static_cast<float>(toNormalized(static_cast<double>(value))); },
                [constrain = behavior.constrain](float, float, float value)
                { return static_cast<float>(constrain(static_cast<double>(value))); },
            };
        }
    } // namespace

    JuceParameter::JuceParameter(const parameters::Info& info, const ParameterBehavior& behavior)
        : juce::RangedAudioParameter(
              juce::ParameterID { juce::String::fromUTF8(info.id.data(), int(info.id.size())), 1 },
              juce::String::fromUTF8(info.label.data(), int(info.label.size())), attributesOf(info)),
          declared(info),
          functions(behavior),
          range(rangeOf(info, behavior)),
          current(static_cast<float>(behavior.constrain(info.defaultValue)))
    {
    }

    void JuceParameter::setPlain(double value)
    {
        const double legal = functions.constrain(value);
        current.store(static_cast<float>(legal), std::memory_order_relaxed);
        // As setValueNotifyingHost, but keeping the exact value rather than the
        // one its 32-bit normalized position maps back to.
        sendValueChangedMessageToListeners(static_cast<float>(functions.toNormalized(legal)));
    }

    void JuceParameter::publish(double value) noexcept
    {
        current.store(static_cast<float>(functions.constrain(value)), std::memory_order_relaxed);
        published.store(true, std::memory_order_release);
    }

    void JuceParameter::flushPublished()
    {
        if (published.exchange(false, std::memory_order_acq_rel))
            sendValueChangedMessageToListeners(getValue());
    }

    float JuceParameter::getValue() const
    {
        return static_cast<float>(functions.toNormalized(static_cast<double>(plain())));
    }

    void JuceParameter::setValue(float normalized)
    {
        current.store(static_cast<float>(functions.toValue(static_cast<double>(normalized))),
                      std::memory_order_relaxed);
    }

    float JuceParameter::getDefaultValue() const
    {
        return static_cast<float>(functions.toNormalized(functions.constrain(declared.defaultValue)));
    }

    juce::String JuceParameter::getText(float normalized, int maximumLength) const
    {
        const std::string text = functions.format(functions.toValue(static_cast<double>(normalized)));
        const auto result = juce::String::fromUTF8(text.data(), int(text.size()));
        return maximumLength > 0 ? result.substring(0, maximumLength) : result;
    }

    float JuceParameter::getValueForText(const juce::String& text) const
    {
        const auto value = functions.parse(text.toStdString());
        return value ? static_cast<float>(functions.toNormalized(*value)) : getValue();
    }

    int JuceParameter::getNumSteps() const
    {
        switch (declared.type)
        {
            case parameters::Type::Float32:
                return juce::AudioProcessorParameter::getNumSteps();
            case parameters::Type::Boolean:
                return 2;
            case parameters::Type::Choice:
                return std::max(1, static_cast<int>(declared.choices.size()));
            case parameters::Type::Int8:
            case parameters::Type::Uint8:
            case parameters::Type::Int16:
            case parameters::Type::Uint16:
            case parameters::Type::Int32:
            case parameters::Type::Uint32:
            {
                const double step = declared.step > 0 ? declared.step : 1;
                return static_cast<int>(std::lround((declared.max - declared.min) / step)) + 1;
            }
        }
        return juce::AudioProcessorParameter::getNumSteps();
    }

    bool JuceParameter::isDiscrete() const
    {
        return declared.type != parameters::Type::Float32;
    }

    bool JuceParameter::isBoolean() const
    {
        return declared.type == parameters::Type::Boolean;
    }

    juce::StringArray JuceParameter::getAllValueStrings() const
    {
        if (declared.type != parameters::Type::Choice)
            return juce::RangedAudioParameter::getAllValueStrings();
        juce::StringArray labels;
        for (const auto& choice : declared.choices)
            labels.add(juce::String::fromUTF8(choice.label.data(), int(choice.label.size())));
        return labels;
    }

    PublishedParameters::PublishedParameters(std::vector<JuceParameter*> readOnly) : parameters(std::move(readOnly))
    {
        if (! parameters.empty())
            startTimerHz(30);
    }

    PublishedParameters::~PublishedParameters()
    {
        stopTimer();
    }

    void PublishedParameters::flush()
    {
        for (auto* parameter : parameters)
            parameter->flushPublished();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
