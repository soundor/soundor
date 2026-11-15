// What is specific to WebAssembly: the C functions the module exports, and
// the text engine that measures with the browser through the functions it
// imports (module "soundor"). web/src/engine.ts is the other side.

#include "Engine.h"

#include <soundor/ui/Text.h>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <new>
#include <optional>
#include <string>
#include <string_view>
#include <unordered_map>

extern "C"
{
    // The width of `text` on one line in the font, in CSS pixels.
    __attribute__((import_module("soundor"), import_name("measure"))) float
    soundor_import_measure(const char* family, std::size_t familyLength, float size, int weight, int italic,
                           const char* text, std::size_t length);
    // The font's ascent and descent, written to out[0] and out[1].
    __attribute__((import_module("soundor"), import_name("metrics"))) void
    soundor_import_metrics(const char* family, std::size_t familyLength, float size, int weight, int italic,
                           float* out);
}

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::wasm
{
    namespace
    {
        // Measures with the browser's fonts: what the DOM then draws. Line
        // breaking is the engine's (TextEngine::layout()), which measures a
        // line's candidates again and again while Yoga lays out, so each
        // width is remembered rather than asked for twice.
        class BrowserTextEngine final : public ui::TextEngine
        {
        public:
            float advance(std::string_view text, const ui::TextStyle& style) override
            {
                if (text.empty())
                    return 0;
                Font& font = fontOf(style);
                const auto found = font.advances.find(text);
                if (found != font.advances.end())
                    return found->second;
                float width = soundor_import_measure(style.fontFamily.data(), style.fontFamily.size(), style.fontSize,
                                                     style.fontWeight, italic(style), text.data(), text.size());
                // CSS's letter-spacing: after every character, the last too.
                if (style.letterSpacing != 0)
                    width += static_cast<float>(characters(text)) * style.letterSpacing;
                if (font.advances.size() >= maxAdvances)
                    font.advances.clear();
                font.advances.emplace(std::string(text), width);
                return width;
            }

            Metrics metrics(const ui::TextStyle& style) override
            {
                Font& font = fontOf(style);
                if (! font.measured)
                {
                    float out[2] = { 0, 0 };
                    soundor_import_metrics(style.fontFamily.data(), style.fontFamily.size(), style.fontSize,
                                           style.fontWeight, italic(style), out);
                    font.metrics = { out[0], out[1] };
                    font.measured = true;
                }
                return font.metrics;
            }

            // The page's fonts changed (a web font loaded): every width is
            // measured again. The browser registers fonts itself.
            std::optional<std::string> addFont(std::string_view, std::string_view, int, ui::FontStyle) override
            {
                fonts.clear();
                return std::nullopt;
            }

        private:
            static constexpr std::size_t maxAdvances = 4096;

            struct Hash
            {
                using is_transparent = void;
                std::size_t operator()(std::string_view text) const noexcept
                {
                    return std::hash<std::string_view> {}(text);
                }
            };

            struct Font
            {
                std::unordered_map<std::string, float, Hash, std::equal_to<>> advances;
                Metrics metrics;
                bool measured = false;
            };

            static int italic(const ui::TextStyle& style) noexcept
            {
                return style.fontStyle == ui::FontStyle::Italic ? 1 : 0;
            }

            static std::size_t characters(std::string_view text) noexcept
            {
                std::size_t count = 0;
                for (const char c : text)
                    if ((static_cast<unsigned char>(c) & 0xC0) != 0x80)
                        ++count;
                return count;
            }

            Font& fontOf(const ui::TextStyle& style)
            {
                std::string key = style.fontFamily;
                key += '\n';
                key += std::to_string(style.fontSize);
                key += '\n';
                key += std::to_string(style.fontWeight);
                key += italic(style) != 0 ? "i" : "n";
                return fonts[key];
            }

            std::unordered_map<std::string, Font> fonts;
        };
    } // namespace
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::wasm

using soundor::wasm::Engine;

extern "C"
{
    // A new engine; `browserText` 0 lays text out with the engine's
    // approximation (no imports called), as native tests do. Null when out of memory.
    __attribute__((export_name("soundor_engine_create"))) Engine* soundor_engine_create(int browserText)
    {
        try
        {
            std::shared_ptr<soundor::ui::TextEngine> text;
            if (browserText != 0)
                text = std::make_shared<soundor::wasm::BrowserTextEngine>();
            return new Engine(std::move(text));
        }
        catch (const std::exception&)
        {
            return nullptr;
        }
    }

    __attribute__((export_name("soundor_engine_destroy"))) void soundor_engine_destroy(Engine* engine)
    {
        delete engine;
    }

    // Where to write at least `size` bytes of commands; null when out of memory.
    __attribute__((export_name("soundor_engine_input"))) std::uint8_t* soundor_engine_input(Engine* engine,
                                                                                            std::size_t size)
    {
        try
        {
            return engine->input(size);
        }
        catch (const std::bad_alloc&)
        {
            return nullptr;
        }
    }

    // Runs commands, answering with a byte count, then records (Engine::apply()).
    __attribute__((export_name("soundor_engine_apply"))) const std::uint8_t* soundor_engine_apply(Engine* engine,
                                                                                                  std::size_t length)
    {
        try
        {
            return engine->apply(length);
        }
        catch (const std::exception&)
        {
            return nullptr;
        }
    }

    // Nodes alive in the engine, its root included.
    __attribute__((export_name("soundor_engine_nodes"))) std::size_t soundor_engine_nodes(const Engine* engine)
    {
        return engine->nodeCount();
    }
}
