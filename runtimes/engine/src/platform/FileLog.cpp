#include <soundor/platform/FileLog.h>

#include <cstdio>
#include <fstream>
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

    } // namespace

    js::LogSink fileLogSink(const std::filesystem::path& file, std::string source)
    {
        std::error_code ignored;
        std::filesystem::create_directories(file.parent_path(), ignored);
        // Append mode: every write lands at the end, after other writers'.
        auto out = std::make_shared<std::ofstream>(file, std::ios::binary | std::ios::app);
        return [out, source = std::move(source)](js::LogLevel level, std::string_view message)
        {
            if (! *out)
                return;
            std::string line = R"({"level":")";
            line += levelName(level);
            line += R"(","source":)";
            appendJsonString(line, source);
            line += R"(,"message":)";
            appendJsonString(line, message);
            line += "}\n";
            out->write(line.data(), static_cast<std::streamsize>(line.size()));
            out->flush();
        };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::platform
