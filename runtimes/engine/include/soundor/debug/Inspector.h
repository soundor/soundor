#pragma once

#include <soundor/Abi.h>
#include <soundor/Config.h>

#if SOUNDOR_DEVTOOLS
    #include <soundor/runtime/RuntimeHost.h>

    #include <cstdint>
    #include <deque>
    #include <functional>
    #include <map>
    #include <optional>
    #include <set>
    #include <stdexcept>
    #include <string>
    #include <string_view>
    #include <type_traits>
    #include <utility>
    #include <variant>
    #include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
{
    class Compositor;
    struct Capabilities;
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::render
namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
{
    // Explicit protocol data only. No engine objects or JSI values cross IPC.
    struct Value
    {
        using Object = std::map<std::string, Value>;
        using Array = std::vector<Value>;
        std::variant<std::nullptr_t, bool, double, std::string, Object, Array> data = nullptr;
        Value() = default;
        Value(std::nullptr_t) {}                                 // NOLINT(google-explicit-constructor)
        Value(bool value) : data(value) {}                       // NOLINT(google-explicit-constructor)
        Value(double value) : data(value) {}                     // NOLINT(google-explicit-constructor)
        Value(float value) : data(static_cast<double>(value)) {} // NOLINT(google-explicit-constructor)
        template <typename T>
            requires(std::is_integral_v<T> && ! std::is_same_v<T, bool>)
        Value(T value) : data(static_cast<double>(value))
        {
        } // NOLINT(google-explicit-constructor)
        Value(std::string value) : data(std::move(value)) {}   // NOLINT(google-explicit-constructor)
        Value(const char* value) : data(std::string(value)) {} // NOLINT(google-explicit-constructor)
        Value(Object value) : data(std::move(value)) {}        // NOLINT(google-explicit-constructor)
        Value(Array value) : data(std::move(value)) {}         // NOLINT(google-explicit-constructor)
        [[nodiscard]] std::string json() const;
        // Reads JSON text (at most 64 levels deep); nothing for anything else.
        [[nodiscard]] static std::optional<Value> parse(std::string_view json);
    };

    struct Command
    {
        std::string id;
        std::string method;
        unsigned generation = 0;
        unsigned targetGeneration = 0;
        ui::NodeId node = ui::noNode;
        bool enabled = false;
        bool nodeRequested = false;
        std::set<std::string> events;
        // The request's parameters, for methods with more than a node.
        Value::Object params;
        // A runtime command of the protocol (`runtimeCommandSchema`), as a
        // runtime bridge receives it; nothing when it is not one.
        [[nodiscard]] static std::optional<Command> parse(const Value& value);
    };

    // A command the instance refuses, with the protocol's error code.
    struct CommandError : std::runtime_error
    {
        CommandError(std::string errorCode, const std::string& message)
            : std::runtime_error(message), code(std::move(errorCode))
        {
        }
        std::string code;
    };

    // Adapter dispatches on the owning UI thread. Contains only node IDs,
    // generations and plain results; never retains the reloaded host/surface.
    class Inspector
    {
    public:
        using Send = std::function<void(std::string)>;
        // A response with a binary attachment (a capture's PNG), which the
        // bridge uploads for request `id` before sending `response`.
        using Attach = std::function<void(std::string id, std::vector<std::uint8_t> attachment, std::string response)>;
        using Clock = std::function<std::chrono::steady_clock::time_point()>;
        explicit Inspector(Send output, Clock time = std::chrono::steady_clock::now)
            : send(std::move(output)), clock(std::move(time))
        {
        }
        // Lets this instance answer Capture.screenshot; without it captures
        // are unavailable.
        void attachments(Attach output) { attach = std::move(output); }
        void tick(RuntimeHost& host, unsigned generation);
        void execute(RuntimeHost& host, const Command& command);
        void reset(ui::Surface& surface);
        [[nodiscard]] bool recording() const noexcept { return profiling; }
        void renderFrame(RuntimeHost& host, render::Compositor& compositor, const render::Capabilities& capabilities);
        [[nodiscard]] Value animations(RuntimeHost& host, ui::NodeId filter = ui::noNode) const;
        [[nodiscard]] Value metrics(bool history = true) const;
        bool pointer(ui::Surface& surface, const ui::PointerInput& input);
        bool key(ui::Surface& surface, const ui::KeyInput& input);
        [[nodiscard]] bool picking() const noexcept { return picker; }
        [[nodiscard]] Value tree(RuntimeHost& host) const;
        [[nodiscard]] Value node(RuntimeHost& host, ui::NodeId id, bool details = true) const;
        // The pointer synthetic input uses: its own, so its presses, hover
        // and capture never mix with the real mouse's (pointer 1).
        static constexpr int automationPointer = 32000;
        // Whether synthetic input holds a button or a key down.
        [[nodiscard]] bool holdingInput() const noexcept { return synthetic.buttons != 0 || ! synthetic.keys.empty(); }

    private:
        struct SyntheticInput
        {
            bool present = false;
            ui::Point position;
            unsigned buttons = 0;
            std::set<std::string> keys;
        };
        // Capture.screenshot: the view as the engine's renderer draws it, as
        // PNG; fills `result` with its description.
        std::vector<std::uint8_t> capture(RuntimeHost& host, const Command& command, Value::Object& result) const;
        Attach attach;
        // UI.hitTest and Input.*: through the Surface's own dispatch, as a
        // platform's input, never by calling application handlers.
        Value input(RuntimeHost& host, const Command& command);
        // Releases what synthetic input holds (a pointercancel, key ups), or
        // forgets it without dispatching when its surface is gone.
        void resetInput(ui::Surface* surface);
        SyntheticInput synthetic;
        void event(const std::string& name, Value data, bool force = false) const;
        void resetPicker(ui::Surface& surface);
        void profileTick(RuntimeHost& host);
        Send send;
        Clock clock;
        unsigned currentGeneration = 1;
        std::set<std::string> subscribed;
        std::set<int> suppressedPointers;
        bool picker = false;
        bool escapeHeld = false;
        ui::NodeId pressed = ui::noNode;
        std::uint64_t revision = 0;
        std::uint64_t structureRevision = 0;
        ui::NodeId lastFocus = ui::noNode;
        std::chrono::steady_clock::time_point nextNotification;
        std::chrono::steady_clock::time_point nextAnimationNotification;
        bool profiling = false;
        std::uint64_t frameCount = 0;
        std::uint64_t delayedTicks = 0;
        double tickIntervalMs = 0;
        double elapsedMs = 0;
        Value::Object phases;
        RuntimeHost::Statistics previousStatistics;
        std::deque<Value> frames;
        std::chrono::steady_clock::time_point recordingStarted;
        std::chrono::steady_clock::time_point previousTick;
        std::chrono::steady_clock::time_point previousSample;
        std::chrono::steady_clock::time_point previousFrameSample;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::debug
#endif
