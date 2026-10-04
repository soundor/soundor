#include "JuceHttpClient.h"

#include <utility>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
{
    namespace
    {
        std::string reasonPhrase(int status)
        {
            switch (status)
            {
                case 200:
                    return "OK";
                case 201:
                    return "Created";
                case 204:
                    return "No Content";
                case 301:
                    return "Moved Permanently";
                case 302:
                    return "Found";
                case 304:
                    return "Not Modified";
                case 400:
                    return "Bad Request";
                case 401:
                    return "Unauthorized";
                case 403:
                    return "Forbidden";
                case 404:
                    return "Not Found";
                case 500:
                    return "Internal Server Error";
                case 503:
                    return "Service Unavailable";
                default:
                    return {};
            }
        }

        // An HTTP token (RFC 9110), as Fetch requires of header names.
        bool isHeaderName(const juce::String& name)
        {
            return name.isNotEmpty()
                   && name.containsOnly("!#$%&'*+-.^_`|~0123456789"
                                        "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz");
        }

        platform::HttpClient::Result perform(const platform::HttpRequest& request,
                                             const platform::CancellationToken& cancellation)
        {
            juce::URL url(juce::String::fromUTF8(request.url.data(), int(request.url.size())));
            if (! request.body.empty())
                url = url.withPOSTData(juce::MemoryBlock(request.body.data(), request.body.size()));

            juce::String headers;
            for (const auto& [name, value] : request.headers)
                headers << juce::String::fromUTF8(name.data(), int(name.size())) << ": "
                        << juce::String::fromUTF8(value.data(), int(value.size())) << "\r\n";

            int status = 0;
            juce::StringPairArray responseHeaders;
            auto options =
                juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
                    .withExtraHeaders(headers)
                    .withHttpRequestCmd(juce::String(request.method))
                    .withConnectionTimeoutMs(30000)
                    .withNumRedirectsToFollow(10)
                    .withStatusCode(&status)
                    .withResponseHeaders(&responseHeaders)
                    .withProgressCallback([&cancellation](int, int) { return ! cancellation.isCancelled(); });
            auto stream = url.createInputStream(options);
            if (cancellation.isCancelled())
                return std::string("aborted");
            if (stream == nullptr)
                return std::string("could not connect to ") + request.url;

            platform::HttpResponse response;
            response.status = status;
            response.statusText = reasonPhrase(status);
            response.url = request.url;
            for (const auto& key : responseHeaders.getAllKeys())
            {
                // JUCE's Linux implementation also lists the status line
                // ("HTTP/1.1 200 OK") as a header; keep real header names only.
                if (! isHeaderName(key))
                    continue;
                response.headers.push_back({ key.toStdString(), responseHeaders[key].trim().toStdString() });
            }

            char buffer[16384];
            while (! stream->isExhausted())
            {
                if (cancellation.isCancelled())
                    return std::string("aborted");
                const int read = stream->read(buffer, int(sizeof buffer));
                if (read <= 0)
                    break;
                response.body.insert(response.body.end(), buffer, buffer + read);
            }
            return response;
        }
    } // namespace

    JuceHttpClient::JuceHttpClient() : pool(4) {}

    JuceHttpClient::~JuceHttpClient()
    {
        pool.removeAllJobs(true, 30000);
    }

    void JuceHttpClient::send(platform::HttpRequest request,
                              std::shared_ptr<const platform::CancellationToken> cancellation, Completion complete)
    {
        pool.addJob(
            [job = std::move(request), token = std::move(cancellation), done = std::move(complete)]
            {
                platform::HttpClient::Result result;
                try
                {
                    result = perform(job, *token);
                }
                catch (const std::exception& error)
                {
                    result = std::string(error.what());
                }
                done(std::move(result));
            });
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::backend
