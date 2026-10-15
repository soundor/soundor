// Appended to Hermes's API/hermes/hermes.cpp by SoundorHermesPatch.cmake:
// the implementation of SoundorHermes.h, inside the translation unit where
// HermesRuntimeImpl and the engine's values are reachable.

#include "SoundorHermes.h"

#include "hermes/VM/JSTypedArray.h"

// Befriended by HermesRuntimeImpl (SoundorHermesPatch.cmake).
struct SoundorHermesAccess
{
    static facebook::hermes::HermesRuntimeImpl& impl(facebook::jsi::Runtime& runtime)
    {
        return static_cast<facebook::hermes::HermesRuntimeImpl&>(runtime);
    }

    static vm::HermesValue value(const facebook::jsi::Value& value)
    {
        return facebook::hermes::HermesRuntimeImpl::phv(value);
    }

    static vm::Runtime& vm(facebook::jsi::Runtime& runtime) { return impl(runtime).runtime_; }

    static std::size_t values(facebook::jsi::Runtime& runtime) { return impl(runtime).hermesValues_.sizeForTests(); }
};

namespace facebook::hermes::soundor
{
    namespace
    {
        TypedArrayKind kindOf(vm::CellKind kind)
        {
            switch (kind)
            {
                case vm::CellKind::Int8ArrayKind:
                    return TypedArrayKind::Int8;
                case vm::CellKind::Uint8ArrayKind:
                    return TypedArrayKind::Uint8;
                case vm::CellKind::Uint8ClampedArrayKind:
                    return TypedArrayKind::Uint8Clamped;
                case vm::CellKind::Int16ArrayKind:
                    return TypedArrayKind::Int16;
                case vm::CellKind::Uint16ArrayKind:
                    return TypedArrayKind::Uint16;
                case vm::CellKind::Int32ArrayKind:
                    return TypedArrayKind::Int32;
                case vm::CellKind::Uint32ArrayKind:
                    return TypedArrayKind::Uint32;
                case vm::CellKind::Float32ArrayKind:
                    return TypedArrayKind::Float32;
                case vm::CellKind::Float64ArrayKind:
                    return TypedArrayKind::Float64;
                case vm::CellKind::BigInt64ArrayKind:
                    return TypedArrayKind::BigInt64;
                case vm::CellKind::BigUint64ArrayKind:
                    return TypedArrayKind::BigUint64;
                default:
                    return TypedArrayKind::None;
            }
        }
    } // namespace

    bool bufferView(jsi::Runtime& runtime, const jsi::Value& value, BufferView& out) noexcept
    {
        if (! value.isObject())
            return false;
        const vm::HermesValue hv = SoundorHermesAccess::value(value);
        vm::Runtime& rt = SoundorHermesAccess::vm(runtime);
        if (auto* buffer = vm::dyn_vmcast<vm::JSArrayBuffer>(hv))
        {
            out.kind = TypedArrayKind::None;
            out.detached = ! buffer->attached();
            out.byteLength = out.detached ? 0 : buffer->size();
            out.data = out.byteLength == 0 ? nullptr : buffer->getDataBlock(rt);
            return true;
        }
        if (auto* array = vm::dyn_vmcast<vm::JSTypedArrayBase>(hv))
        {
            out.kind = kindOf(array->getKind());
            out.detached = ! array->attached(rt);
            out.byteLength = out.detached ? 0 : array->getByteLength();
            out.data = out.byteLength == 0 ? nullptr : array->begin(rt);
            return true;
        }
        return false;
    }

    bool detachArrayBuffer(jsi::Runtime& runtime, const jsi::Value& value) noexcept
    {
        if (! value.isObject())
            return false;
        vm::Runtime& rt = SoundorHermesAccess::vm(runtime);
        const vm::PinnedHermesValue& pinned = facebook::hermes::HermesRuntimeImpl::phv(value);
        if (vm::dyn_vmcast<vm::JSArrayBuffer>(pinned) == nullptr)
            return false;
        vm::GCScope scope(rt);
        return vm::JSArrayBuffer::detach(rt, vm::Handle<vm::JSArrayBuffer>::vmcast(&pinned))
               != vm::ExecutionStatus::EXCEPTION;
    }

    bool hasPendingJobs(jsi::Runtime& runtime) noexcept
    {
        return SoundorHermesAccess::vm(runtime).soundorHasPendingJobs();
    }

    std::uint64_t jobsRun(jsi::Runtime& runtime) noexcept
    {
        return SoundorHermesAccess::vm(runtime).soundorJobsRun();
    }

    HeapStatistics heapStatistics(jsi::Runtime& runtime) noexcept
    {
        vm::GCBase::HeapInfo info;
        SoundorHermesAccess::vm(runtime).getHeap().getHeapInfo(info);
        HeapStatistics statistics;
        statistics.collections = info.numCollections;
        statistics.totalAllocatedBytes = info.totalAllocatedBytes;
        statistics.allocatedBytes = info.allocatedBytes;
        statistics.heapSize = info.heapSize;
        statistics.externalBytes = info.externalBytes;
        return statistics;
    }

    std::size_t countObjects(jsi::Runtime& runtime) noexcept
    {
        std::size_t count = 0;
        SoundorHermesAccess::vm(runtime).getHeap().forAllObjs(
            [&count](vm::GCCell* cell)
            {
                if (vm::vmisa<vm::JSObject>(cell))
                    ++count;
            });
        return count;
    }

    std::size_t liveValues(jsi::Runtime& runtime) noexcept
    {
        return SoundorHermesAccess::values(runtime);
    }
} // namespace facebook::hermes::soundor
