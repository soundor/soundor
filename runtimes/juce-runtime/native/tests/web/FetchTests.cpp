#include "WebTestSupport.h"

#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

using namespace soundor;
using test::WebFixture;

namespace
{
    // An HttpClient that records requests and answers as told.
    class FakeHttp final : public platform::HttpClient
    {
    public:
        enum class Mode
        {
            Respond,      // immediately, on the calling thread
            RespondLater, // from another thread
            Fail,         // network error
            Hang,         // never (until released)
        };

        void send(platform::HttpRequest request, std::shared_ptr<const platform::CancellationToken> token,
                  Completion complete) override
        {
            const std::lock_guard lock(mutex);
            requests.push_back(request);
            tokens.push_back(token);
            platform::HttpResponse response;
            response.status = status;
            response.statusText = "OK";
            response.headers = { { "Content-Type", "application/json" },
                                 { "Set-Cookie", "a=1" },
                                 { "Set-Cookie", "b=2" },
                                 { "X-Echo-Method", request.method } };
            response.headers.insert(response.headers.end(), extraHeaders.begin(), extraHeaders.end());
            response.body.assign(body.begin(), body.end());
            response.url = finalUrl.empty() ? request.url : finalUrl;
            switch (mode)
            {
                case Mode::Respond:
                    complete(std::move(response));
                    break;
                case Mode::RespondLater:
                    threads.emplace_back([complete, response]() mutable { complete(std::move(response)); });
                    break;
                case Mode::Fail:
                    complete(std::string("connection refused"));
                    break;
                case Mode::Hang:
                    hung.emplace_back([complete, response]() mutable { complete(std::move(response)); });
                    break;
            }
        }

        ~FakeHttp() override
        {
            for (auto& thread : threads)
                thread.join();
        }

        FakeHttp() = default;
        FakeHttp(const FakeHttp&) = delete;
        FakeHttp& operator=(const FakeHttp&) = delete;

        std::mutex mutex;
        Mode mode = Mode::Respond;
        int status = 200;
        std::string body = R"({"ok":true})";
        std::string finalUrl;
        std::vector<platform::HttpHeader> extraHeaders;
        std::vector<platform::HttpRequest> requests;
        std::vector<std::shared_ptr<const platform::CancellationToken>> tokens;
        std::vector<std::thread> threads;
        std::vector<std::function<void()>> hung;
    };

    std::string bodyText(const platform::HttpRequest& request)
    {
        return { request.body.begin(), request.body.end() };
    }

    std::string header(const platform::HttpRequest& request, const std::string& name)
    {
        for (const auto& [key, value] : request.headers)
            if (key == name)
                return value;
        return "<none>";
    }

    struct Fixture : WebFixture
    {
        explicit Fixture(std::shared_ptr<FakeHttp> client = std::make_shared<FakeHttp>())
            : WebFixture(withHttp(client)), http(std::move(client))
        {
        }

        static RuntimeHost::Options withHttp(std::shared_ptr<FakeHttp> client)
        {
            RuntimeHost::Options options;
            options.http = std::move(client);
            return options;
        }

        // Runs an async body to completion, ticking, and returns its result.
        js::Value await(const std::string& body)
        {
            run("globalThis.done = false; (async () => {" + body
                + "})().then((v) => { globalThis.result = v; }, (e) => { globalThis.result = 'rejected: ' + "
                  "(e?.name ?? '') + ': ' + (e?.message ?? e); }).finally(() => { globalThis.done = true; });");
            REQUIRE(tickUntil("done"));
            return eval("globalThis.result");
        }

        std::shared_ptr<FakeHttp> http;
    };
} // namespace

