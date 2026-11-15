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
        Create = 1,       // handle, type (NodeKind)
        Release = 2,      // handle
        Insert = 3,       // parent, child, before (0: at the end)
        Remove = 4,       // parent, child
        Style = 5,        // handle, count, then each property: key, value (ValueKind, then its data)
        Text = 6,         // handle, string (text and input nodes)
        Size = 7,         // width, height (f32)
        Scale = 8,        // scale (f32)
        Layout = 9,       // lays out, and reports what changed
        Placeholder = 10, // handle, string (input nodes)
        Natural = 11,     // handle, width, height (f32): an image's, canvas's or SVG's natural size
        Fonts = 12,       // the browser's fonts changed: text is measured again
        Extent = 13,      // handle: reports its Extent now, whether or not it scrolls
        Check = 14,       // count, then properties, as Style: reads the style, refusing it if invalid
    };

    // The node types JavaScript creates (soundor:ui's).
    enum class NodeKind : std::uint32_t
    {
        View = 0,
        Text = 1,
        Image = 2,
        Input = 3,
        Canvas = 4,
        Svg = 5,
    };

    // Records of the answer: each a 32-bit word, then its fields.
    enum class Record : std::uint32_t
    {
        Error = 1,  // command index, kind (1 TypeError, 2 Error), string
        Frame = 2,  // handle, x, y, left, top, width, height, border top, right, bottom, left,
                    // padding top, right, bottom, left
        Text = 3,   // handle, font size, weight, italic, family, line height, content top in the view,
                    // line count, lines (start, end, x, y, width, height)
        Extent = 4, // handle, content width, height, client width, height
    };

    // A property's value in a Style command, and what nests in it.
    enum class ValueKind : std::uint32_t
    {
        Number = 1,  // f64
        String = 2,  // string
        Other = 3,   // string: how JavaScript shows it (String()); string: its type, as errors name it
        Boolean = 4, // word (0, 1)
        Array = 5,   // string: String(); count, then each value
        Object = 6,  // string: String(); count, then each key and value
    };

    // The handles of the surface's roots: the content, and the overlay layer.
    inline constexpr std::uint32_t rootHandle = 1;
    inline constexpr std::uint32_t overlayHandle = 2;

    class CommandReader;
    class NaturalSizes;

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
        // Nodes alive, the roots included.
        [[nodiscard]] std::size_t nodeCount() const noexcept;

    private:
        struct Reported
        {
            bool frame = false;
            std::vector<std::uint32_t> frameWords;
            std::vector<std::uint32_t> textWords;
            std::vector<std::uint32_t> extentWords;
        };

        void run(Command command, CommandReader& reader);
        void report();
        void reportExtent(std::uint32_t handle, bool always);
        [[nodiscard]] ui::NodeId node(std::uint32_t handle) const;

        // What images, canvases and SVGs measure by (they are image nodes
        // here: the browser has their pixels, the engine their box).
        std::shared_ptr<NaturalSizes> naturals;
        ui::Surface ui;
        // By handle: its node (ui::noNode: none), its type, and what was last reported of it.
        std::vector<ui::NodeId> nodes;
        std::vector<NodeKind> kinds;
        std::vector<Reported> reported;
        std::vector<std::uint8_t> commands;
        std::vector<std::uint32_t> answer;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::wasm
