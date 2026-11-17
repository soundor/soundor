#pragma once
#include <soundor/Abi.h>
#include <soundor/js/Events.h>

#include <cstdint>
#include <memory>

extern "C"
{
    struct SoundorMidiEvent
    {
        std::uint32_t sampleOffset = 0;
        std::uint8_t bytes[3] {};
        std::uint8_t source = 0;
    };
    struct SoundorMidiStatus
    {
        std::uint64_t dropped = 0;
        std::uint32_t reset = 0, reserved = 0;
    };
    void* soundor_midi_create(void*);
    void soundor_midi_destroy(void*);
    void soundor_midi_recover(void*);
    void soundor_midi_active(void*, bool);
    std::int32_t soundor_midi_send(void*, SoundorMidiEvent);
    bool soundor_midi_observe(void*, bool);
    std::uint32_t soundor_midi_read(void*, SoundorMidiEvent*, std::uint32_t, SoundorMidiStatus*);
    std::int32_t soundor_midi_input(void*, const SoundorMidiEvent*, std::uint32_t);
    std::uint32_t soundor_midi_output(void*, SoundorMidiEvent*, std::uint32_t);
    std::uint64_t soundor_midi_generation(void*);
}
static_assert(sizeof(SoundorMidiEvent) == 8);
namespace soundor::inline SOUNDOR_ABI_NAMESPACE::midi
{
    inline constexpr std::size_t capacity = 1024;
    struct Functions
    {
        void* (*create)(void*) = nullptr;
        void (*destroy)(void*) = nullptr;
        void (*recover)(void*) = nullptr;
        void (*active)(void*, bool) = nullptr;
        std::int32_t (*send)(void*, SoundorMidiEvent) = nullptr;
        bool (*observe)(void*, bool) = nullptr;
        std::uint32_t (*read)(void*, SoundorMidiEvent*, std::uint32_t, SoundorMidiStatus*) = nullptr;
        std::int32_t (*input)(void*, const SoundorMidiEvent*, std::uint32_t) = nullptr;
        std::uint32_t (*output)(void*, SoundorMidiEvent*, std::uint32_t) = nullptr;
        std::uint64_t (*generation)(void*) = nullptr;
    };
    inline Functions linkedMidi() noexcept
    {
        return { &soundor_midi_create, &soundor_midi_destroy,   &soundor_midi_recover, &soundor_midi_active,
                 &soundor_midi_send,   &soundor_midi_observe,   &soundor_midi_read,    &soundor_midi_input,
                 &soundor_midi_output, &soundor_midi_generation };
    }
    // Control-thread router: one Rust mailbox, the existing event hub fans
    // bounded batches out to editor contexts. Audio only uses Functions.
    class Host : public js::EventSource
    {
    public:
        Host(void* processor, Functions);
        ~Host();
        std::int32_t send(SoundorMidiEvent);
        bool observe(bool) noexcept;
        void pump();
        void recover();
        void active(bool);
        [[nodiscard]] std::uint64_t sequence() const noexcept;
        [[nodiscard]] std::uint64_t total() const noexcept;

    private:
        struct State;
        std::unique_ptr<State> state;
    };
    void install(js::Context&, std::shared_ptr<Host>);
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::midi
