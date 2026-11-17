#pragma once

#include <soundor/Abi.h>

// Private to the engine: a style's properties, as soundor:ui names them, read
// into a Style. Independent of where the properties come from, so that the
// JavaScript binding (UiModule.cpp) and the WebAssembly engine (wasm/) read
// them with the same rules: shorthands, units, colors and errors.

#include <soundor/ui/Style.h>

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
{
    // One property's value, as far as reading a style needs to know it.
    struct StyleValue
    {
        enum class Kind : std::uint8_t
        {
            Absent, // missing, undefined or null
            Number,
            String,
            Other, // a boolean, an object, ...
        };

        Kind kind = Kind::Absent;
        double number = 0;
        std::string text;

        [[nodiscard]] bool present() const noexcept { return kind != Kind::Absent; }
    };

    // Where a style's properties come from.
    class StyleSource
    {
    public:
        StyleSource() = default;
        StyleSource(const StyleSource&) = delete;
        StyleSource& operator=(const StyleSource&) = delete;
        virtual ~StyleSource() = default;

        // The value of `key`.
        [[nodiscard]] virtual StyleValue get(std::string_view key) const = 0;
        // `style.<key>`'s value is not what it should be: throws an error
        // saying "style.<key>: expected <expected>, got <the value>".
        [[noreturn]] virtual void fail(std::string_view key, std::string_view expected) = 0;
        // The structured properties, read in their place among the others
        // (so the first invalid property is the one reported).
        virtual std::vector<BoxShadow> boxShadow() = 0;
        virtual std::optional<Presentation> transform() = 0;
    };

    // Reads a style. Unknown keys are ignored; a known key with an invalid
    // value fails (StyleSource::fail()).
    [[nodiscard]] Style readStyle(StyleSource& source);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::ui
