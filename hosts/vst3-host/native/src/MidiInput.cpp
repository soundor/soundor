#include "MidiInput.h"

#include "Plugin.h"

#include <charconv>
#include <cstdio>
#include <stdexcept>
#if defined(__linux__)
    #include <alsa/asoundlib.h>
#endif
namespace soundor::vst3host
{
    struct MidiInput::State
    {
        EventLoop& loop;
        Plugin& plugin;
        EventLoop::Id timer = 0;
        std::optional<std::string> selected;
        std::string error;
#if defined(__linux__)
        snd_seq_t* seq = nullptr;
        int port = -1, client = -1, source = -1;
        bool open()
        {
            if (seq != nullptr)
                return true;
            const auto result = snd_seq_open(&seq, "default", SND_SEQ_OPEN_INPUT, SND_SEQ_NONBLOCK);
            if (result < 0)
            {
                error = snd_strerror(result);
                seq = nullptr;
                return false;
            }
            snd_seq_set_client_name(seq, "Soundor VST3 Host");
            port = snd_seq_create_simple_port(seq, "MIDI input", SND_SEQ_PORT_CAP_WRITE | SND_SEQ_PORT_CAP_SUBS_WRITE,
                                              SND_SEQ_PORT_TYPE_APPLICATION | SND_SEQ_PORT_TYPE_MIDI_GENERIC);
            if (port < 0)
            {
                error = snd_strerror(port);
                snd_seq_close(seq);
                seq = nullptr;
                return false;
            }
            snd_seq_connect_from(seq, port, SND_SEQ_CLIENT_SYSTEM, SND_SEQ_PORT_SYSTEM_ANNOUNCE);
            return true;
        }
        void poll()
        {
            // Bounded control-thread work. Physical input joins the existing
            // next-block queue; it never calls the plugin's audio processing.
            for (int i = 0; i < 1024; ++i)
            {
                snd_seq_event_t* event = nullptr;
                const auto result = snd_seq_event_input(seq, &event);
                if (result == -EAGAIN)
                    return;
                if (result < 0 || event == nullptr)
                {
                    if (plugin.loaded())
                        plugin.reset();
                    return;
                }
                if ((event->type == SND_SEQ_EVENT_PORT_EXIT || event->type == SND_SEQ_EVENT_CLIENT_EXIT)
                    && event->data.addr.client == client
                    && (event->type == SND_SEQ_EVENT_CLIENT_EXIT || event->data.addr.port == source))
                {
                    selected.reset();
                    client = -1;
                    source = -1;
                    if (plugin.loaded())
                        plugin.reset();
                    error = "Selected MIDI input disconnected; processor reset";
                }
                Json message = Json::object();
                int channel = 0;
                if (event->type == SND_SEQ_EVENT_CONTROLLER || event->type == SND_SEQ_EVENT_PITCHBEND
                    || event->type == SND_SEQ_EVENT_CHANPRESS || event->type == SND_SEQ_EVENT_PGMCHANGE)
                    channel = event->data.control.channel;
                bool supported = true;
                switch (event->type)
                {
                    case SND_SEQ_EVENT_NOTEON:
                    case SND_SEQ_EVENT_NOTEOFF:
                    case SND_SEQ_EVENT_KEYPRESS:
                        channel = event->data.note.channel;
                        message.set("type", event->type == SND_SEQ_EVENT_NOTEON    ? "noteOn"
                                            : event->type == SND_SEQ_EVENT_NOTEOFF ? "noteOff"
                                                                                   : "polyPressure");
                        message.set("pitch", event->data.note.note);
                        message.set(event->type == SND_SEQ_EVENT_KEYPRESS ? "pressure" : "velocity",
                                    static_cast<double>(event->data.note.velocity) / 127.0);
                        break;
                    case SND_SEQ_EVENT_CONTROLLER:
                        message.set("type", "controlChange");
                        message.set("controller", event->data.control.param);
                        message.set("value", event->data.control.value / 127.0);
                        break;
                    case SND_SEQ_EVENT_PITCHBEND:
                        message.set("type", "pitchBend");
                        message.set("value", 2.0 * (event->data.control.value + 8192) / 16383.0 - 1.0);
                        break;
                    case SND_SEQ_EVENT_CHANPRESS:
                        message.set("type", "channelPressure");
                        message.set("value", event->data.control.value / 127.0);
                        break;
                    case SND_SEQ_EVENT_PGMCHANGE:
                        message.set("type", "programChange");
                        message.set("program", event->data.control.value);
                        break;
                    default:
                        supported = false;
                        break;
                }
                snd_seq_free_event(event);
                if (! supported || ! plugin.loaded())
                    continue;
                message.set("channel", channel);
                Json events = Json::array();
                events.push(std::move(message));
                Json request = Json::object();
                request.set("events", std::move(events));
                try
                {
                    const auto response = plugin.queueMidi(request);
                    const auto* warnings = response.find("warnings");
                    if (warnings != nullptr && ! warnings->asArray().empty())
                        error = warnings->asArray().front().asString();
                }
                catch (const std::exception& failure)
                {
                    error = failure.what();
                    if (plugin.loaded())
                        plugin.reset();
                }
            }
            // A source that outruns the bounded queue must not strand held notes.
            snd_seq_drop_input(seq);
            if (plugin.loaded())
                plugin.reset();
        }
#endif
        State(EventLoop& eventLoop, Plugin& target) : loop(eventLoop), plugin(target) {}
        void close()
        {
            if (timer != 0)
            {
                loop.removeTimer(timer);
                timer = 0;
            }
#if defined(__linux__)
            if (seq != nullptr)
            {
                if (client >= 0)
                    snd_seq_disconnect_from(seq, port, client, source);
                snd_seq_close(seq);
                seq = nullptr;
            }
#endif
            if (selected && plugin.loaded())
                plugin.reset();
            selected.reset();
        }
        ~State()
        {
            try
            {
                close();
            }
            catch (...)
            {
                std::fputs("MIDI input shutdown: plugin reset failed after MIDI handles were closed\n", stderr);
            }
        }
    };
    MidiInput::MidiInput(EventLoop& loop, Plugin& plugin) : state_(std::make_unique<State>(loop, plugin)) {}
    MidiInput::~MidiInput() = default;
    Json MidiInput::devices()
    {
        Json result = Json::object();
        Json devices = Json::array();
#if defined(__linux__)
        result.set("supported", true);
        if (state_->open())
        {
            snd_seq_client_info_t* clients = nullptr;
            snd_seq_port_info_t* ports = nullptr;
            snd_seq_client_info_alloca(&clients);
            snd_seq_port_info_alloca(&ports);
            snd_seq_client_info_set_client(clients, -1);
            while (snd_seq_query_next_client(state_->seq, clients) >= 0)
            {
                const auto client = snd_seq_client_info_get_client(clients);
                if (client == snd_seq_client_id(state_->seq))
                    continue;
                snd_seq_port_info_set_client(ports, client);
                snd_seq_port_info_set_port(ports, -1);
                while (snd_seq_query_next_port(state_->seq, ports) >= 0)
                {
                    const auto caps = snd_seq_port_info_get_capability(ports);
                    if ((caps & (SND_SEQ_PORT_CAP_READ | SND_SEQ_PORT_CAP_SUBS_READ))
                        != (SND_SEQ_PORT_CAP_READ | SND_SEQ_PORT_CAP_SUBS_READ))
                        continue;
                    Json entry = Json::object();
                    entry.set("id", std::to_string(client) + ":" + std::to_string(snd_seq_port_info_get_port(ports)));
                    entry.set("name", std::string(snd_seq_client_info_get_name(clients)) + " / "
                                          + snd_seq_port_info_get_name(ports));
                    devices.push(std::move(entry));
                }
            }
        }
#else
        result.set("supported", false);
        state_->error =
            "Physical MIDI input is available through ALSA on Linux; this platform supports virtual input only";
#endif
        result.set("devices", std::move(devices));
        if (! state_->error.empty())
            result.set("error", state_->error);
        const auto selected = state_->selected;
        result.set("selected", selected.has_value() ? Json(selected.value()) : Json());
        return result;
    }
    Json MidiInput::select(std::optional<std::string> id)
    {
        state_->close();
        if (! id)
            return devices();
#if defined(__linux__)
        if (! state_->open())
            throw Failure("midi-unavailable", state_->error);
        const auto colon = id->find(':');
        int client = -1, port = -1;
        if (colon == std::string::npos)
            throw Failure("invalid-request", "MIDI input id must be client:port");
        const auto a = std::from_chars(id->data(), id->data() + colon, client);
        const auto b = std::from_chars(id->data() + colon + 1, id->data() + id->size(), port);
        if (a.ec != std::errc() || a.ptr != id->data() + colon || b.ec != std::errc()
            || b.ptr != id->data() + id->size() || client < 0 || port < 0)
            throw Failure("invalid-request", "Invalid ALSA MIDI input id");
        const auto result = snd_seq_connect_from(state_->seq, state_->port, client, port);
        if (result < 0)
            throw Failure("midi-unavailable", snd_strerror(result));
        state_->client = client;
        state_->source = port;
        state_->selected = std::move(id);
        state_->timer = state_->loop.addTimer(5,
                                              [this]
                                              {
                                                  try
                                                  {
                                                      state_->poll();
                                                  }
                                                  catch (const std::exception& failure)
                                                  {
                                                      state_->error = failure.what();
                                                  }
                                              });
        return devices();
#else
        throw Failure("midi-unavailable", "Physical MIDI input is unsupported on this platform");
#endif
    }
} // namespace soundor::vst3host
