#include "JuceParameterHost.h"

#include <stdexcept>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    namespace
    {
        constexpr auto notDeclared = static_cast<std::size_t>(-1);
    }

    JuceParameterHost::JuceParameterHost(juce::AudioProcessorValueTreeState& state,
                                         std::span<const parameters::Info> infos)
        : declared(infos), flags(infos.size())
    {
        bound.reserve(infos.size());
        for (const auto& info : infos)
        {
            auto* parameter = state.getParameter(juce::String::fromUTF8(info.id.data(), int(info.id.size())));
            if (parameter == nullptr)
                throw std::logic_error("soundor:parameters: no JUCE parameter '" + info.id + "'");
            bound.push_back(parameter);
        }

        int highestIndex = -1;
        for (auto* parameter : bound)
            highestIndex = std::max(highestIndex, parameter->getParameterIndex());
        declaredIndexOf.assign(static_cast<std::size_t>(highestIndex + 1), notDeclared);
        for (std::size_t index = 0; index < bound.size(); ++index)
            declaredIndexOf[static_cast<std::size_t>(bound[index]->getParameterIndex())] = index;

        for (auto* parameter : bound)
            parameter->addListener(this);
    }

    JuceParameterHost::~JuceParameterHost()
    {
        for (auto* parameter : bound)
            parameter->removeListener(this);
    }

    double JuceParameterHost::value(std::size_t index) const
    {
        const auto* parameter = bound[index];
        return double(parameter->convertFrom0to1(parameter->getValue()));
    }

    void JuceParameterHost::setValue(std::size_t index, double value)
    {
        auto* parameter = bound[index];
        parameter->setValueNotifyingHost(parameter->convertTo0to1(float(value)));
    }

    void JuceParameterHost::beginGesture(std::size_t index)
    {
        bound[index]->beginChangeGesture();
    }

    void JuceParameterHost::endGesture(std::size_t index)
    {
        bound[index]->endChangeGesture();
    }

    void JuceParameterHost::parameterValueChanged(int parameterIndex, float)
    {
        const auto juceIndex = static_cast<std::size_t>(parameterIndex);
        if (juceIndex < declaredIndexOf.size() && declaredIndexOf[juceIndex] != notDeclared)
            flags.markChanged(declaredIndexOf[juceIndex]);
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
