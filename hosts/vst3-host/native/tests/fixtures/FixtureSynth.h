// What the fixture classes share: the synth's factory entry (a separate
// file: vstsinglecomponenteffect.h must be included before
// vsteditcontroller.h, whose setState it renames) and automation reading.
#pragma once

#include "pluginterfaces/base/funknown.h"
#include "pluginterfaces/vst/ivstparameterchanges.h"

namespace soundor::fixtures
{
    using namespace Steinberg;
    using namespace Steinberg::Vst;

    extern const FUID synthId;
    FUnknown* createSynth(void*);

    /** Walks a parameter's points through a block, sample by sample. */
    class Automation
    {
    public:
        Automation(IParameterChanges* changes, ParamID id, double current) : value_(current)
        {
            for (int32 index = 0; changes != nullptr && index < changes->getParameterCount(); ++index)
                if (IParamValueQueue* queue = changes->getParameterData(index);
                    queue != nullptr && queue->getParameterId() == id)
                    queue_ = queue;
        }
        /** The value at `frame`: the last point at or before it. */
        double at(int32 frame)
        {
            while (queue_ != nullptr && next_ < queue_->getPointCount())
            {
                int32 offset = 0;
                ParamValue value = 0;
                queue_->getPoint(next_, offset, value);
                if (offset > frame)
                    break;
                value_ = value;
                ++next_;
            }
            return value_;
        }

    private:
        IParamValueQueue* queue_ = nullptr;
        int32 next_ = 0;
        double value_;
    };
} // namespace soundor::fixtures
