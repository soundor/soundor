// UTF-8 for TextEncoder/TextDecoder, following the WHATWG Encoding Standard:
// lone surrogates encode as U+FFFD; invalid input decodes to U+FFFD per
// maximal subpart (or fails, in fatal mode).

#include "web/Functions.h"

#include <cstdint>
#include <span>
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

        std::size_t utf8Length(char32_t cp) { return cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4; }

        void appendUtf8(char32_t cp, std::uint8_t* out)
        {
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

        // The JavaScript string as UTF-16, freed with the holder.
        struct Utf16
        {
            Utf16(JSContext* context, JSValueConst value) : ctx(context)
            {
                data = JS_ToCStringLenUTF16(ctx, &length, value);
            }
            ~Utf16() { JS_FreeCStringUTF16(ctx, data); }
            Utf16(const Utf16&) = delete;
            Utf16& operator=(const Utf16&) = delete;

            [[nodiscard]] std::span<const std::uint16_t> units() const { return { data, length }; }

            JSContext* ctx;
            const std::uint16_t* data = nullptr;
            std::size_t length = 0;
        };

        // A writable view of a Uint8Array's bytes.
        bool bytesOf(JSContext* ctx, JSValueConst value, std::uint8_t*& data, std::size_t& size)
        {
            if (JS_GetTypedArrayType(value) != JS_TYPED_ARRAY_UINT8)
            {
                JS_ThrowTypeError(ctx, "expected a Uint8Array");
                return false;
            }
            std::size_t offset = 0;
            JSValue buffer = JS_GetTypedArrayBuffer(ctx, value, &offset, &size, nullptr);
            if (JS_IsException(buffer))
                return false;
            std::size_t bufferSize = 0;
            std::uint8_t* bytes = JS_GetArrayBuffer(ctx, &bufferSize, buffer);
            JS_FreeValue(ctx, buffer);
            if (bytes == nullptr && JS_HasException(ctx))
                return false;
            data = bytes != nullptr ? bytes + offset : nullptr;
            return true;
        }

        // encodeUtf8(string) → Uint8Array
        JSValue encodeUtf8(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            const Utf16 text(ctx, argc > 0 ? argv[0] : JS_UNDEFINED);
            if (text.data == nullptr)
                return JS_EXCEPTION;
            std::vector<std::uint8_t> bytes;
            bytes.reserve(text.length);
            forEachCodePoint(text.units(),
                             [&](char32_t cp, std::size_t)
                             {
                                 const std::size_t at = bytes.size();
                                 bytes.resize(at + utf8Length(cp));
                                 appendUtf8(cp, bytes.data() + at);
                                 return true;
                             });
            return js::bind::write(ctx, std::move(bytes));
        }

        // encodeUtf8Into(string, Uint8Array) → [read, written]
        JSValue encodeUtf8Into(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 2)
                return JS_ThrowTypeError(ctx, "encodeInto() expects a string and a Uint8Array");
            const Utf16 text(ctx, argv[0]);
            if (text.data == nullptr)
                return JS_EXCEPTION;
            std::uint8_t* out = nullptr;
            std::size_t capacity = 0;
            if (! bytesOf(ctx, argv[1], out, capacity))
                return JS_EXCEPTION;
            std::size_t read = 0;
            std::size_t written = 0;
            forEachCodePoint(text.units(),
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
            JSValue result = JS_NewArray(ctx);
            JS_SetPropertyUint32(ctx, result, 0, JS_NewFloat64(ctx, double(read)));
            JS_SetPropertyUint32(ctx, result, 1, JS_NewFloat64(ctx, double(written)));
            return result;
        }

        // decodeUtf8(Uint8Array, fatal, flush) → [string, bytes consumed]. When
        // not flushing, an incomplete sequence at the end is left unconsumed
        // for the next call (streaming).
        JSValue decodeUtf8(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 3)
                return JS_ThrowTypeError(ctx, "decodeUtf8() expects bytes, fatal and flush");
            std::uint8_t* data = nullptr;
            std::size_t size = 0;
            if (! bytesOf(ctx, argv[0], data, size))
                return JS_EXCEPTION;
            const bool fatal = JS_ToBool(ctx, argv[1]) != 0;
            const bool flush = JS_ToBool(ctx, argv[2]) != 0;

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
                            return JS_ThrowTypeError(ctx, "The encoded data was not valid UTF-8");
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
                        return JS_ThrowTypeError(ctx, "The encoded data was not valid UTF-8");
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
                        return JS_ThrowTypeError(ctx, "The encoded data was not valid UTF-8");
                    emit(replacement);
                }
            }

            JSValue text = JS_NewStringUTF16(ctx, units.data(), units.size());
            if (JS_IsException(text))
                return text;
            JSValue result = JS_NewArray(ctx);
            JS_SetPropertyUint32(ctx, result, 0, text);
            JS_SetPropertyUint32(ctx, result, 1, JS_NewFloat64(ctx, double(consumed)));
            return result;
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
