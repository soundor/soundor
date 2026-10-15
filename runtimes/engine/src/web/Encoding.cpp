// UTF-8 for TextEncoder/TextDecoder, following the WHATWG Encoding Standard:
// lone surrogates encode as U+FFFD; invalid input decodes to U+FFFD per
// maximal subpart (or fails, in fatal mode).

#include "web/Functions.h"

#include <cstdint>
#include <span>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    namespace
    {
        constexpr char32_t replacement = 0xFFFD;

        // Calls emit(code point, UTF-16 units consumed) for each code point.
        template <typename Emit>
        void forEachCodePoint(std::span<const std::uint16_t> units, Emit&& emit)
        {
            for (std::size_t i = 0; i < units.size();)
            {
                const char32_t unit = units[i];
                if (unit >= 0xD800 && unit <= 0xDBFF && i + 1 < units.size() && units[i + 1] >= 0xDC00
                    && units[i + 1] <= 0xDFFF)
                {
                    const char32_t low = units[i + 1];
                    if (! emit(0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00), 2))
                        return;
                    i += 2;
                    continue;
                }
                const bool loneSurrogate = unit >= 0xD800 && unit <= 0xDFFF;
                if (! emit(loneSurrogate ? replacement : unit, 1))
                    return;
                ++i;
            }
        }

        std::size_t utf8Length(char32_t cp)
        {
            return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
        }

        void appendUtf8(char32_t cp, std::uint8_t* out)
        {
            if (out == nullptr)
                return;
            if (cp < 0x80)
            {
                out[0] = std::uint8_t(cp);
            }
            else if (cp < 0x800)
            {
                out[0] = std::uint8_t(0xC0 | (cp >> 6));
                out[1] = std::uint8_t(0x80 | (cp & 0x3F));
            }
            else if (cp < 0x10000)
            {
                out[0] = std::uint8_t(0xE0 | (cp >> 12));
                out[1] = std::uint8_t(0x80 | ((cp >> 6) & 0x3F));
                out[2] = std::uint8_t(0x80 | (cp & 0x3F));
            }
            else
            {
                out[0] = std::uint8_t(0xF0 | (cp >> 18));
                out[1] = std::uint8_t(0x80 | ((cp >> 12) & 0x3F));
                out[2] = std::uint8_t(0x80 | ((cp >> 6) & 0x3F));
                out[3] = std::uint8_t(0x80 | (cp & 0x3F));
            }
        }

        namespace bind = js::bind;
        using bind::ContextState;

        // String(value) as UTF-16 code units.
        std::u16string utf16Of(ContextState& context, const jsi::Value& value)
        {
            if (value.isString())
                return value.getString(context.rt).utf16(context.rt);
            return value.toString(context.rt).utf16(context.rt);
        }

        std::span<const std::uint16_t> unitsOf(const std::u16string& text)
        {
            return { reinterpret_cast<const std::uint16_t*>(text.data()), text.size() };
        }

        // A writable view of a Uint8Array's bytes (nullptr when it has none).
        void bytesOf(ContextState& context, const jsi::Value& value, std::uint8_t*& data, std::size_t& size)
        {
            facebook::hermes::soundor::BufferView view;
            if (! bind::bufferView(context, value, view)
                || view.kind != facebook::hermes::soundor::TypedArrayKind::Uint8)
                bind::throwTypeError(context, "expected a Uint8Array");
            if (view.detached)
                bind::throwTypeError(context, "ArrayBuffer is detached");
            data = view.data;
            size = view.byteLength;
        }

        jsi::Value pair(ContextState& context, jsi::Value first, jsi::Value second)
        {
            jsi::Array result(context.rt, 2);
            result.setValueAtIndex(context.rt, 0, first);
            result.setValueAtIndex(context.rt, 1, second);
            return result;
        }

        // encodeUtf8(string) → Uint8Array
        jsi::Value encodeUtf8(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            const std::u16string text = utf16Of(context, bind::argument(args, count, 0));
            std::vector<std::uint8_t> bytes;
            bytes.reserve(text.size());
            forEachCodePoint(unitsOf(text),
                             [&](char32_t cp, std::size_t)
                             {
                                 const std::size_t at = bytes.size();
                                 bytes.resize(at + utf8Length(cp));
                                 appendUtf8(cp, bytes.data() + at);
                                 return true;
                             });
            return bind::write(context, std::move(bytes));
        }

        // encodeUtf8Into(string, Uint8Array) → [read, written]
        jsi::Value encodeUtf8Into(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count < 2)
                bind::throwTypeError(context, "encodeInto() expects a string and a Uint8Array");
            const std::u16string text = utf16Of(context, args[0]);
            std::uint8_t* out = nullptr;
            std::size_t capacity = 0;
            bytesOf(context, args[1], out, capacity);
            if (out == nullptr)
                capacity = 0; // an empty view has no storage to write to
            std::size_t read = 0;
            std::size_t written = 0;
            forEachCodePoint(unitsOf(text),
                             [&](char32_t cp, std::size_t units)
                             {
                                 const std::size_t needed = utf8Length(cp);
                                 if (written + needed > capacity)
                                     return false; // only whole code points
                                 appendUtf8(cp, out + written);
                                 written += needed;
                                 read += units;
                                 return true;
                             });
            return pair(context, jsi::Value(double(read)), jsi::Value(double(written)));
        }

        // decodeUtf8(Uint8Array, fatal, flush) → [string, bytes consumed]. When
        // not flushing, an incomplete sequence at the end is left unconsumed
        // for the next call (streaming).
        jsi::Value decodeUtf8(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count < 3)
                bind::throwTypeError(context, "decodeUtf8() expects bytes, fatal and flush");
            std::uint8_t* data = nullptr;
            std::size_t size = 0;
            bytesOf(context, args[0], data, size);
            const bool fatal = bind::toBoolean(context, args[1]);
            const bool flush = bind::toBoolean(context, args[2]);
            if (data == nullptr)
                size = 0; // an empty view has no storage

            std::vector<std::uint16_t> units;
            units.reserve(size);
            const auto emit = [&](char32_t cp)
            {
                if (cp >= 0x10000)
                {
                    cp -= 0x10000;
                    units.push_back(std::uint16_t(0xD800 + (cp >> 10)));
                    units.push_back(std::uint16_t(0xDC00 + (cp & 0x3FF)));
                }
                else
                {
                    units.push_back(std::uint16_t(cp));
                }
            };

            char32_t codePoint = 0;
            int bytesNeeded = 0;
            int bytesSeen = 0;
            std::uint8_t lower = 0x80;
            std::uint8_t upper = 0xBF;
            std::size_t sequenceStart = 0;
            std::size_t consumed = size;
            for (std::size_t i = 0; i < size; ++i)
            {
                const std::uint8_t byte = data[i];
                if (bytesNeeded == 0)
                {
                    sequenceStart = i;
                    if (byte <= 0x7F)
                    {
                        emit(byte);
                        continue;
                    }
                    if (byte >= 0xC2 && byte <= 0xDF)
                    {
                        bytesNeeded = 1;
                        codePoint = byte & 0x1F;
                    }
                    else if (byte >= 0xE0 && byte <= 0xEF)
                    {
                        if (byte == 0xE0)
                            lower = 0xA0;
                        if (byte == 0xED)
                            upper = 0x9F;
                        bytesNeeded = 2;
                        codePoint = byte & 0xF;
                    }
                    else if (byte >= 0xF0 && byte <= 0xF4)
                    {
                        if (byte == 0xF0)
                            lower = 0x90;
                        if (byte == 0xF4)
                            upper = 0x8F;
                        bytesNeeded = 3;
                        codePoint = byte & 0x7;
                    }
                    else
                    {
                        if (fatal)
                            bind::throwTypeError(context, "The encoded data was not valid UTF-8");
                        emit(replacement);
                    }
                    continue;
                }
                if (byte < lower || byte > upper)
                {
                    // Invalid continuation: replace the partial sequence and
                    // reprocess this byte as a new start.
                    codePoint = 0;
                    bytesNeeded = bytesSeen = 0;
                    lower = 0x80;
                    upper = 0xBF;
                    if (fatal)
                        bind::throwTypeError(context, "The encoded data was not valid UTF-8");
                    emit(replacement);
                    --i;
                    continue;
                }
                lower = 0x80;
                upper = 0xBF;
                codePoint = (codePoint << 6) | (byte & 0x3F);
                if (++bytesSeen == bytesNeeded)
                {
                    emit(codePoint);
                    codePoint = 0;
                    bytesNeeded = bytesSeen = 0;
                }
            }
            if (bytesNeeded != 0)
            {
                if (! flush)
                {
                    consumed = sequenceStart;
                }
                else
                {
                    if (fatal)
                        bind::throwTypeError(context, "The encoded data was not valid UTF-8");
                    emit(replacement);
                }
            }

            return pair(
                context,
                jsi::String::createFromUtf16(context.rt, reinterpret_cast<const char16_t*>(units.data()), units.size()),
                jsi::Value(double(consumed)));
        }
    } // namespace

    std::vector<NativeFunction> encodingFunctions()
    {
        return {
            { "encodeUtf8", encodeUtf8, 1 },
            { "encodeUtf8Into", encodeUtf8Into, 2 },
            { "decodeUtf8", decodeUtf8, 3 },
        };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
