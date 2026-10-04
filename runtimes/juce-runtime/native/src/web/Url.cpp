// URL parsing and mutation for URL/URLSearchParams, delegated to ada (the
// WHATWG URL parser Node.js uses). JavaScript keeps only the serialized URL;
// every getter reads components ada produced and every setter re-runs ada.

#include "web/Functions.h"

#include <ada.h>

#include <array>
#include <string>
#include <string_view>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
{
    namespace
    {
        // [href, origin, protocol, username, password, host, hostname, port,
        //  pathname, search, hash]
        JSValue components(JSContext* ctx, const ada::url_aggregator& url)
        {
            const std::array<std::string, 11> parts {
                std::string(url.get_href()),     url.get_origin(),
                std::string(url.get_protocol()), std::string(url.get_username()),
                std::string(url.get_password()), std::string(url.get_host()),
                std::string(url.get_hostname()), std::string(url.get_port()),
                std::string(url.get_pathname()), std::string(url.get_search()),
                std::string(url.get_hash()),
            };
            JSValue array = JS_NewArray(ctx);
            for (std::size_t i = 0; i < parts.size(); ++i)
                JS_SetPropertyUint32(ctx, array, static_cast<std::uint32_t>(i),
                                     JS_NewStringLen(ctx, parts[i].data(), parts[i].size()));
            return array;
        }

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

        // urlParse(input, base?) → components, or null when invalid.
        JSValue urlParse(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 1)
                return JS_ThrowTypeError(ctx, "urlParse() expects an input");
            const std::string input = text(ctx, argv[0]);
            if (JS_HasException(ctx))
                return JS_EXCEPTION;
            if (argc > 1 && ! JS_IsUndefined(argv[1]))
            {
                const std::string base = text(ctx, argv[1]);
                if (JS_HasException(ctx))
                    return JS_EXCEPTION;
                auto parsedBase = ada::parse<ada::url_aggregator>(base);
                if (! parsedBase)
                    return JS_NULL;
                auto url = ada::parse<ada::url_aggregator>(input, &*parsedBase);
                return url ? components(ctx, *url) : JS_NULL;
            }
            auto url = ada::parse<ada::url_aggregator>(input);
            return url ? components(ctx, *url) : JS_NULL;
        }

        // urlSet(href, component, value) → components after the setter, or
        // null if `href` itself must reject the value (only for "href").
        JSValue urlSet(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (argc < 3)
                return JS_ThrowTypeError(ctx, "urlSet() expects href, component and value");
            auto url = ada::parse<ada::url_aggregator>(text(ctx, argv[0]));
            if (! url)
                return JS_ThrowTypeError(ctx, "invalid URL");
            const std::string component = text(ctx, argv[1]);
            const std::string value = text(ctx, argv[2]);
            if (JS_HasException(ctx))
                return JS_EXCEPTION;

            // Setters the URL standard ignores on failure simply leave the URL
            // unchanged; only href reports failure.
            if (component == "href")
            {
                if (! url->set_href(value))
                    return JS_NULL;
            }
            else if (component == "protocol")
                url->set_protocol(value);
            else if (component == "username")
                url->set_username(value);
            else if (component == "password")
                url->set_password(value);
            else if (component == "host")
                url->set_host(value);
            else if (component == "hostname")
                url->set_hostname(value);
            else if (component == "port")
                url->set_port(value);
            else if (component == "pathname")
                url->set_pathname(value);
            else if (component == "search")
                url->set_search(value);
            else if (component == "hash")
                url->set_hash(value);
            else
                return JS_ThrowTypeError(ctx, "unknown URL component");
            return components(ctx, *url);
        }
    } // namespace

    std::vector<NativeFunction> urlFunctions()
    {
        return {
            { "urlParse", urlParse, 2 },
            { "urlSet", urlSet, 3 },
        };
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::web
