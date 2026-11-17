#include "../support/Modules.h"

#include <soundor/js/Context.h>
#include <soundor/js/Events.h>
#include <soundor/midi/Midi.h>

#include <doctest/doctest.h>

#include <algorithm>
#include <memory>
#include <string>
#include <vector>
using namespace soundor;
namespace
{
    struct Endpoint
    {
        std::vector<SoundorMidiEvent> sent, published;
        bool observed = false;
        int result = 0, recoveries = 0;
        static midi::Functions functions()
        {
            midi::Functions f;
            f.create = [](void* data) { return data; };
            f.destroy = [](void*) {};
            f.recover = [](void* data) { ++static_cast<Endpoint*>(data)->recoveries; };
            f.active = [](void*, bool) {};
            f.send = [](void* data, SoundorMidiEvent event)
            {
                auto& endpoint = *static_cast<Endpoint*>(data);
                endpoint.sent.push_back(event);
                return endpoint.result;
            };
            f.observe = [](void* data, bool enabled)
            {
                static_cast<Endpoint*>(data)->observed = enabled;
                return true;
            };
            f.read = [](void* data, SoundorMidiEvent* records, std::uint32_t, SoundorMidiStatus* status)
            {
                auto& endpoint = *static_cast<Endpoint*>(data);
                std::copy(endpoint.published.begin(), endpoint.published.end(), records);
                const auto count = static_cast<std::uint32_t>(endpoint.published.size());
                endpoint.published.clear();
                *status = {};
                return count;
            };
            return f;
        }
    };
    struct MidiFixture
    {
        Endpoint endpoint;
        std::shared_ptr<midi::Host> host = std::make_shared<midi::Host>(&endpoint, Endpoint::functions());
        js::Runtime runtime;
        js::Context context { runtime };
        MidiFixture() { midi::install(context, host); }
        void run(const std::string& body)
        {
            const auto result =
                context.evaluateModule(test::module("import { midi } from 'soundor:midi';\n" + body), "/midi-test.js");
            REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
        }
        std::string text(const std::string& expression)
        {
            const auto result = context.evaluateScript(expression);
            REQUIRE_MESSAGE(result.ok(), (result.ok() ? "" : result.error().toString()));
            return result.value().asString();
        }
    };
} // namespace
TEST_SUITE("MIDI module")
{
    TEST_CASE("validates all channel messages without normalizing Note On zero")
    {
        MidiFixture f;
        f.run(R"(
          globalThis.results = [
            midi.send({type:'noteOn',channel:16,note:127,velocity:0}),
            midi.send({type:'noteOff',channel:1,note:0,velocity:127}),
            midi.send({type:'controlChange',channel:1,controller:127,value:127}),
            midi.send({type:'pitchBend',channel:1,value:16383}),
            midi.send({type:'programChange',channel:1,program:127}),
            midi.send({type:'channelPressure',channel:1,pressure:127}),
            midi.send({type:'polyphonicAftertouch',channel:1,note:127,pressure:127})
          ];
          globalThis.rejected = 0;
          for (const message of [{type:'noteOn',channel:0,note:60,velocity:1}, {type:'noteOn',channel:1,note:128,velocity:1}, {type:'pitchBend',channel:1,value:16384}]) {
            try { midi.send(message); } catch (_) { rejected++; }
          }
        )");
        REQUIRE(f.endpoint.sent.size() == 7);
        CHECK(f.endpoint.sent[0].bytes[0] == 0x9f);
        CHECK(f.endpoint.sent[0].bytes[2] == 0);
        CHECK(f.endpoint.sent[3].bytes[1] == 127);
        CHECK(f.endpoint.sent[3].bytes[2] == 127);
        CHECK(f.text("JSON.stringify([results,rejected])")
              == "[[\"sent\",\"sent\",\"sent\",\"sent\",\"sent\",\"sent\",\"sent\"],3]");
    }
    TEST_CASE("explicit publications wait for UI delivery and unsubscribe")
    {
        MidiFixture f;
        f.run("globalThis.batches=[]; globalThis.stop=midi.subscribeBatch(batch=>batches.push(batch));");
        REQUIRE(f.endpoint.observed);
        f.endpoint.published.push_back({ 17, { 0x90, 60, 0 }, 1 });
        f.host->pump();
        CHECK(f.text("JSON.stringify(batches)") == "[]");
        js::deliverEvents(f.context);
        CHECK(f.text("JSON.stringify(batches[0].events[0])")
              == "{\"message\":{\"type\":\"noteOn\",\"channel\":1,\"note\":60,\"velocity\":0},\"sampleOffset\":17,"
                 "\"source\":\"host\"}");
        REQUIRE(f.context.evaluateScript("stop()").ok());
        CHECK_FALSE(f.endpoint.observed);
    }
    TEST_CASE("bounded editor fanout detects a lost batch and recovers display state")
    {
        MidiFixture f;
        f.run("globalThis.batches=[]; midi.subscribeBatch(batch=>batches.push(batch));");
        for (int i = 0; i < 9; ++i)
        {
            f.endpoint.published.push_back({ 0, { 0x90, 60, 100 }, 1 });
            f.host->pump();
        }
        js::deliverEvents(f.context);
        f.host->pump(); // Heartbeat makes loss observable even when no further notes arrive.
        js::deliverEvents(f.context);
        CHECK(f.text("JSON.stringify([batches.length,batches[8].reset,batches[8].dropped,batches[8].events])")
              == "[9,true,1,[]]");
    }
}