TEST_SUITE("fetch")
{
    TEST_CASE("GET returns a Response with status, headers and body")
    {
        Fixture f;
        CHECK(
            f.await("const r = await fetch('https://api.test/v1/presets?x=1');"
                    "const data = await r.json();"
                    "return [r.status, r.ok, r.statusText, r.url, r.redirected, r.type, r.headers.get('content-type'),"
                    "  r.headers.getSetCookie().join(';'), data.ok, r.bodyUsed].join('|');")
                .asString()
            == "200|true|OK|https://api.test/v1/presets?x=1|false|basic|application/json|a=1;b=2|true|true");
        REQUIRE(f.http->requests.size() == 1);
        CHECK(f.http->requests[0].method == "GET");
        CHECK(f.http->requests[0].url == "https://api.test/v1/presets?x=1");
        CHECK(f.http->requests[0].body.empty());
    }

    TEST_CASE("encodes request bodies and default content types")
    {
        Fixture f;
        f.await("await fetch('https://a.test/', { method: 'post', body: 'hello' });"
                "await fetch('https://a.test/', { method: 'PUT', body: JSON.stringify({ a: 1 }),"
                "  headers: { 'Content-Type': 'application/json', 'X-Token': ' abc ' } });"
                "await fetch('https://a.test/', { method: 'POST', body: new URLSearchParams({ q: 'a b' }) });"
                "await fetch('https://a.test/', { method: 'POST', body: new Uint8Array([1, 2, 3]) });"
                "await fetch('https://a.test/', { method: 'POST', body: new Blob(['blob'], { type: 'text/x' }) });"
                "const form = new FormData(); form.append('name', 'value');"
                "form.append('file', new Blob(['data'], { type: 'text/plain' }), 'a.txt');"
                "await fetch('https://a.test/', { method: 'POST', body: form });");
        const auto& requests = f.http->requests;
        REQUIRE(requests.size() == 6);
        CHECK(requests[0].method == "POST");
        CHECK(bodyText(requests[0]) == "hello");
        CHECK(header(requests[0], "content-type") == "text/plain;charset=UTF-8");
        CHECK(header(requests[1], "content-type") == "application/json");
        CHECK(header(requests[1], "x-token") == "abc");
        CHECK(bodyText(requests[2]) == "q=a+b");
        CHECK(header(requests[2], "content-type") == "application/x-www-form-urlencoded;charset=UTF-8");
        CHECK(requests[3].body == std::vector<std::uint8_t> { 1, 2, 3 });
        CHECK(header(requests[3], "content-type") == "<none>");
        CHECK(header(requests[4], "content-type") == "text/x");
        const std::string type = header(requests[5], "content-type");
        REQUIRE(type.starts_with("multipart/form-data; boundary="));
        const std::string boundary = type.substr(type.find('=') + 1);
        CHECK(bodyText(requests[5])
              == "--" + boundary + "\r\nContent-Disposition: form-data; name=\"name\"\r\n\r\nvalue\r\n--" + boundary
                     + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.txt\"\r\nContent-Type: "
                       "text/plain\r\n\r\ndata\r\n--"
                     + boundary + "--\r\n");
    }

    TEST_CASE("delivers responses that complete on another thread")
    {
        Fixture f;
        f.http->mode = FakeHttp::Mode::RespondLater;
        f.http->finalUrl = "https://elsewhere.test/final";
        CHECK(f.await("const r = await fetch('https://a.test/start');"
                      "return [r.redirected, r.url, await r.text()].join('|');")
                  .asString()
              == "true|https://elsewhere.test/final|{\"ok\":true}");
    }

    TEST_CASE("network failures reject with TypeError")
    {
        Fixture f;
        f.http->mode = FakeHttp::Mode::Fail;
        CHECK(f.await("await fetch('https://a.test/');").asString()
              == "rejected: TypeError: fetch failed: connection refused");
    }

    TEST_CASE("a response the platform cannot represent rejects instead of hanging")
    {
        Fixture f;
        f.http->extraHeaders = { { "HTTP/1.1 200 OK", "" } };
        CHECK(f.await("await fetch('https://a.test/');").asString()
              == "rejected: TypeError: fetch failed: invalid response (Invalid header name: 'HTTP/1.1 200 OK')");
    }

    TEST_CASE("without network access fetch rejects")
    {
        WebFixture f;
        f.run("globalThis.done = false; fetch('https://a.test/').catch((e) => { globalThis.result = e.name + ': '"
              " + e.message; }).finally(() => { done = true; });");
        REQUIRE(f.tickUntil("done"));
        CHECK(f.eval("result").asString() == "TypeError: fetch failed: this plugin has no network access");
    }

    TEST_CASE("aborting rejects with the signal's reason and cancels the request")
    {
        Fixture f;
        f.http->mode = FakeHttp::Mode::Hang;
        CHECK(f.await("const c = new AbortController();"
                      "const pending = fetch('https://a.test/slow', { signal: c.signal });"
                      "setTimeout(() => c.abort(), 1);"
                      "try { await pending; } catch (e) { return e.name; }")
                  .asString()
              == "AbortError");
        REQUIRE(f.http->tokens.size() == 1);
        CHECK(f.http->tokens[0]->isCancelled());
        // A response arriving after the abort is ignored.
        f.http->hung.at(0)();
        f.tickFor(std::chrono::milliseconds(5));
        CHECK(f.logs.empty());

        CHECK(f.await("const c = new AbortController(); c.abort('stop');"
                      "try { await fetch('https://a.test/', { signal: c.signal }); } catch (e) { return e; }")
                  .asString()
              == "stop");
        CHECK(f.await("try { await fetch('https://a.test/', { signal: AbortSignal.timeout(1) }); }"
                      "catch (e) { return e.name; }")
                  .asString()
              == "TimeoutError");
    }

    TEST_CASE("tearing the runtime down cancels requests in flight")
    {
        auto http = std::make_shared<FakeHttp>();
        http->mode = FakeHttp::Mode::Hang;
        {
            Fixture f(http);
            f.run("fetch('https://a.test/forever');");
        }
        REQUIRE(http->tokens.size() == 1);
        CHECK(http->tokens[0]->isCancelled());
        http->hung.at(0)(); // completing afterwards touches nothing
    }

    TEST_CASE("data: URLs resolve locally; other schemes and modes are rejected")
    {
        Fixture f;
        CHECK(f.await("const a = await (await fetch('data:text/plain,hello%20there')).text();"
                      "const b = await (await fetch('data:application/octet-stream;base64,AQID')).bytes();"
                      "const c = await fetch('data:,x');"
                      "return [a, Array.from(b).join(' '), c.headers.get('content-type')].join('|');")
                  .asString()
              == "hello there|1 2 3|text/plain;charset=US-ASCII");
        CHECK(f.await("await fetch('file:///etc/hosts');").asString()
              == "rejected: TypeError: fetch() does not support file: URLs");
        CHECK(f.await("await fetch('https://a.test/', { redirect: 'manual' });").asString()
              == "rejected: TypeError: Redirect mode 'manual' is not supported");
        CHECK(f.http->requests.empty());
    }

    TEST_CASE("validates requests")
    {
        Fixture f;
        CHECK(f.await("await fetch('https://a.test/', { body: 'x' });").asString()
              == "rejected: TypeError: A GET request cannot have a body");
        CHECK(f.await("await fetch('/relative');").asString() == "rejected: TypeError: Invalid URL: /relative");
        CHECK(f.await("await fetch('https://a.test/', { method: 'TRACE' });").asString()
              == "rejected: TypeError: Method TRACE is forbidden");
        CHECK(f.await("await fetch('https://user:pw@a.test/');").asString()
              == "rejected: TypeError: Request URLs cannot contain credentials");
        CHECK(f.await("await fetch('https://a.test/', { headers: { 'bad name': 'x' } });").asString()
              == "rejected: TypeError: Invalid header name: 'bad name'");
        CHECK(f.await("await fetch('https://a.test/', { headers: { a: 'x\\ny' } });").asString()
              == "rejected: TypeError: Header values cannot contain NUL, CR or LF");
    }
}

