#include "WebTestSupport.h"

#include <string>

using namespace soundor;
using test::WebFixture;

TEST_SUITE("URL")
{
    TEST_CASE("parses into WHATWG components")
    {
        WebFixture f;
        CHECK(f.run("const u = new URL('HTTPS://user:pw@Example.COM:8443/a/../b%20c?q=1#frag');"
                    "globalThis.result = [u.href, u.origin, u.protocol, u.username, u.password, u.host,"
                    "  u.hostname, u.port, u.pathname, u.search, u.hash].join('|');")
                  .asString()
              == "https://user:pw@example.com:8443/b%20c?q=1#frag|https://example.com:8443|https:|user|pw|"
                 "example.com:8443|example.com|8443|/b%20c|?q=1|#frag");
    }

    TEST_CASE("resolves against a base, normalizes, and handles IDNA")
    {
        WebFixture f;
        CHECK(f.run("globalThis.result = [new URL('../x?y', 'https://a.test/p/q/r').href,"
                    "  new URL('https://bücher.example/').hostname, new URL('http://a.test:80/').port,"
                    "  new URL('file:///C:/plugins/x.vst3').pathname, String(new URL('data:text/plain,hi'))].join('|');")
                  .asString()
              == "https://a.test/p/x?y|xn--bcher-kva.example||/C:/plugins/x.vst3|data:text/plain,hi");
    }

    TEST_CASE("rejects invalid input")
    {
        WebFixture f;
        CHECK(f.error("new URL('not a url');") == "TypeError: Invalid URL: not a url");
        CHECK(f.error("new URL('/relative', 'also bad');").find("TypeError: Invalid URL") == 0);
        CHECK(f.run("globalThis.result = [URL.canParse('https://x.test'), URL.canParse('nope'),"
                    "  URL.canParse('/a', 'https://x.test'), URL.parse('nope'),"
                    "  URL.parse('https://x.test/a').pathname].join();")
                  .asString()
              == "true,false,true,,/a");
    }

    TEST_CASE("setters re-run the parser, ignoring invalid values")
    {
        WebFixture f;
        CHECK(f.run("const u = new URL('https://a.test/x');"
                    "u.pathname = '/new path'; u.search = 'a=1'; u.hash = 'h'; u.port = '8080';"
                    "u.hostname = 'b.test'; u.username = 'me'; u.port = 'not a port';"
                    "u.protocol = 'http'; u.protocol = 'not a scheme!';"
                    "globalThis.result = u.href;")
                  .asString()
              == "http://me@b.test:8080/new%20path?a=1#h");
        CHECK(f.error("new URL('https://a.test').href = 'nope';").find("TypeError: Invalid URL") == 0);
        CHECK(f.run("const u = new URL('https://a.test'); u.href = 'https://c.test/z';"
                    "globalThis.result = JSON.stringify({ u }) + String(u);")
                  .asString()
              == "{\"u\":\"https://c.test/z\"}https://c.test/z");
    }

    TEST_CASE("searchParams stay in sync with the URL")
    {
        WebFixture f;
        CHECK(f.run("const u = new URL('https://a.test/?a=1&b=2');"
                    "const params = u.searchParams; params.append('c', 'x y'); params.delete('a');"
                    "const afterParams = u.href;"
                    "u.search = '?z=9'; globalThis.result = [afterParams, params.get('z'), params.size,"
                    "  u.searchParams === params].join('|');")
                  .asString()
              == "https://a.test/?b=2&c=x+y|9|1|true");
    }
}

TEST_SUITE("URLSearchParams")
{
    TEST_CASE("parses and serializes application/x-www-form-urlencoded")
    {
        WebFixture f;
        CHECK(f.run("const p = new URLSearchParams('?a=1&b=x+y&c=%E2%9C%93&d&=e&a=2&bad=%zz');"
                    "globalThis.result = [p.get('a'), p.getAll('a').join(), p.get('b'), p.get('c'), p.get('d'),"
                    "  p.get(''), p.get('bad'), p.get('missing'), p.toString()].join('|');")
                  .asString()
              == "1|1,2|x y|✓||e|%zz||a=1&b=x+y&c=%E2%9C%93&d=&=e&a=2&bad=%25zz");
    }

    TEST_CASE("constructs from pairs, records and other params")
    {
        WebFixture f;
        CHECK(f.run("const a = new URLSearchParams([['x', 1], ['x', 2]]);"
                    "const b = new URLSearchParams({ y: 'z', n: 3 }); const c = new URLSearchParams(a);"
                    "c.append('x', 3);"
                    "globalThis.result = [a.toString(), b.toString(), c.toString()].join('|');")
                  .asString()
              == "x=1&x=2|y=z&n=3|x=1&x=2&x=3");
        CHECK(f.error("new URLSearchParams([['only']]);").find("TypeError") == 0);
    }

    TEST_CASE("mutates, sorts stably and iterates")
    {
        WebFixture f;
        CHECK(f.run("const p = new URLSearchParams('b=1&a=2&b=3&c=4');"
                    "p.set('b', 'x'); p.delete('c', '5'); const hasPair = p.has('c', '4'); p.sort();"
                    "const seen = []; p.forEach((v, k) => seen.push(k + v));"
                    "globalThis.result = [p.toString(), [...p.keys()].join(''), [...p.values()].join(''),"
                    "  seen.join(','), hasPair, p.has('a'), p.size].join('|');")
                  .asString()
              == "a=2&b=x&c=4|abc|2x4|a2,bx,c4|true|true|3");
    }

    TEST_CASE("encodes everything outside the safe set")
    {
        WebFixture f;
        CHECK(f.run("globalThis.result = new URLSearchParams({ 'k&=': 'v ü*-._~/' }).toString();").asString()
              == "k%26%3D=v+%C3%BC*-._%7E%2F");
    }
}
