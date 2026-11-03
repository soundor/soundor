#include "Ipc.h"

#include <algorithm>
#include <array>
#include <cstring>

#ifdef _WIN32
    #include <windows.h>
#else
    #include <unistd.h>

    #include <cerrno>
#endif

namespace soundor::vst3host
{
    void Payload::resize(size_t size)
    {
        storage_.assign((size + sizeof(double) - 1) / sizeof(double), 0.0);
        size_ = size;
    }

    namespace
    {
        uint32_t readU32(const uint8_t* bytes)
        {
            return static_cast<uint32_t>(bytes[0]) | (static_cast<uint32_t>(bytes[1]) << 8U)
                   | (static_cast<uint32_t>(bytes[2]) << 16U) | (static_cast<uint32_t>(bytes[3]) << 24U);
        }

        void writeU32(uint8_t* bytes, uint32_t value)
        {
            bytes[0] = static_cast<uint8_t>(value);
            bytes[1] = static_cast<uint8_t>(value >> 8U);
            bytes[2] = static_cast<uint8_t>(value >> 16U);
            bytes[3] = static_cast<uint8_t>(value >> 24U);
        }
    } // namespace

    bool FrameReader::readExact(uint8_t* data, size_t size, bool& end) const
    {
        size_t done = 0;
        while (done < size)
        {
#ifdef _WIN32
            DWORD count = 0;
            const DWORD chunk = static_cast<DWORD>(std::min<size_t>(size - done, 1U << 30U));
            if (! ReadFile(reinterpret_cast<HANDLE>(handle_), data + done, chunk, &count, nullptr) || count == 0)
            {
                end = done == 0;
                return false;
            }
#else
            const ssize_t count = ::read(static_cast<int>(handle_), data + done, size - done);
            if (count < 0 && errno == EINTR)
                continue;
            if (count <= 0)
            {
                end = done == 0;
                return false;
            }
#endif
            done += static_cast<size_t>(count);
        }
        return true;
    }

    FrameReader::Status FrameReader::read(Frame& frame, std::string& error)
    {
        std::array<uint8_t, frameHeaderBytes> prefix {};
        bool end = false;
        if (! readExact(prefix.data(), prefix.size(), end))
        {
            if (end)
                return Status::End;
            error = "the request stream ended inside a frame header";
            return Status::Error;
        }
        if (readU32(prefix.data()) != frameMagic)
        {
            error = "the request stream is not framed (bad magic)";
            return Status::Error;
        }
        const uint32_t headerSize = readU32(prefix.data() + 4);
        const uint32_t payloadSize = readU32(prefix.data() + 8);
        if (headerSize > maxHeader_)
        {
            error = "a request header of " + std::to_string(headerSize) + " bytes exceeds the limit of "
                    + std::to_string(maxHeader_);
            return Status::Error;
        }
        if (payloadSize > maxPayload_)
        {
            error = "a request payload of " + std::to_string(payloadSize) + " bytes exceeds the limit of "
                    + std::to_string(maxPayload_);
            return Status::Error;
        }
        std::string header(headerSize, '\0');
        if (headerSize > 0 && ! readExact(reinterpret_cast<uint8_t*>(header.data()), headerSize, end))
        {
            error = "the request stream ended inside a frame";
            return Status::Error;
        }
        frame.payload.resize(payloadSize);
        if (payloadSize > 0 && ! readExact(frame.payload.data(), payloadSize, end))
        {
            error = "the request stream ended inside a frame";
            return Status::Error;
        }
        try
        {
            frame.header = Json::parse(header);
        }
        catch (const JsonError&)
        {
            frame.header = Json();
        }
        return Status::Frame;
    }

    bool FrameWriter::writeAll(const uint8_t* data, size_t size) const
    {
        size_t done = 0;
        while (done < size)
        {
#ifdef _WIN32
            DWORD count = 0;
            const DWORD chunk = static_cast<DWORD>(std::min<size_t>(size - done, 1U << 30U));
            if (! WriteFile(reinterpret_cast<HANDLE>(handle_), data + done, chunk, &count, nullptr))
                return false;
#else
            const ssize_t count = ::write(static_cast<int>(handle_), data + done, size - done);
            if (count < 0 && errno == EINTR)
                continue;
            if (count <= 0)
                return false;
#endif
            done += static_cast<size_t>(count);
        }
        return true;
    }

    bool FrameWriter::write(const Json& header, std::span<const uint8_t> payload)
    {
        const std::string text = header.dump();
        std::array<uint8_t, frameHeaderBytes> prefix {};
        writeU32(prefix.data(), frameMagic);
        writeU32(prefix.data() + 4, static_cast<uint32_t>(text.size()));
        writeU32(prefix.data() + 8, static_cast<uint32_t>(payload.size()));
        const std::scoped_lock lock(mutex_);
        if (broken_)
            return false;
        broken_ = ! writeAll(prefix.data(), prefix.size())
                  || ! writeAll(reinterpret_cast<const uint8_t*>(text.data()), text.size())
                  || ! writeAll(payload.data(), payload.size());
        return ! broken_;
    }
} // namespace soundor::vst3host
