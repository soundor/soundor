// soundor:fs and soundor:storage: asynchronous file work on the worker thread,
// confined to the plugin's private data directory.
//
// <data>/files/        the root of soundor:fs (relative paths only)
// <data>/storage.json  soundor:storage, a JSON object of key → JSON text

#include "web/Functions.h"

#include <algorithm>
#include <chrono>
#include <cstdio>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <map>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <system_error>
#include <utility>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    namespace
    {
        namespace fs = std::filesystem;

        // UTF-8 text as a path (fs::u8path is deprecated in C++20).
        fs::path utf8Path(const std::string& text) { return fs::path(std::u8string(text.begin(), text.end())); }

        std::string utf8Name(const fs::path& path)
        {
            const auto name = path.filename().u8string();
            return { name.begin(), name.end() };
        }

        struct Failure
        {
            std::string kind; // "DOMException:<name>" or "TypeError"
            std::string message;
        };

        Failure failure(const std::error_code& error, const std::string& what)
        {
            const auto condition = error.default_error_condition();
            std::string name = "OperationError";
            if (condition == std::errc::no_such_file_or_directory)
                name = "NotFoundError";
            else if (condition == std::errc::permission_denied || condition == std::errc::operation_not_permitted
                     || condition == std::errc::read_only_file_system)
                name = "NotAllowedError";
            else if (condition == std::errc::file_exists || condition == std::errc::directory_not_empty)
                name = "InvalidModificationError";
            else if (condition == std::errc::is_a_directory || condition == std::errc::not_a_directory)
                name = "TypeMismatchError";
            else if (condition == std::errc::no_space_on_device)
                name = "QuotaExceededError";
            return { "DOMException:" + name, what + ": " + error.message() };
        }

        // ── Paths ────────────────────────────────────────────────────────────

        // Validates a soundor:fs path: relative, '/'-separated, staying inside
        // the root. Returns the normalized relative path ("" for the root).
        std::optional<std::string> normalizeRelative(const std::string& path, std::string& problem)
        {
            if (path.find('\0') != std::string::npos || path.find('\\') != std::string::npos)
            {
                problem = "paths use '/' and cannot contain backslashes or NUL";
                return std::nullopt;
            }
            if (path.starts_with('/') || (path.size() >= 2 && path[1] == ':'))
            {
                problem = "paths are relative to the plugin's data directory";
                return std::nullopt;
            }
            std::vector<std::string> parts;
            std::size_t start = 0;
            while (start <= path.size())
            {
                const std::size_t end = std::min(path.find('/', start), path.size());
                const std::string segment = path.substr(start, end - start);
                if (segment == "..")
                {
                    problem = "paths cannot leave the plugin's data directory";
                    return std::nullopt;
                }
                if (! segment.empty() && segment != ".")
                    parts.push_back(segment);
                start = end + 1;
            }
            std::string normalized;
            for (const auto& part : parts)
                normalized += (normalized.empty() ? "" : "/") + part;
            return normalized;
        }

        // The absolute path for `relative`, or nullopt if symlinks would lead
        // it out of the root. Runs on the worker (touches the disk).
        std::optional<fs::path> resolveInside(const fs::path& root, const std::string& relative)
        {
            std::error_code error;
            fs::create_directories(root, error);
            const fs::path canonicalRoot = fs::weakly_canonical(root, error);
            if (error)
                return std::nullopt;
            const fs::path target = fs::weakly_canonical(root / utf8Path(relative), error);
            if (error)
                return std::nullopt;
            const auto [rootEnd, unused] = std::mismatch(canonicalRoot.begin(), canonicalRoot.end(), target.begin(),
                                                         target.end());
            (void)unused;
            if (rootEnd != canonicalRoot.end())
                return std::nullopt;
            return target;
        }

        // Writes via a temporary sibling and a rename, so a crash never leaves
        // a half-written file.
        std::error_code writeAtomically(const fs::path& target, const std::vector<std::uint8_t>& bytes)
        {
            std::error_code error;
            fs::create_directories(target.parent_path(), error);
            if (error)
                return error;
            fs::path temporary = target;
            temporary += ".soundor-tmp";
            {
                std::ofstream out(temporary, std::ios::binary | std::ios::trunc);
                if (! out)
                    return std::make_error_code(std::errc::permission_denied);
                out.write(reinterpret_cast<const char*>(bytes.data()), std::streamsize(bytes.size()));
                if (! out.flush())
                    return std::make_error_code(std::errc::io_error);
            }
            fs::rename(temporary, target, error);
            if (error)
                fs::remove(temporary);
            return error;
        }

        std::variant<std::vector<std::uint8_t>, std::error_code> readAll(const fs::path& path)
        {
            std::error_code error;
            if (fs::is_directory(path, error))
                return std::make_error_code(std::errc::is_a_directory);
            std::ifstream in(path, std::ios::binary);
            if (! in)
                return fs::exists(path, error) ? std::make_error_code(std::errc::permission_denied)
                                               : std::make_error_code(std::errc::no_such_file_or_directory);
            return std::vector<std::uint8_t>(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
        }

        // ── Results ──────────────────────────────────────────────────────────

        struct Entry
        {
            std::string name;
            bool directory = false;
        };

        struct Stat
        {
            bool directory = false;
            std::uintmax_t size = 0;
            double modified = 0; // ms since the Unix epoch
        };

        using FsResult = std::variant<std::monostate, std::vector<std::uint8_t>, std::vector<Entry>,
                                      std::optional<Stat>, Failure>;

        JSValue toJs(JSContext* ctx, FsResult&& result)
        {
            if (auto* bytes = std::get_if<std::vector<std::uint8_t>>(&result))
                return js::bind::write(ctx, std::move(*bytes));
            if (auto* entries = std::get_if<std::vector<Entry>>(&result))
                return js::bind::writeArray(ctx, std::move(*entries),
                                            [](JSContext* c, Entry&& entry)
                                            {
                                                js::bind::ObjectBuilder object(c);
                                                object.set("name", js::bind::write(c, entry.name));
                                                object.set("kind", js::bind::write(c, std::string(entry.directory
                                                                                                      ? "directory"
                                                                                                      : "file")));
                                                return object.release();
                                            });
            if (auto* stat = std::get_if<std::optional<Stat>>(&result))
            {
                if (! stat->has_value())
                    return JS_NULL;
                js::bind::ObjectBuilder object(ctx);
                object.set("kind", js::bind::write(ctx, std::string((*stat)->directory ? "directory" : "file")));
                object.set("size", JS_NewFloat64(ctx, double((*stat)->size)));
                object.set("modified", JS_NewFloat64(ctx, (*stat)->modified));
                return object.release();
            }
            return JS_UNDEFINED;
        }

        double modifiedMs(const fs::path& path)
        {
            std::error_code error;
            const auto time = fs::last_write_time(path, error);
            if (error)
                return 0;
            // file_clock → system_clock without clock_cast (not portable yet).
            const auto system = std::chrono::system_clock::now()
                                 + std::chrono::duration_cast<std::chrono::system_clock::duration>(
                                     time - fs::file_time_type::clock::now());
            return double(std::chrono::duration_cast<std::chrono::milliseconds>(system.time_since_epoch()).count());
        }

        FsResult runFsOperation(const std::string& kind, const fs::path& root, const std::string& relative,
                                const std::vector<std::uint8_t>& data, bool recursive)
        {
            const auto target = resolveInside(root, relative);
            if (! target)
                return Failure { "DOMException:NotAllowedError", "'" + relative + "' leads outside the data directory" };
            std::error_code error;
            if (kind == "readBytes")
            {
                auto read = readAll(*target);
                if (auto* code = std::get_if<std::error_code>(&read))
                    return failure(*code, "cannot read '" + relative + "'");
                return std::get<std::vector<std::uint8_t>>(std::move(read));
            }
            if (kind == "writeBytes")
            {
                if (relative.empty())
                    return Failure { "DOMException:TypeMismatchError", "cannot write to the root directory" };
                if (const auto code = writeAtomically(*target, data))
                    return failure(code, "cannot write '" + relative + "'");
                return std::monostate {};
            }
            if (kind == "readDir")
            {
                std::vector<Entry> entries;
                for (fs::directory_iterator it(*target, error), end; ! error && it != end; it.increment(error))
                {
                    const std::string name = utf8Name(it->path());
                    if (name.ends_with(".soundor-tmp"))
                        continue;
                    entries.push_back({ name, it->is_directory(error) });
                }
                if (error)
                    return failure(error, "cannot list '" + relative + "'");
                std::sort(entries.begin(), entries.end(),
                          [](const Entry& a, const Entry& b) { return a.name < b.name; });
                return entries;
            }
            if (kind == "mkdir")
            {
                if (recursive)
                    fs::create_directories(*target, error);
                else if (! fs::create_directory(*target, error) && ! error)
                    error = std::make_error_code(std::errc::file_exists);
                if (error)
                    return failure(error, "cannot create '" + relative + "'");
                return std::monostate {};
            }
            if (kind == "remove")
            {
                if (relative.empty())
                    return Failure { "DOMException:NotAllowedError", "cannot remove the root directory" };
                if (! fs::exists(*target, error))
                    return failure(std::make_error_code(std::errc::no_such_file_or_directory),
                                   "cannot remove '" + relative + "'");
                if (recursive)
                    fs::remove_all(*target, error);
                else
                    fs::remove(*target, error);
                if (error)
                    return failure(error, "cannot remove '" + relative + "'");
                return std::monostate {};
            }
            if (kind == "stat")
            {
                const auto status = fs::status(*target, error);
                if (error || ! fs::exists(status))
                    return std::optional<Stat> {};
                Stat stat;
                stat.directory = fs::is_directory(status);
                stat.size = stat.directory ? 0 : fs::file_size(*target, error);
                stat.modified = modifiedMs(*target);
                return std::optional<Stat> { stat };
            }
            return Failure { "TypeError", "unknown file operation '" + kind + "'" };
        }

        // ── Storage file ─────────────────────────────────────────────────────

        // Every runtime in the process using one storage file shares one lock
        // (two instances of the same plugin in one host).
        std::mutex& lockFor(const fs::path& file)
        {
            static std::mutex registryLock;
            static std::map<fs::path, std::mutex> locks;
            const std::lock_guard guard(registryLock);
            return locks[file];
        }

        void appendJsonString(std::string& out, const std::string& text)
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

        // Parses the storage file: a JSON object whose values are strings.
        // Anything else (a corrupt or foreign file) yields nullopt.
        class StorageParser
        {
        public:
            explicit StorageParser(const std::string& input) : text(input) {}

            std::optional<std::map<std::string, std::string>> parse()
            {
                std::map<std::string, std::string> entries;
                skipSpace();
                if (! consume('{'))
                    return std::nullopt;
                skipSpace();
                if (consume('}'))
                    return entries;
                for (;;)
                {
                    skipSpace();
                    auto key = string();
                    skipSpace();
                    if (! key || ! consume(':'))
                        return std::nullopt;
                    skipSpace();
                    auto value = string();
                    if (! value)
                        return std::nullopt;
                    entries[*key] = *value;
                    skipSpace();
                    if (consume('}'))
                        break;
                    if (! consume(','))
                        return std::nullopt;
                }
                skipSpace();
                return at == text.size() ? std::optional(entries) : std::nullopt;
            }

        private:
            void skipSpace()
            {
                while (at < text.size() && (text[at] == ' ' || text[at] == '\n' || text[at] == '\r' || text[at] == '\t'))
                    ++at;
            }

            bool consume(char c)
            {
                if (at < text.size() && text[at] == c)
                {
                    ++at;
                    return true;
                }
                return false;
            }

            std::optional<unsigned> hex4()
            {
                if (at + 4 > text.size())
                    return std::nullopt;
                unsigned value = 0;
                for (int i = 0; i < 4; ++i)
                {
                    const char c = text[at++];
                    value <<= 4;
                    if (c >= '0' && c <= '9')
                        value |= unsigned(c - '0');
                    else if (c >= 'a' && c <= 'f')
                        value |= unsigned(c - 'a' + 10);
                    else if (c >= 'A' && c <= 'F')
                        value |= unsigned(c - 'A' + 10);
                    else
                        return std::nullopt;
                }
                return value;
            }

            void appendUtf8(std::string& out, char32_t cp)
            {
                if (cp < 0x80)
                    out += char(cp);
                else if (cp < 0x800)
                {
                    out += char(0xC0 | (cp >> 6));
                    out += char(0x80 | (cp & 0x3F));
                }
                else if (cp < 0x10000)
                {
                    out += char(0xE0 | (cp >> 12));
                    out += char(0x80 | ((cp >> 6) & 0x3F));
                    out += char(0x80 | (cp & 0x3F));
                }
                else
                {
                    out += char(0xF0 | (cp >> 18));
                    out += char(0x80 | ((cp >> 12) & 0x3F));
                    out += char(0x80 | ((cp >> 6) & 0x3F));
                    out += char(0x80 | (cp & 0x3F));
                }
            }

            std::optional<std::string> string()
            {
                if (! consume('"'))
                    return std::nullopt;
                std::string out;
                while (at < text.size())
                {
                    const char c = text[at++];
                    if (c == '"')
                        return out;
                    if (c != '\\')
                    {
                        out += c;
                        continue;
                    }
                    if (at >= text.size())
                        return std::nullopt;
                    switch (text[at++])
                    {
                        case '"':
                            out += '"';
                            break;
                        case '\\':
                            out += '\\';
                            break;
                        case '/':
                            out += '/';
                            break;
                        case 'b':
                            out += '\b';
                            break;
                        case 'f':
                            out += '\f';
                            break;
                        case 'n':
                            out += '\n';
                            break;
                        case 'r':
                            out += '\r';
                            break;
                        case 't':
                            out += '\t';
                            break;
                        case 'u':
                        {
                            auto unit = hex4();
                            if (! unit)
                                return std::nullopt;
                            char32_t cp = *unit;
                            if (cp >= 0xD800 && cp <= 0xDBFF && at + 6 <= text.size() && text[at] == '\\'
                                && text[at + 1] == 'u')
                            {
                                at += 2;
                                auto low = hex4();
                                if (! low)
                                    return std::nullopt;
                                cp = 0x10000 + ((cp - 0xD800) << 10) + (*low - 0xDC00);
                            }
                            appendUtf8(out, cp);
                            break;
                        }
                        default:
                            return std::nullopt;
                    }
                }
                return std::nullopt;
            }

            const std::string& text;
            std::size_t at = 0;
        };

        std::variant<std::map<std::string, std::string>, Failure> loadStorage(const fs::path& file)
        {
            std::error_code error;
            if (! fs::exists(file, error))
                return std::map<std::string, std::string> {};
            auto read = readAll(file);
            if (auto* code = std::get_if<std::error_code>(&read))
                return failure(*code, "cannot read plugin storage");
            const auto& bytes = std::get<std::vector<std::uint8_t>>(read);
            auto parsed = StorageParser(std::string(bytes.begin(), bytes.end())).parse();
            if (! parsed)
                return Failure { "DOMException:DataError", "the plugin's storage file is corrupt" };
            return *parsed;
        }

        std::error_code saveStorage(const fs::path& file, const std::map<std::string, std::string>& entries)
        {
            std::string out = "{";
            bool first = true;
            for (const auto& [key, value] : entries)
            {
                out += first ? "\n  " : ",\n  ";
                first = false;
                appendJsonString(out, key);
                out += ": ";
                appendJsonString(out, value);
            }
            out += first ? "}\n" : "\n}\n";
            return writeAtomically(file, std::vector<std::uint8_t>(out.begin(), out.end()));
        }

        using StorageResult = std::variant<std::monostate, std::optional<std::string>, std::vector<std::string>, Failure>;

        StorageResult runStorageOperation(const std::string& kind, const fs::path& file, const std::string& key,
                                          const std::string& value)
        {
            const std::lock_guard lock(lockFor(file));
            auto loaded = loadStorage(file);
            if (auto* problem = std::get_if<Failure>(&loaded))
                return *problem;
            auto& entries = std::get<std::map<std::string, std::string>>(loaded);
            if (kind == "get")
            {
                const auto it = entries.find(key);
                return it == entries.end() ? std::optional<std::string> {} : std::optional(it->second);
            }
            if (kind == "keys")
            {
                std::vector<std::string> keys;
                for (const auto& [name, unused] : entries)
                    keys.push_back(name);
                return keys;
            }
            if (kind == "set")
                entries[key] = value;
            else if (kind == "delete")
                entries.erase(key);
            else if (kind == "clear")
                entries.clear();
            else
                return Failure { "TypeError", "unknown storage operation '" + kind + "'" };
            if (const auto error = saveStorage(file, entries))
                return failure(error, "cannot write plugin storage");
            return std::monostate {};
        }

        JSValue toJs(JSContext* ctx, StorageResult&& result)
        {
            if (auto* value = std::get_if<std::optional<std::string>>(&result))
                return value->has_value() ? js::bind::write(ctx, **value) : JS_UNDEFINED;
            if (auto* keys = std::get_if<std::vector<std::string>>(&result))
                return js::bind::writeArray(ctx, std::move(*keys),
                                            [](JSContext* c, std::string&& key) { return js::bind::write(c, key); });
            return JS_UNDEFINED;
        }

        // ── JavaScript entry points ──────────────────────────────────────────

        std::string text(JSContext* ctx, JSValueConst value)
        {
            std::size_t length = 0;
            const char* chars = JS_ToCStringLen(ctx, &length, value);
            if (chars == nullptr)
                return {};
            std::string result(chars, length);
            JS_FreeCString(ctx, chars);
            return result;
        }

        template <typename Result, typename Work>
        JSValue startFileOperation(JSContext* ctx, const char* name, Work&& work)
        {
            auto* state = stateOf(ctx);
            if (state == nullptr)
                return JS_ThrowInternalError(ctx, "the Soundor platform layer is not installed");
            std::uint64_t id = 0;
            JSValue promise = state->beginOperation(ctx, name, id);
            if (JS_IsException(promise))
                return promise;
            if (state->services.dataDirectory.empty())
            {
                state->reject(id, "DOMException:NotAllowedError", "this plugin has no data directory");
                return promise;
            }
            state->worker().post(
                [completions = state->completions, id, work = std::forward<Work>(work)]() mutable
                {
                    Result result = work();
                    completions->post(
                        [id, result = std::move(result)](State& ui, JSContext*) mutable
                        {
                            if (auto* problem = std::get_if<Failure>(&result))
                                ui.reject(id, problem->kind, problem->message);
                            else
                                ui.resolve(id, [&](JSContext* c) { return toJs(c, std::move(result)); });
                        });
                });
            return promise;
        }

        // fsOperation(kind, path, data: Uint8Array | null, recursive: boolean)
        JSValue fsOperation(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 4)
                return JS_ThrowInternalError(ctx, "fsOperation() misused");
            const std::string kind = text(ctx, argv[0]);
            const std::string path = text(ctx, argv[1]);
            std::vector<std::uint8_t> data;
            if (! JS_IsNull(argv[2]))
            {
                std::span<const std::uint8_t> bytes;
                if (! js::bind::read(ctx, argv[2], js::bind::Path { "soundor:fs" }, bytes))
                    return JS_EXCEPTION;
                data.assign(bytes.begin(), bytes.end());
            }
            const bool recursive = JS_ToBool(ctx, argv[3]) != 0;
            std::string problem;
            const auto relative = normalizeRelative(path, problem);
            if (! relative)
                return JS_ThrowTypeError(ctx, "Invalid path '%s': %s", path.c_str(), problem.c_str());

            auto* state = stateOf(ctx);
            const fs::path root = state != nullptr && ! state->services.dataDirectory.empty()
                                      ? state->services.dataDirectory / "files"
                                      : fs::path();
            return startFileOperation<FsResult>(
                ctx, "soundor:fs", [kind, root, relative = *relative, data = std::move(data), recursive]
                { return runFsOperation(kind, root, relative, data, recursive); });
        }

        // storageOperation(kind, key, value)
        JSValue storageOperation(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 3)
                return JS_ThrowInternalError(ctx, "storageOperation() misused");
            auto* state = stateOf(ctx);
            const fs::path file =
                state != nullptr && ! state->services.dataDirectory.empty()
                    ? state->services.dataDirectory / "storage.json"
                    : fs::path();
            return startFileOperation<StorageResult>(
                ctx, "soundor:storage",
                [kind = text(ctx, argv[0]), file, key = text(ctx, argv[1]), value = text(ctx, argv[2])]
                { return runStorageOperation(kind, file, key, value); });
        }
    } // namespace

    std::vector<NativeFunction> fileFunctions()
    {
        return {
            { "fsOperation", fsOperation, 4 },
            { "storageOperation", storageOperation, 3 },
        };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
