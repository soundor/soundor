#pragma once

// A plugin's Rust controller (the project's native/ crate, when it exports
// one), called through its C ABI (RustControllerAbi.h): the engine's native
// side of the controller. Plain C++ and runtime-independent: a runtime gives
// it its services (ControllerServices) and a way to run it on the control
// thread (pump(), when woken), and installs its methods as `soundor:native`
// in each editor's JavaScript context (the generated installController()).

#include <soundor/Abi.h>
#include <soundor/processor/RustControllerAbi.h>

#include <chrono>
#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <span>
#include <string>
#include <string_view>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
{
    // The controller's C functions. The engine never names the symbols, so it
    // links without a Rust library; a plugin passes linkedRustController().
    struct RustControllerFunctions
    {
        std::int32_t (*info)(SoundorControllerInfo* info) = nullptr;
        void* (*create)(const SoundorControllerHost* host, void* processor) = nullptr;
        void (*destroy)(void* handle) = nullptr;
        std::int32_t (*call)(void* handle, std::uint32_t method, const std::uint8_t* args, std::size_t length,
                             SoundorWriter out) = nullptr;
        std::int32_t (*start)(void* handle, std::uint32_t method, std::uint64_t operation, const std::uint8_t* args,
                              std::size_t length, SoundorWriter error) = nullptr;
        void (*cancel)(void* handle, std::uint64_t operation) = nullptr;
        std::int32_t (*run)(void* handle, std::uint64_t* operation, SoundorWriter out) = nullptr;
    };

    // The functions of the Rust library linked into this binary (what
    // `soundor::export!` defines). Inline, so only a binary that calls it
    // needs the library.
    inline RustControllerFunctions linkedRustController() noexcept
    {
        return { &soundor_controller_info, &soundor_controller_create, &soundor_controller_destroy,
                 &soundor_controller_call, &soundor_controller_start,  &soundor_controller_cancel,
                 &soundor_controller_run };
    }

    // What a controller descriptor (@soundor/core's describeController())
    // says: the plugin's native methods and types, its parameter count and
    // state fields. Types are nodes, referred to by index.
    struct ControllerContract
    {
        // A type's tag, as the descriptor has it.
        enum class Tag : std::uint8_t
        {
            Void = 0,
            Boolean,
            String,
            Int8,
            Uint8,
            Int16,
            Uint16,
            Int32,
            Uint32,
            Int64,
            Uint64,
            Float32,
            Float64,
            Declared,
            Array,
            Buffer,
            Nullable,
        };

        struct Type
        {
            Tag tag = Tag::Void;
            // Declared: the type's index in `types`. Array, Nullable: the
            // element's node.
            std::uint32_t index = 0;
            // Buffer: the element's tag.
            Tag element = Tag::Void;
        };

        struct Field
        {
            std::string name;
            std::uint32_t type = 0;
        };

        struct Declared
        {
            bool isEnum = false;
            std::string name;
            std::vector<Field> fields;
            std::vector<std::string> values;
            // Views of `values`, for js::bind::readEnum.
            std::vector<std::string_view> valueViews;
        };

        struct Method
        {
            std::string name;
            bool async = false;
            std::vector<Field> args;
            std::uint32_t returns = 0;
        };

        std::uint32_t parameterCount = 0;
        std::vector<Declared> types;
        std::vector<Field> state;
        std::vector<Method> methods;
        std::vector<Type> nodes;

        // The contract `descriptor` describes, or nothing when it is not a
        // well-formed descriptor of this version.
        static std::optional<ControllerContract> parse(std::span<const std::uint8_t> descriptor);
    };

    // The runtime's services, which the controller's synchronous tasks use as
    // the UI does. Every function but wake() is called on the control thread,
    // from inside a controller call; a failure is an exception, whose message
    // the controller gets.
    class ControllerServices
    {
    public:
        enum class HistoryAction
        {
            Undo,
            Redo,
            CanUndo,
            CanRedo,
        };

        virtual ~ControllerServices() = default;

        // Any thread: asks for pump() soon, on the control thread. Never blocks.
        virtual void wake() noexcept = 0;

        // Parameter `index` (the config's order): its plain value, and an edit
        // as the UI makes one (constrained, in History, told to the host).
        virtual double parameter(std::uint32_t index) = 0;
        virtual void setParameter(std::uint32_t index, double plain) = 0;

        // State field `index` (the descriptor's order), as state JSON.
        virtual std::string state(std::uint32_t index) = 0;
        virtual void setState(std::uint32_t index, std::string_view json) = 0;

        // Undo, Redo: whether it did; the queries their answer.
        virtual bool history(HistoryAction action) = 0;

        virtual void loadPreset(std::string_view id) = 0;
    };

    // One plugin instance's Rust controller. Create, use and destroy it on the
    // control thread (the message thread); its services must outlive it.
    class RustController
    {
    public:
        // What a call came to: its encoded result, or its failure's message.
        struct Outcome
        {
            bool ok = false;
            std::vector<std::uint8_t> bytes;
            std::string message;
        };

        // Called on the control thread, from pump(); it must not throw.
        using Completion = std::function<void(Outcome)>;

        // `descriptor` is the runtime's generated one; `processor` the plugin
        // instance's Rust processor handle (RustProcessor::handle()), or null.
        RustController(std::span<const std::uint8_t> descriptor, const RustControllerFunctions& functions,
                       ControllerServices& owner, void* processor);
        ~RustController();
        RustController(const RustController&) = delete;
        RustController& operator=(const RustController&) = delete;
        RustController(RustController&&) = delete;
        RustController& operator=(RustController&&) = delete;

        // Whether the plugin's Rust crate exports a controller at all
        // (`export!(PluginProcessor, PluginController)`).
        [[nodiscard]] bool present() const noexcept { return exported; }
        // Whether it runs: it matched the descriptor and was created; when not,
        // error() says why, and every call fails with it.
        [[nodiscard]] bool active() const noexcept { return handle != nullptr; }
        [[nodiscard]] const std::string& error() const noexcept { return problem; }
        // The runtime's descriptor, parsed (empty when it was malformed).
        [[nodiscard]] const ControllerContract& contract() const noexcept { return described; }

        // A synchronous method, inside the caller's JavaScript call.
        Outcome call(std::uint32_t method, std::span<const std::uint8_t> args);

        // Starts an async method: `completion` is called from a later pump()
        // with its outcome, unless the operation is cancelled first. A
        // failure to start is returned, and `completion` dropped.
        Outcome start(std::uint32_t method, std::span<const std::uint8_t> args, Completion completion,
                      std::uint64_t& operation);

        // Its completion is never called, and the Rust future is dropped.
        void cancel(std::uint64_t operation);

        // Runs the controller's control queue, one item at a time (a
        // scheduled callback, or an async method's completion, delivered),
        // for at most `budget`, so that a busy controller never starves the
        // thread's other work. Returns whether it stopped with work left: the
        // caller runs it again at its next opportunity. Does nothing when
        // called during another pump().
        bool pump(std::chrono::nanoseconds budget = std::chrono::milliseconds(4));

        // Destroys the Rust controller: its queued callbacks never run, its
        // tasks are dropped and its worker joined, pending completions
        // discarded. Every later call fails. Idempotent; the destructor calls it.
        void shutdown() noexcept;

    private:
        RustControllerFunctions abi;
        ControllerServices& services;
        SoundorControllerHost host {};
        void* handle = nullptr;
        bool exported = false;
        bool pumping = false;
        std::string problem;
        ControllerContract described;
        std::uint64_t nextOperation = 0;
        std::map<std::uint64_t, Completion> completions;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::processor