TEST_SUITE("Request and Response")
{
    TEST_CASE("Response constructors, statics and bodies")
    {
        WebFixture f;
        f.run("globalThis.done = false; (async () => {"
              "  const r = new Response('body', { status: 201, statusText: 'Created', headers: { a: '1' } });"
              "  const copy = r.clone(); const text = await r.text();"
              "  let reused; try { await r.text(); } catch (e) { reused = e.message; }"
              "  const j = Response.json({ n: 1 }); const e = Response.error();"
              "  const redirect = Response.redirect('https://a.test/x', 307);"
              "  globalThis.result = [r.status, r.ok, text, await copy.text(), reused, j.headers.get('content-type'),"
              "    (await j.json()).n, e.type, e.status, redirect.status, redirect.headers.get('location'),"
              "    new Response().headers.has('content-type')].join('|');"
              "})().finally(() => { done = true; });");
        REQUIRE(f.tickUntil("done"));
        CHECK(f.eval("result").asString()
              == "201|true|body|body|Body has already been consumed|application/json|1|error|0|307|"
                 "https://a.test/x|false");
        CHECK(f.error("new Response(null, { status: 600 });").find("RangeError") == 0);
        CHECK(f.error("new Response('x', { status: 204 });").find("TypeError") == 0);
    }

    TEST_CASE("Request copies, clones and links signals")
    {
        WebFixture f;
        CHECK(f.run("const c = new AbortController();"
                    "const a = new Request('https://a.test/', { method: 'POST', body: 'x', signal: c.signal });"
                    "const b = new Request(a, { headers: { h: '1' } }); const clone = a.clone(); c.abort();"
                    "globalThis.result = [b.method, b.url, b.headers.get('h'), clone.signal.aborted,"
                    "  b.signal.aborted, a.redirect].join('|');")
                  .asString()
              == "POST|https://a.test/|1|true|true|follow");
    }

    TEST_CASE("Headers combine, sort and validate")
    {
        WebFixture f;
        CHECK(f.run("const h = new Headers([['B', '2'], ['a', '1'], ['b', '3'], ['Set-Cookie', 'x'],"
                    "  ['set-cookie', 'y']]);"
                    "h.set('C', ' 4 '); h.delete('missing');"
                    "globalThis.result = [h.get('b'), [...h].map(([k, v]) => k + '=' + v).join('&'), h.has('A'),"
                    "  JSON.stringify(Object.fromEntries(new Headers({ z: 1 })))].join('|');")
                  .asString()
              == "2, 3|a=1&b=2, 3&c=4&set-cookie=x&set-cookie=y|true|{\"z\":\"1\"}");
    }
}

