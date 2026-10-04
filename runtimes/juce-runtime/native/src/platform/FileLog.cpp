#include <soundor/platform/FileLog.h>

#include <cstdio>
#include <memory>
#include <system_error>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
{
    namespace
    {
        void appendJsonString(std::string& out, std::string_view text)
        {
            out += '"';
            for (const char c : text)
            {
                switch (c)
                {
                    case '"':
                        out += "\\\"";
                        break;
                    case '\\':
                        out += "\\\\";
                        break;
                    case '\n':
                        out += "\\n";
                        break;
                    case '\r':
                        out += "\\r";
                        break;
                    case '\t':
                        out += "\\t";
                        break;
                    default:
                        if (static_cast<unsigned char>(c) < 0x20)
                        {
                            char escaped[8];
                            std::snprintf(escaped, sizeof escaped, "\\u%04x", unsigned(c));
                            out += escaped;
                        }
                        else
                        {
                            out += c;
                        }
                }
            }
            out += '"';
        }

        const char* levelName(js::LogLevel level)
        {
            switch (level)
            {
                case js::LogLevel::Debug:
                    return "debug";
                case js::LogLevel::Info:
                    return "info";
                case js::LogLevel::Warn:
                    return "warn";
                case js::LogLevel::Error:
                    return "error";
            }
            return "info";
        }

        struct FileCloser
        {
            void operator()(std::FILE* file) const noexcept { std::fclose(file); }
        };
    } // namespace

    js::LogSink fileLogSink(const std::filesystem::path& file, std::string source)
    {
        std::error_code ignored;
        std::filesystem::create_directories(file.parent_path(), ignored);
#if defined(_WIN32)
        std::shared_ptr<std::FILE> handle(_wfopen(file.c_str(), L"ab"), FileCloser {});
#else
        std::shared_ptr<std::FILE> handle(std::fopen(file.c_str(), "ab"), FileCloser {});
#endif
        return [handle, source = std::move(source)](js::LogLevel level, std::string_view message)
        {
            if (handle == nullptr)
                return;
            std::string line = R"({"level":")";
            line += levelName(level);
            line += R"(","source":)";
            appendJsonString(line, source);
            line += R"(,"message":)";
            appendJsonString(line, message);
            line += "}\n";
            std::fwrite(line.data(), 1, line.size(), handle.get());
            std::fflush(handle.get());
        };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
