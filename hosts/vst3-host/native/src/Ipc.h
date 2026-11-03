// Framing of the host's protocol (README, "Protocol"). Each frame is
//
//   magic "SVH1" | u32 LE header length | u32 LE payload length | header | payload
//
// The header is a UTF-8 JSON object; the payload is raw bytes (audio as
// little-endian float32, plugin state). Requests arrive on stdin, responses
// and events leave on the process's original stdout, which Main.cpp moves
// out of the way of plugins writing to fd 1.
#pragma once

#include "Json.h"

#include <cstdint>
#include <memory>
#include <mutex>
#include <span>
#include <string>
#include <vector>

namespace soundor::vst3host
{
    inline constexpr uint32_t frameMagic = 0x31485653; // "SVH1", little-endian
    inline constexpr size_t frameHeaderBytes = 12;

    /** A byte buffer whose data is aligned for float and double access. */
    class Payload
    {
    public:
        Payload() = default;
        explicit Payload(size_t size) { resize(size); }
        void resize(size_t size);
        uint8_t* data() { return storage_.empty() ? nullptr : reinterpret_cast<uint8_t*>(storage_.data()); }
        const uint8_t* data() const
        {
            return storage_.empty() ? nullptr : reinterpret_cast<const uint8_t*>(storage_.data());
        }
        size_t size() const { return size_; }

    private:
        std::vector<double> storage_;
        size_t size_ = 0;
    };

    struct Frame
    {
        Json header;
        Payload payload;
    };

    /** A native file handle: an fd on POSIX, a HANDLE on Windows. */
    using NativeHandle = intptr_t;

    class FrameReader
    {
    public:
        enum class Status
        {
            Frame,
            End,
            Error
        };
        FrameReader(NativeHandle handle, size_t maxHeader, size_t maxPayload)
            : handle_(handle), maxHeader_(maxHeader), maxPayload_(maxPayload)
        {
        }
        /** Blocks for the next frame. On Error, `error` says why; the stream
            cannot be resynchronised afterwards. A header that is not valid
            JSON still returns a Frame whose header is null. */
        Status read(Frame& frame, std::string& error);

    private:
        bool readExact(uint8_t* data, size_t size, bool& end) const;
        NativeHandle handle_;
        size_t maxHeader_;
        size_t maxPayload_;
    };

    class FrameWriter
    {
    public:
        explicit FrameWriter(NativeHandle handle) : handle_(handle) {}
        /** Thread-safe; false once the reader has gone. */
        bool write(const Json& header, std::span<const uint8_t> payload = {});

    private:
        bool writeAll(const uint8_t* data, size_t size) const;
        std::mutex mutex_;
        NativeHandle handle_;
        bool broken_ = false;
    };
} // namespace soundor::vst3host