TEST_SUITE("Blob, File and FormData")
{
    TEST_CASE("Blob concatenates parts, slices and reads")
    {
        WebFixture f;
        f.run("globalThis.done = false; (async () => {"
              "  const b = new Blob(['ab', new Uint8Array([99]), new Blob(['d'])], { type: 'Text/Plain' });"
              "  globalThis.result = [b.size, b.type, await b.text(), await b.slice(1, -1).text(),"
              "    await b.slice(-2).text(), (await b.arrayBuffer()).byteLength, String(b),"
              "    new Blob([], { type: 'bad\\u00ff' }).type === ''].join('|');"
              "})().finally(() => { done = true; });");
        REQUIRE(f.tickUntil("done"));
        CHECK(f.eval("result").asString() == "4|text/plain|abcd|bc|cd|4|[object Blob]|true");
    }

    TEST_CASE("File carries a name and survives structuredClone")
    {
        WebFixture f;
        CHECK(f.run("const file = new File(['x'], 'a.txt', { type: 'text/plain', lastModified: 5 });"
                    "const copy = structuredClone(file);"
                    "globalThis.result = [copy instanceof File, copy.name, copy.lastModified, copy.type, copy.size,"
                    "  file instanceof Blob].join('|');")
                  .asString()
              == "true|a.txt|5|text/plain|1|true");
    }

    TEST_CASE("FormData keeps ordered entries, Blobs become Files")
    {
        WebFixture f;
        CHECK(f.run("const form = new FormData(); form.append('a', 1); form.append('a', 2);"
                    "form.append('blob', new Blob(['x'])); form.set('a', 3); form.append('b', 'y'); form.delete('b');"
                    "globalThis.result = [form.getAll('a').join(), form.get('blob').name, form.has('b'),"
                    "  [...form.keys()].join()].join('|');")
                  .asString()
              == "3|blob|false|a,blob");
    }
}
