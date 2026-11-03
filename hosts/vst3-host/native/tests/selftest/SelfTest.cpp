// Unit checks of the host's own building blocks: JSON, framing and binary
// architecture detection. Plugin behavior is tested end to end through the
// Node client (tests/native).
#include "Bundle.h"
#include "Ipc.h"
#include "Json.h"

#include <cstdio>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <thread>
#include <vector>

#if defined(_WIN32)
    #include <windows.h>
#else
    #include <unistd.h>
#endif

using namespace soundor::vst3host;

namespace
{
    int failures = 0;

    void check(bool condition, const char* what, int line)
    {
        if (! condition)
        {
            std::fprintf(stderr, "FAILED (line %d): %s\n", line, what);
            ++failures;
        }
    }
#define CHECK(condition) check((condition), #condition, __LINE__)

    template <typename F>
    bool throwsJsonError(F&& function)
    {
        try
        {
            function();
        }
        catch (const JsonError&)
        {
            return true;
        }
        return false;
    }

    void json()
    {
        const Json value = Json::parse(R"({"a":[1,2.5,-3e2,true,false,null],"b":"x\"\\\n\u00e9\ud83d\ude00","c":{}})");
        CHECK(value.find("a")->asArray().size() == 6);
        CHECK(value.find("a")->asArray()[1].asNumber() == 2.5);
        CHECK(value.find("a")->asArray()[2].asNumber() == -300);
        CHECK(value.find("b")->asString() == "x\"\\\n\xc3\xa9\xf0\x9f\x98\x80");
        CHECK(value.find("c")->isObject());
        CHECK(Json::parse(value.dump()).dump() == value.dump());
        CHECK(Json(4294967295U).dump() == "4294967295");
        CHECK(Json(0.1).dump() == "0.10000000000000001");
        CHECK(Json(std::string("\x01")).dump() == "\"\\u0001\"");
        CHECK(throwsJsonError([] { Json::parse("{"); }));
        CHECK(throwsJsonError([] { Json::parse("[1,]"); }));
        CHECK(throwsJsonError([] { Json::parse("01x"); }));
        CHECK(throwsJsonError([] { Json::parse("\"\\ud800\""); }));
        CHECK(throwsJsonError([] { Json::parse(std::string(100, '[')); }));
        CHECK(throwsJsonError([] { Json::parse("{} {}"); }));
    }

    struct Pipe
    {
        NativeHandle read = 0;
        NativeHandle write = 0;
        Pipe()
        {
#if defined(_WIN32)
            HANDLE r = nullptr;
            HANDLE w = nullptr;
            CreatePipe(&r, &w, nullptr, 1 << 20);
            read = reinterpret_cast<NativeHandle>(r);
            write = reinterpret_cast<NativeHandle>(w);
#else
            int fds[2] = { -1, -1 };
            if (pipe(fds) == 0)
            {
                read = fds[0];
                write = fds[1];
            }
#endif
        }
        void closeWrite() const
        {
#if defined(_WIN32)
            CloseHandle(reinterpret_cast<HANDLE>(write));
#else
            close(static_cast<int>(write));
#endif
        }
        void writeRaw(const void* data, size_t size) const
        {
#if defined(_WIN32)
            DWORD written = 0;
            WriteFile(reinterpret_cast<HANDLE>(write), data, static_cast<DWORD>(size), &written, nullptr);
#else
            [[maybe_unused]] const auto written = ::write(static_cast<int>(write), data, size);
#endif
        }
    };

    void framing()
    {
        {
            Pipe pipe;
            FrameWriter writer(pipe.write);
            Json header = Json::object();
            header.set("id", 1);
            const std::vector<uint8_t> payload { 1, 2, 3, 4, 5 };
            std::thread producer(
                [&]
                {
                    writer.write(header, payload);
                    writer.write(Json::object());
                    pipe.closeWrite();
                });
            FrameReader reader(pipe.read, 1024, 1024);
            Frame frame;
            std::string error;
            CHECK(reader.read(frame, error) == FrameReader::Status::Frame);
            CHECK(frame.header.find("id")->asNumber() == 1);
            CHECK(frame.payload.size() == 5 && std::memcmp(frame.payload.data(), payload.data(), 5) == 0);
            CHECK(reader.read(frame, error) == FrameReader::Status::Frame);
            CHECK(frame.payload.size() == 0);
            CHECK(reader.read(frame, error) == FrameReader::Status::End);
            producer.join();
        }
        {
            // A payload over the limit is refused before it is read.
            Pipe pipe;
            const uint8_t prefix[12] = { 'S', 'V', 'H', '1', 2, 0, 0, 0, 0, 0, 1, 0 };
            pipe.writeRaw(prefix, sizeof prefix);
            pipe.closeWrite();
            FrameReader reader(pipe.read, 1024, 1024);
            Frame frame;
            std::string error;
            CHECK(reader.read(frame, error) == FrameReader::Status::Error);
            CHECK(error.find("exceeds") != std::string::npos);
        }
        {
            Pipe pipe;
            pipe.writeRaw("HTTP/1.1 200 OK\r\n", 17);
            pipe.closeWrite();
            FrameReader reader(pipe.read, 1024, 1024);
            Frame frame;
            std::string error;
            CHECK(reader.read(frame, error) == FrameReader::Status::Error);
            CHECK(error.find("magic") != std::string::npos);
        }
        {
            // Valid framing, invalid JSON: a frame with a null header.
            Pipe pipe;
            const uint8_t prefix[12] = { 'S', 'V', 'H', '1', 3, 0, 0, 0, 0, 0, 0, 0 };
            pipe.writeRaw(prefix, sizeof prefix);
            pipe.writeRaw("{x}", 3);
            pipe.closeWrite();
            FrameReader reader(pipe.read, 1024, 1024);
            Frame frame;
            std::string error;
            CHECK(reader.read(frame, error) == FrameReader::Status::Frame);
            CHECK(frame.header.isNull());
        }
    }

    void architectures()
    {
        const auto directory = std::filesystem::temp_directory_path() / "soundor-vst3-host-selftest";
        std::filesystem::create_directories(directory);
        auto write = [&](const char* name, std::vector<uint8_t> bytes)
        {
            bytes.resize(4096, 0);
            const auto path = directory / name;
            std::ofstream(path, std::ios::binary)
                .write(reinterpret_cast<const char*>(bytes.data()), static_cast<std::streamsize>(bytes.size()));
            return path.string();
        };
        std::vector<uint8_t> elf(64, 0);
        elf[0] = 0x7F;
        elf[1] = 'E';
        elf[2] = 'L';
        elf[3] = 'F';
        elf[18] = 0xB7;
        CHECK(binaryArchitectures(write("arm64.so", elf)) == std::vector<std::string> { "arm64" });
        elf[18] = 0x3E;
        CHECK(binaryArchitectures(write("x64.so", elf)) == std::vector<std::string> { "x64" });

        // A universal Mach-O with x86_64 and arm64 slices.
        std::vector<uint8_t> fat { 0xCA, 0xFE, 0xBA, 0xBE, 0, 0, 0, 2 };
        const uint8_t x64[20] = { 0x01, 0, 0, 0x07 };
        const uint8_t arm64[20] = { 0x01, 0, 0, 0x0C };
        fat.insert(fat.end(), x64, x64 + 20);
        fat.insert(fat.end(), arm64, arm64 + 20);
        CHECK((binaryArchitectures(write("universal", fat)) == std::vector<std::string> { "x64", "arm64" }));
        std::vector<uint8_t> thin { 0xCF, 0xFA, 0xED, 0xFE, 0x0C, 0, 0, 0x01 };
        CHECK(binaryArchitectures(write("thin", thin)) == std::vector<std::string> { "arm64" });

        std::vector<uint8_t> pe(0x100, 0);
        pe[0] = 'M';
        pe[1] = 'Z';
        pe[0x3C] = 0x80;
        pe[0x80] = 'P';
        pe[0x81] = 'E';
        pe[0x84] = 0x64;
        pe[0x85] = 0xAA;
        CHECK(binaryArchitectures(write("arm64.dll", pe)) == std::vector<std::string> { "arm64" });
        CHECK(binaryArchitectures(write("text", { 'h', 'i' })).empty());

        CHECK(checkBundle((directory / "missing.vst3").string()).code == "plugin-not-found");
        CHECK(checkBundle(write("plain.txt", {})).code == "invalid-bundle");
        std::filesystem::remove_all(directory);
    }
} // namespace

int main()
{
    json();
    framing();
    architectures();
    if (failures == 0)
        std::printf("soundor_vst3_host_selftest: all checks passed\n");
    return failures == 0 ? 0 : 1;
}
