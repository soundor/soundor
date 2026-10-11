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
        namespace bind = js::bind;
        using bind::ContextState;

        // [href, origin, protocol, username, password, host, hostname, port,
        //  pathname, search, hash]
        jsi::Value components(ContextState& context, const ada::url_aggregator& url)
        {
            const std::array<std::string, 11> parts {
                std::string(url.get_href()),     url.get_origin(),
                std::string(url.get_protocol()), std::string(url.get_username()),
                std::string(url.get_password()), std::string(url.get_host()),
                std::string(url.get_hostname()), std::string(url.get_port()),
                std::string(url.get_pathname()), std::string(url.get_search()),
                std::string(url.get_hash()),
            };
            jsi::Array array(context.rt, parts.size());
            for (std::size_t i = 0; i < parts.size(); ++i)
                array.setValueAtIndex(context.rt, i, bind::write(context, parts[i]));
            return array;
        }

        // urlParse(input, base?) → components, or null when invalid.
        jsi::Value urlParse(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count < 1)
                bind::throwTypeError(context, "urlParse() expects an input");
            const std::string input = bind::toString(context, args[0]);
            if (count > 1 && ! args[1].isUndefined())
            {
                const std::string base = bind::toString(context, args[1]);
                auto parsedBase = ada::parse<ada::url_aggregator>(base);
                if (! parsedBase)
                    return jsi::Value::null();
                auto url = ada::parse<ada::url_aggregator>(input, &*parsedBase);
                return url ? components(context, *url) : jsi::Value::null();
            }
            auto url = ada::parse<ada::url_aggregator>(input);
            return url ? components(context, *url) : jsi::Value::null();
        }

        // urlSet(href, component, value) → components after the setter, or
        // null if `href` itself must reject the value (only for "href").
        jsi::Value urlSet(ContextState& context, const jsi::Value&, const jsi::Value* args, std::size_t count)
        {
            if (count < 3)
                bind::throwTypeError(context, "urlSet() expects href, component and value");
            auto url = ada::parse<ada::url_aggregator>(bind::toString(context, args[0]));
            if (! url)
                bind::throwTypeError(context, "invalid URL");
            const std::string component = bind::toString(context, args[1]);
            const std::string value = bind::toString(context, args[2]);

            // Setters the URL standard ignores on failure simply leave the URL
            // unchanged; only href reports failure.
            if (component == "href")
            {
                if (! url->set_href(value))
                    return jsi::Value::null();
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
                bind::throwTypeError(context, "unknown URL component");
            return components(context, *url);
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
