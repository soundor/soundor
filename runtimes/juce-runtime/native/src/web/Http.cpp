// The native side of fetch(): hands requests to the backend's HttpClient and
// settles the JavaScript promise on the UI thread when the response arrives.

#include "web/Functions.h"

#include <cstdint>
#include <memory>
#include <string>
#include <utility>
#include <variant>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    namespace
    {
        namespace bind = js::bind;
        using bind::ContextState;

        void readHeaders(ContextState& context, const jsi::Value& value, std::vector<platform::HttpHeader>& out)
        {
            const jsi::Array array = bind::expectArray(context, value, bind::Path { "fetch" }.field("headers"));
            const std::size_t count = array.size(context.rt);
            for (std::size_t i = 0; i < count; ++i)
            {
                const jsi::Array pair = array.getValueAtIndex(context.rt, i).getObject(context.rt).getArray(context.rt);
                out.push_back({ bind::toString(context, pair.getValueAtIndex(context.rt, 0)),
                                bind::toString(context, pair.getValueAtIndex(context.rt, 1)) });
            }
        }

        jsi::Value makeResponse(ContextState& context, platform::HttpResponse&& response)
        {
            bind::ObjectBuilder object(context);
            object.set("status", jsi::Value(response.status));
            object.set("statusText", bind::write(context, response.statusText));
            object.set("url", bind::write(context, response.url));
            jsi::Array headers(context.rt, response.headers.size());
            for (std::size_t i = 0; i < response.headers.size(); ++i)
            {
                jsi::Array pair(context.rt, 2);
                pair.setValueAtIndex(context.rt, 0, bind::write(context, response.headers[i].name));
                pair.setValueAtIndex(context.rt, 1, bind::write(context, response.headers[i].value));
                headers.setValueAtIndex(context.rt, i, pair);
            }
            object.set("headers", headers);
            object.set("body", bind::write(context, std::move(response.body)));
            return object.release();
        }

        // httpSend(method, url, [[name, value]...], body: Uint8Array | null)
        //   → [promise of { status, statusText, url, headers, body }, id]
        jsi::Value httpSend(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            auto* state = stateOf(context);
            if (state == nullptr || count < 4)
                bind::throwInternalError(context, "httpSend() misused");

            platform::HttpRequest request;
            request.method = bind::toString(context, args[0]);
            request.url = bind::toString(context, args[1]);
            readHeaders(context, args[2], request.headers);
            if (! args[3].isNull())
            {
                std::span<const std::uint8_t> body;
                bind::read(context, args[3], bind::Path { "fetch" }, body);
                request.body.assign(body.begin(), body.end());
            }

            std::uint64_t id = 0;
            jsi::Value promise = state->beginOperation(context, "fetch", id);

            if (state->services.http == nullptr)
            {
                state->reject(id, "TypeError", "fetch failed: this plugin has no network access");
            }
            else
            {
                auto cancellation = std::make_shared<platform::CancellationToken>();
                state->cancellations.emplace(id, cancellation);
                // The completion may run on any thread: it carries only the id
                // and the plain C++ result to the UI thread.
                state->services.http->send(
                    std::move(request), cancellation,
                    [completions = state->completions, id](platform::HttpClient::Result result)
                    {
                        completions->post(
                            [id, result = std::move(result)](State& ui, ContextState&) mutable
                            {
                                if (auto* response = std::get_if<platform::HttpResponse>(&result))
                                    ui.resolve(id,
                                               [&](ContextState& c) { return makeResponse(c, std::move(*response)); });
                                else
                                    ui.reject(id, "TypeError", "fetch failed: " + std::get<std::string>(result));
                            });
                    });
            }

            jsi::Array pair(context.rt, 2);
            pair.setValueAtIndex(context.rt, 0, promise);
            pair.setValueAtIndex(context.rt, 1, jsi::Value(double(id)));
            return pair;
        }

        // httpAbort(id): cancels the request; its promise rejects with
        // AbortError (fetch() reports the signal's reason instead).
        jsi::Value httpAbort(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            auto* state = stateOf(context);
            if (state == nullptr || count < 1)
                return jsi::Value::undefined();
            const auto key = static_cast<std::uint64_t>(bind::toNumber(context, args[0]));
            if (const auto it = state->cancellations.find(key); it != state->cancellations.end())
                it->second->cancel();
            state->reject(key, "DOMException:AbortError", "The operation was aborted.");
            return jsi::Value::undefined();
        }
    } // namespace

    std::vector<NativeFunction> httpFunctions()
    {
        return {
            { "httpSend", httpSend, 4 },
            { "httpAbort", httpAbort, 1 },
        };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
