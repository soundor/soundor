#include <soundor/render/GpuCompositor.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    std::shared_ptr<gpu::Device> GpuCompositor::createDevice(bool, std::string* failure)
    {
        if (failure != nullptr)
            *failure = "the engine was built without GPU support";
        return {};
    }

    std::unique_ptr<GpuCompositor> GpuCompositor::create(const Options&, std::string* failure)
    {
        if (failure != nullptr)
            *failure = "the engine was built without GPU support";
        return {};
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
