#pragma once

// The C ABI between a native runtime and a plugin's Rust controller: what
// `soundor::export!(PluginProcessor, PluginController)` defines in the
// project's `native/` crate (the SDK's controller_ffi.rs and host.rs, whose
// #[repr(C)] structures these mirror field for field). The engine declares
// it and never calls these symbols itself: the plugin's binary links the
// library that defines them, and hands them to processor::RustController
// (linkedRustController() in RustController.h). `export!(PluginProcessor)`
// defines them too, reporting no controller.
//
// - Every structure starts with its size and the ABI version.
// - A controller is an opaque handle, one per plugin instance, from
//   soundor_controller_create, freed by soundor_controller_destroy. Every
//   call is on the control thread, one at a time.
// - Native method arguments and results cross in the controller's value
//   encoding (the SDK's wire.rs), described by the controller's descriptor
//   (@soundor/core's describeController()). Bytes for the other side go
//   through a SoundorWriter, which copies them: each side frees only its
//   own memory.
// - Nothing unwinds across the boundary: a Rust panic becomes a status, a
//   C++ exception in a host callback a failure.

#include <cstddef>
#include <cstdint>

// The version every controller structure carries, as the SDK's host.rs has it.
inline constexpr std::uint32_t SOUNDOR_CONTROLLER_ABI_VERSION = 1;

extern "C"
{
    // soundor_controller_call's and soundor_controller_start's status.
    enum SoundorControllerStatus : std::int32_t
    {
        SOUNDOR_CONTROLLER_OK = 0,
        // The method failed; its message was written.
        SOUNDOR_CONTROLLER_FAILED = 1,
        // No such method, the other kind (sync or async), or malformed arguments.
        SOUNDOR_CONTROLLER_INVALID = 2,
        SOUNDOR_CONTROLLER_PANICKED = 3,
        // A call during one of the controller's own calls.
        SOUNDOR_CONTROLLER_REENTRANT = 4,
        SOUNDOR_CONTROLLER_SHUT_DOWN = 5,
    };

    // What soundor_controller_run did.
    enum SoundorControllerRan : std::int32_t
    {
        SOUNDOR_CONTROLLER_RAN_NOTHING = 0,
        // One scheduled callback ran.
        SOUNDOR_CONTROLLER_RAN_TASK = 1,
        // An async method succeeded: its operation, its result written.
        SOUNDOR_CONTROLLER_RAN_COMPLETED = 2,
        // An async method failed: its operation, its message written.
        SOUNDOR_CONTROLLER_RAN_FAILED = 3,
        SOUNDOR_CONTROLLER_RAN_REENTRANT = 4,
    };

    // Receives bytes the other side writes, copied before the call returns.
    struct SoundorWriter
    {
        void* user;
        void (*write)(void* user, const std::uint8_t* data, std::size_t length);
    };

    // A History action of SoundorControllerHost::history.
    enum SoundorHistoryAction : std::uint32_t
    {
        SOUNDOR_HISTORY_UNDO = 0,
        SOUNDOR_HISTORY_REDO = 1,
        SOUNDOR_HISTORY_CAN_UNDO = 2,
        SOUNDOR_HISTORY_CAN_REDO = 3,
    };

    // The runtime's services. Every callback but wake runs on the control
    // thread; wake runs on any, until soundor_controller_destroy returns.
    struct SoundorControllerHost
    {
        std::uint32_t size;
        std::uint32_t abiVersion;
        void* user;
        // Asks for soundor_controller_run soon, on the control thread. Never blocks.
        void (*wake)(void* user);
        // Parameter `index`'s plain value, in the config's order.
        double (*parameterGet)(void* user, std::uint32_t index);
        // Edits parameter `index` as the UI does: 0, or nonzero when refused.
        std::int32_t (*parameterSet)(void* user, std::uint32_t index, double plain);
        // State field `index`'s value as state JSON, written to `out`: 0.
        std::int32_t (*stateGet)(void* user, std::uint32_t index, SoundorWriter out);
        // Sets state field `index` from its JSON: 0, or nonzero with the reason.
        std::int32_t (*stateSet)(void* user, std::uint32_t index, const std::uint8_t* json, std::size_t length,
                                 SoundorWriter error);
        // Undo and redo: 0, or nonzero when they failed; the queries 1 or 0.
        std::int32_t (*history)(void* user, std::uint32_t action);
        // Loads the factory preset `id` (UTF-8): 0, or nonzero with the reason.
        std::int32_t (*presetLoad)(void* user, const std::uint8_t* id, std::size_t length, SoundorWriter error);
    };

    struct SoundorControllerInfo
    {
        std::uint32_t size;
        std::uint32_t abiVersion;
        // 1 when the plugin exports a controller.
        std::uint32_t present;
        std::uint32_t methodCount;
        // Its descriptor, which the runtime compares with its own.
        const std::uint8_t* descriptor;
        std::size_t descriptorSize;
    };

    std::int32_t soundor_controller_info(SoundorControllerInfo* info);
    // `processor` is the plugin instance's processor handle (whose audio
    // resources the controller publishes to), or null.
    void* soundor_controller_create(const SoundorControllerHost* host, void* processor);
    void soundor_controller_destroy(void* handle);
    std::int32_t soundor_controller_call(void* handle, std::uint32_t method, const std::uint8_t* args,
                                         std::size_t length, SoundorWriter out);
    std::int32_t soundor_controller_start(void* handle, std::uint32_t method, std::uint64_t operation,
                                          const std::uint8_t* args, std::size_t length, SoundorWriter error);
    void soundor_controller_cancel(void* handle, std::uint64_t operation);
    std::int32_t soundor_controller_run(void* handle, std::uint64_t* operation, SoundorWriter out);
}
