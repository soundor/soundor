#pragma once

#include <soundor/Abi.h>
#include <soundor/ui/Surface.h>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <vector>

// The WebAssembly engine's C++ side: a ui::Surface driven by batches of
// commands, answering with what changed in its layout. Plain C++ (Exports.cpp
// holds what is specific to WebAssembly), so native tests run it too. The
// encoding is described in wasm/README.md and written by web/src/protocol.ts.
namespace soundor::inline SOUNDOR_ABI_NAMESPACE::wasm
{
    // Commands: each a 32-bit word, then its operands.
    enum class Command : std::uint32_t
    {
        Create = 1,  // handle, type (0 view, 1 text)
        Release = 2, // handle
        Insert = 3,  // parent, child, before (0: at the end)
        Remove = 4,  // parent, child
        Style = 5,   // handle, count, then each property: key, kind, value
        Text = 6,    // handle, string
        Size = 7,    // width, height (f32)
        Scale = 8,   // scale (f32)
        Layout = 9,  // lays out, and reports what changed
    };

    // Records of the answer: each a 32-bit word, then its fields.
    enum class Record : std::uint32_t
    {
        Error = 1, // command index, kind (1 TypeError, 2 Error), string
        Frame = 2, // handle, x, y, left, top, width, height, border top, right, bottom, left
        Text = 3,  // handle, font size, weight, italic, family, line count, lines (start, end, x, y, width, height)
    };

    // A property's value kind in a Style command.
    enum class ValueKind : std::uint32_t
    {
        Number = 1, // f64
        String = 2, // string
        Other = 3,  // string: how JavaScript shows it, for error messages
    };

    // The handle of the surface's root.
    inline constexpr std::uint32_t rootHandle = 1;

    class CommandReader;

    class Engine
    {
    public:
        explicit Engine(std::shared_ptr<ui::TextEngine> text = nullptr);

        // At least `size` bytes to write commands into (valid until the next call).
        [[nodiscard]] std::uint8_t* input(std::size_t size);
        // Runs `length` bytes of commands from input(). The answer: a byte
        // count of what follows, then records. A failing command is reported
        // and skipped, the others run.
        [[nodiscard]] const std::uint8_t* apply(std::size_t length);

        [[nodiscard]] ui::Surface& surface() noexcept { return ui; }
        // Nodes alive, the root included.
        [[nodiscard]] std::size_t nodeCount() const noexcept;

    private:
        struct Reported
        {
            bool frame = false;
            std::vector<std::uint32_t> frameWords;
            std::vector<std::uint32_t> textWords;
        };

        void run(Command command, CommandReader& reader);
        void report();
        [[nodiscard]] ui::NodeId node(std::uint32_t handle) const;

        ui::Surface ui;
        // By handle: its node (ui::noNode: none) and what was last reported of it.
        std::vector<ui::NodeId> nodes;
        std::vector<Reported> reported;
        std::vector<std::uint8_t> commands;
        std::vector<std::uint32_t> answer;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::wasm
