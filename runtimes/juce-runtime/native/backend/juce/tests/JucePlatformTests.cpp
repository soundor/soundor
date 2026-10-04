// JUCE platform adapters: transport capture, host info, and HTTP through a
// real socket.

#define DOCTEST_CONFIG_IMPLEMENT

#include <soundor/backend/JuceHttpClient.h>
#include <soundor/backend/JuceTransport.h>
#include <soundor/runtime/RuntimeHost.h>

#include <doctest/doctest.h>
#include <juce_audio_processors/juce_audio_processors.h>

#include <atomic>
#include <chrono>
#include <string>
#include <thread>

using namespace soundor;

namespace
{
    struct ScriptedPlayHead final : juce::AudioPlayHead
    {
        juce::Optional<PositionInfo> getPosition() const override { return position; }
        juce::Optional<PositionInfo> position;
    };

    // Serves one HTTP request on localhost, recording it.
    class OneShotServer
    {
    public:
        explicit OneShotServer(std::string reply) : response(std::move(reply))
        {
            REQUIRE(listener.createListener(0, "127.0.0.1"));
            thread = std::thread([this] { serve(); });
        }
        ~OneShotServer()
        {
            listener.close();
            thread.join();
        }
        OneShotServer(const OneShotServer&) = delete;
        OneShotServer& operator=(const OneShotServer&) = delete;

        [[nodiscard]] std::string url(const std::string& path) const
        {
            return "http://127.0.0.1:" + std::to_string(listener.getBoundPort()) + path;
        }

        std::string request;

    private:
        void serve()
        {
            std::unique_ptr<juce::StreamingSocket> client(listener.waitForNextConnection());
            if (client == nullptr)
                return;
            char buffer[4096];
            while (request.find("\r\n\r\n") == std::string::npos)
            {
                const int read = client->read(buffer, sizeof buffer, false);
                if (read <= 0)
                    return;
                request.append(buffer, std::size_t(read));
            }
            const auto lengthAt = request.find("Content-Length: ");
            if (lengthAt != std::string::npos)
            {
                const auto length = std::stoul(request.substr(lengthAt + 16));
                while (request.size() < request.find("\r\n\r\n") + 4 + length)
                {
                    const int read = client->read(buffer, sizeof buffer, false);
                    if (read <= 0)
                        break;
                    request.append(buffer, std::size_t(read));
                }
            }
            client->write(response.data(), int(response.size()));
        }

        juce::StreamingSocket listener;
        std::string response;
        std::thread thread;
    };

    struct FetchFixture
    {
        FetchFixture() : host(makeOptions()) {}

        static RuntimeHost::Options makeOptions()
        {
            RuntimeHost::Options options;
            options.http = std::make_shared<backend::JuceHttpClient>();
            return options;
        }

        std::string await(const std::string& body)
        {
            REQUIRE(host.context()
                        .evaluateModule("globalThis.done = false; (async () => {" + body
                                            + "})().then((v) => { globalThis.result = String(v); }, (e) => {"
                                              " globalThis.result = 'rejected: ' + e.name + ': ' + e.message; })"
                                              ".finally(() => { done = true; });",
                                        "/fetch" + std::to_string(++counter) + ".js")
                        .ok());
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(10);
            while (std::chrono::steady_clock::now() < deadline)
            {
                host.tick();
                if (host.context().evaluateScript("done").value().asBoolean())
                    return host.context().evaluateScript("result").value().asString();
                std::this_thread::sleep_for(std::chrono::milliseconds(2));
            }
            FAIL("timed out");
            return {};
        }

        RuntimeHost host;
        int counter = 0;
    };
} // namespace

TEST_CASE("TransportCapture reports nothing until the host provides a position")
{
    backend::TransportCapture capture;
    CHECK_FALSE(capture.latest().has_value());
    capture.capture(nullptr);
    ScriptedPlayHead silent;
    capture.capture(&silent);
    CHECK_FALSE(capture.latest().has_value());
}

TEST_CASE("TransportCapture copies the play head's position")
{
    ScriptedPlayHead playHead;
    juce::AudioPlayHead::PositionInfo info;
    info.setIsPlaying(true);
    info.setIsLooping(true);
    info.setBpm(140.0);
    info.setTimeSignature(juce::AudioPlayHead::TimeSignature { 6, 8 });
    info.setPpqPosition(12.5);
    info.setPpqPositionOfLastBarStart(12.0);
    info.setTimeInSeconds(5.25);
    info.setTimeInSamples(252000);
    playHead.position = info;
    backend::TransportCapture capture;
    capture.capture(&playHead);
    const auto transport = capture.latest();
    REQUIRE(transport.has_value());
    CHECK(transport->playing);
    CHECK_FALSE(transport->recording);
    CHECK(transport->looping);
    CHECK(transport->bpm == 140.0);
    CHECK(transport->timeSignatureNumerator == 6);
    CHECK(transport->timeSignatureDenominator == 8);
    CHECK(transport->ppqPosition == 12.5);
    CHECK(transport->barStartPpq == 12.0);
    CHECK(transport->timeInSeconds == 5.25);
    CHECK(transport->timeInSamples == 252000);
}

TEST_CASE("fetch() through JuceHttpClient talks to a real server")
{
    FetchFixture f;
    OneShotServer server("HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nX-Reply: yes\r\n"
                         "Content-Length: 11\r\nConnection: close\r\n\r\n{\"ok\":true}");
    const auto result = f.await("const r = await fetch('" + server.url("/presets?x=1")
                                + "', { method: 'POST', headers: { 'X-Token': 'abc' }, body: 'payload' });"
                                  "return [r.status, r.headers.get('x-reply'), (await r.json()).ok].join('|');");
    CHECK(result == "201|yes|true");
    CHECK(server.request.starts_with("POST /presets?x=1 HTTP/1.1\r\n"));
    CHECK(server.request.find("x-token: abc\r\n") != std::string::npos); // Fetch lowercases names
    CHECK(server.request.ends_with("\r\n\r\npayload"));
}

TEST_CASE("fetch() reports unreachable servers")
{
    FetchFixture f;
    juce::StreamingSocket probe;
    REQUIRE(probe.createListener(0, "127.0.0.1"));
    const int port = probe.getBoundPort();
    probe.close(); // nothing listens there now
    CHECK(f.await("await fetch('http://127.0.0.1:" + std::to_string(port) + "/');")
              .starts_with("rejected: TypeError: fetch failed:"));
}

int main(int argc, char** argv)
{
    juce::ScopedJuceInitialiser_GUI juce;
    return doctest::Context(argc, argv).run();
}
