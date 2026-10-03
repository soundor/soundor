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
        std::string text(JSContext* ctx, JSValueConst value)
        {
            std::size_t length = 0;
            const char* chars = JS_ToCStringLen(ctx, &length, value);
            if (chars == nullptr)
                return {};
            std::string result(chars, length);
            JS_FreeCString(ctx, chars);
            return result;
        }

        bool readHeaders(JSContext* ctx, JSValueConst array, std::vector<platform::HttpHeader>& out)
        {
            std::int64_t count = 0;
            if (JS_GetLength(ctx, array, &count) < 0)
                return false;
            for (std::int64_t i = 0; i < count; ++i)
            {
                JSValue pair = JS_GetPropertyUint32(ctx, array, static_cast<std::uint32_t>(i));
                JSValue name = JS_GetPropertyUint32(ctx, pair, 0);
                JSValue value = JS_GetPropertyUint32(ctx, pair, 1);
                out.push_back({ text(ctx, name), text(ctx, value) });
                JS_FreeValue(ctx, name);
                JS_FreeValue(ctx, value);
                JS_FreeValue(ctx, pair);
                if (JS_HasException(ctx))
                    return false;
            }
            return true;
        }

        JSValue makeResponse(JSContext* ctx, platform::HttpResponse&& response)
        {
            js::bind::ObjectBuilder object(ctx);
            object.set("status", JS_NewInt32(ctx, response.status));
            object.set("statusText", js::bind::write(ctx, response.statusText));
            object.set("url", js::bind::write(ctx, response.url));
            JSValue headers = JS_NewArray(ctx);
            for (std::size_t i = 0; i < response.headers.size(); ++i)
            {
                JSValue pair = JS_NewArray(ctx);
                JS_SetPropertyUint32(ctx, pair, 0, js::bind::write(ctx, response.headers[i].name));
                JS_SetPropertyUint32(ctx, pair, 1, js::bind::write(ctx, response.headers[i].value));
                JS_SetPropertyUint32(ctx, headers, static_cast<std::uint32_t>(i), pair);
            }
            object.set("headers", headers);
            object.set("body", js::bind::write(ctx, std::move(response.body)));
            return object.release();
        }

        // httpSend(method, url, [[name, value]...], body: Uint8Array | null)
        //   → [promise of { status, statusText, url, headers, body }, id]
        JSValue httpSend(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            auto* state = stateOf(ctx);
            if (state == nullptr || argc < 4)
                return JS_ThrowInternalError(ctx, "httpSend() misused");

            platform::HttpRequest request;
            request.method = text(ctx, argv[0]);
            request.url = text(ctx, argv[1]);
            if (JS_HasException(ctx) || ! readHeaders(ctx, argv[2], request.headers))
                return JS_EXCEPTION;
            if (! JS_IsNull(argv[3]))
            {
                std::span<const std::uint8_t> body;
                if (! js::bind::read(ctx, argv[3], js::bind::Path { "fetch" }, body))
                    return JS_EXCEPTION;
                request.body.assign(body.begin(), body.end());
            }

            std::uint64_t id = 0;
            JSValue promise = state->beginOperation(ctx, "fetch", id);
            if (JS_IsException(promise))
                return promise;

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
                            [id, result = std::move(result)](State& ui, JSContext*) mutable
                            {
                                if (auto* response = std::get_if<platform::HttpResponse>(&result))
                                    ui.resolve(id, [&](JSContext* c) { return makeResponse(c, std::move(*response)); });
                                else
                                    ui.reject(id, "TypeError", "fetch failed: " + std::get<std::string>(result));
                            });
                    });
            }

            JSValue pair = JS_NewArray(ctx);
            JS_SetPropertyUint32(ctx, pair, 0, promise);
            JS_SetPropertyUint32(ctx, pair, 1, JS_NewFloat64(ctx, double(id)));
            return pair;
        }

        // httpAbort(id): cancels the request; its promise rejects with
        // AbortError (fetch() reports the signal's reason instead).
        JSValue httpAbort(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            auto* state = stateOf(ctx);
            double id = 0;
            if (state == nullptr || argc < 1 || JS_ToFloat64(ctx, &id, argv[0]) < 0)
                return JS_UNDEFINED;
            const auto key = static_cast<std::uint64_t>(id);
            if (const auto it = state->cancellations.find(key); it != state->cancellations.end())
                it->second->cancel();
            state->reject(key, "DOMException:AbortError", "The operation was aborted.");
            return JS_UNDEFINED;
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
