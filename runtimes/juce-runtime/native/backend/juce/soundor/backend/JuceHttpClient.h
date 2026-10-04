#pragma once

// JUCE backend: fetch() over juce::URL.

#include <soundor/platform/Platform.h>

#include <juce_core/juce_core.h>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    // Runs requests on a small thread pool with JUCE's networking. Aborts stop
    // a transfer at its next progress callback. Destruction cancels nothing by
    // itself (the runtime cancels its requests first) and waits for running
    // transfers to stop.
    //
    // Linux builds with JUCE_USE_CURL=0 support plain http only; enable libcurl
    // in JUCE for https there.
    class JuceHttpClient final : public platform::HttpClient
    {
    public:
        JuceHttpClient();
        ~JuceHttpClient() override;

        JuceHttpClient(const JuceHttpClient&) = delete;
        JuceHttpClient& operator=(const JuceHttpClient&) = delete;

        void send(platform::HttpRequest request, std::shared_ptr<const platform::CancellationToken> cancellation,
                  Completion complete) override;

    private:
        juce::ThreadPool pool;
    };
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
