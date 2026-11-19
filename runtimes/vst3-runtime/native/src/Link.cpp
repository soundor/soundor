#include "Link.h"

#include <map>
#include <mutex>

namespace soundor::vst3
{
    namespace
    {
        using js::detail::StreamCore;
        using js::detail::StreamElement;
        using js::detail::StreamStorage;

        std::shared_ptr<StreamCore> makeStream(const Stream& stream)
        {
            const std::size_t capacity = stream.buffer ? std::max<std::size_t>(stream.maxLength, 1) : 1;
            const auto& element = stream.element;
            if (element == "int8")
                return std::make_shared<StreamStorage<std::int8_t>>(stream.buffer, capacity);
            if (element == "uint8")
                return std::make_shared<StreamStorage<std::uint8_t>>(stream.buffer, capacity);
            if (element == "int16")
                return std::make_shared<StreamStorage<std::int16_t>>(stream.buffer, capacity);
            if (element == "uint16")
                return std::make_shared<StreamStorage<std::uint16_t>>(stream.buffer, capacity);
            if (element == "int32")
                return std::make_shared<StreamStorage<std::int32_t>>(stream.buffer, capacity);
            if (element == "uint32")
                return std::make_shared<StreamStorage<std::uint32_t>>(stream.buffer, capacity);
            if (element == "int64")
                return std::make_shared<StreamStorage<std::int64_t>>(stream.buffer, capacity);
            if (element == "uint64")
                return std::make_shared<StreamStorage<std::uint64_t>>(stream.buffer, capacity);
            if (element == "float64")
                return std::make_shared<StreamStorage<double>>(stream.buffer, capacity);
            return std::make_shared<StreamStorage<float>>(stream.buffer, capacity);
        }

        template <class T>
        void store(void* data, double value) noexcept
        {
            *static_cast<T*>(data) = static_cast<T>(value);
        }

        // The sink's callbacks: realtime-safe, as the streams are.
        void publish(void* user, std::uint32_t index, double value)
        {
            const auto& cores = static_cast<Streams*>(user)->cores();
            if (index >= cores.size() || cores[index]->buffer)
                return;
            auto& core = *cores[index];
            void* data = core.back().data;
            switch (core.element)
            {
                case StreamElement::Int8:
                    store<std::int8_t>(data, value);
                    break;
                case StreamElement::Uint8:
                    store<std::uint8_t>(data, value);
                    break;
                case StreamElement::Int16:
                    store<std::int16_t>(data, value);
                    break;
                case StreamElement::Uint16:
                    store<std::uint16_t>(data, value);
                    break;
                case StreamElement::Int32:
                    store<std::int32_t>(data, value);
                    break;
                case StreamElement::Uint32:
                    store<std::uint32_t>(data, value);
                    break;
                case StreamElement::Int64:
                    store<std::int64_t>(data, value);
                    break;
                case StreamElement::Uint64:
                    store<std::uint64_t>(data, value);
                    break;
                case StreamElement::Float32:
                    store<float>(data, value);
                    break;
                case StreamElement::Float64:
                    store<double>(data, value);
                    break;
            }
            core.commit(1);
        }

        void* buffer(void* user, std::uint32_t index, std::uint32_t* capacity)
        {
            *capacity = 0;
            const auto& cores = static_cast<Streams*>(user)->cores();
            if (index >= cores.size() || ! cores[index]->buffer)
                return nullptr;
            *capacity = static_cast<std::uint32_t>(cores[index]->maxLength);
            return cores[index]->back().data;
        }

        void commit(void* user, std::uint32_t index, std::uint32_t length)
        {
            const auto& cores = static_cast<Streams*>(user)->cores();
            if (index < cores.size() && cores[index]->buffer)
                cores[index]->commit(length);
        }

        std::mutex registryLock;
        std::map<std::uint64_t, std::weak_ptr<Link>>& registry()
        {
            static std::map<std::uint64_t, std::weak_ptr<Link>> links;
            return links;
        }
        std::uint64_t nextToken = 0;
    } // namespace

    Streams::Streams(const Plugin& plugin)
    {
        for (const auto& stream : plugin.streams)
            streams.push_back(makeStream(stream));
        table = { this, &publish, &buffer, &commit };
    }

    std::uint64_t publishLink(const std::shared_ptr<Link>& link)
    {
        const std::lock_guard guard(registryLock);
        const auto token = ++nextToken;
        registry().emplace(token, link);
        return token;
    }

    void withdrawLink(std::uint64_t token)
    {
        const std::lock_guard guard(registryLock);
        registry().erase(token);
    }

    std::shared_ptr<Link> resolveLink(std::uint64_t token)
    {
        const std::lock_guard guard(registryLock);
        const auto found = registry().find(token);
        return found == registry().end() ? nullptr : found->second.lock();
    }

    std::int64_t moduleIdentity() noexcept
    {
        static const char anchor = 0;
        return static_cast<std::int64_t>(reinterpret_cast<std::uintptr_t>(&anchor));
    }
} // namespace soundor::vst3
