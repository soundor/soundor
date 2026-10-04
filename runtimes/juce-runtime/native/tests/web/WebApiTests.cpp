#include "WebTestSupport.h"

#include <string>

using namespace soundor;
using test::WebFixture;

TEST_SUITE("events")
{
    TEST_CASE("dispatches to listeners in order with the event's state")
    {
        WebFixture f;
        CHECK(f.run("const target = new EventTarget(); const seen = [];"
                    "target.addEventListener('ping', (e) => seen.push([e.type, e.target === target,"
                    "  e.currentTarget === target, e.eventPhase, e.isTrusted].join()));"
                    "target.addEventListener('ping', { handleEvent(e) { seen.push('object'); } });"
                    "const event = new Event('ping');"
                    "const notCancelled = target.dispatchEvent(event);"
                    "seen.push(String(event.currentTarget), String(event.eventPhase), String(notCancelled));"
                    "globalThis.result = seen.join('|');")
                  .asString()
              == "ping,true,true,2,false|object|null|0|true");
    }

    TEST_CASE("supports once, signal, duplicate suppression and removal")
    {
        WebFixture f;
        CHECK(f.run("const t = new EventTarget(); let calls = 0; const listener = () => calls++;"
                    "t.addEventListener('x', listener); t.addEventListener('x', listener);"
                    "t.addEventListener('x', () => calls += 10, { once: true });"
                    "const controller = new AbortController();"
                    "t.addEventListener('x', () => calls += 100, { signal: controller.signal });"
                    "t.dispatchEvent(new Event('x')); controller.abort(); t.dispatchEvent(new Event('x'));"
                    "t.removeEventListener('x', listener); t.dispatchEvent(new Event('x'));"
                    "globalThis.result = calls;")
                  .asNumber()
              == 112);
    }

    TEST_CASE("preventDefault, passive listeners and stopImmediatePropagation")
    {
        WebFixture f;
        CHECK(f.run("const t = new EventTarget(); const log = [];"
                    "t.addEventListener('x', (e) => e.preventDefault(), { passive: true });"
                    "t.addEventListener('y', (e) => { e.preventDefault(); e.stopImmediatePropagation(); });"
                    "t.addEventListener('y', () => log.push('never'));"
                    "const x = new Event('x', { cancelable: true }); const y = new Event('y', { cancelable: true });"
                    "log.push(t.dispatchEvent(x), x.defaultPrevented, t.dispatchEvent(y), y.defaultPrevented);"
                    "const plain = new Event('y'); t.dispatchEvent(plain); log.push(plain.defaultPrevented);"
                    "globalThis.result = log.join();")
                  .asString()
              == "true,false,false,true,false");
    }

    TEST_CASE("CustomEvent carries detail; a throwing listener is reported")
    {
        WebFixture f;
        CHECK(f.run("const t = new EventTarget(); let got;"
                    "t.addEventListener('c', () => { throw new Error('listener failed'); });"
                    "t.addEventListener('c', (e) => { got = e.detail; });"
                    "t.dispatchEvent(new CustomEvent('c', { detail: { gain: 0.5 } }));"
                    "globalThis.result = got.gain;")
                  .asNumber()
              == 0.5);
        REQUIRE(f.logs.size() == 1);
        CHECK(f.logs[0].second.find("Uncaught Error: listener failed") == 0);
    }

    TEST_CASE("rejects re-dispatching an event that is being dispatched")
    {
        WebFixture f;
        CHECK(f.run("const t = new EventTarget(); let error;"
                    "t.addEventListener('x', (e) => { try { t.dispatchEvent(e); } catch (x) { error = x.name; } });"
                    "t.dispatchEvent(new Event('x')); globalThis.result = error;")
                  .asString()
              == "InvalidStateError");
        CHECK(f.error("new Event();").find("TypeError") == 0);
    }
}

TEST_SUITE("abort")
{
    TEST_CASE("AbortController aborts its signal once, with a reason")
    {
        WebFixture f;
        CHECK(f.run("const c = new AbortController(); const log = [];"
                    "c.signal.addEventListener('abort', () => log.push('event'));"
                    "c.signal.onabort = () => log.push('onabort');"
                    "log.push(c.signal.aborted); c.abort(); c.abort('again');"
                    "log.push(c.signal.aborted, c.signal.reason.name, c.signal.reason instanceof DOMException);"
                    "const custom = new AbortController(); custom.abort('why');"
                    "log.push(custom.signal.reason);"
                    "try { custom.signal.throwIfAborted(); } catch (e) { log.push('threw ' + e); }"
                    "globalThis.result = log.join();")
                  .asString()
              == "false,event,onabort,true,AbortError,true,why,threw why");
        CHECK(f.error("new AbortSignal();").find("TypeError: Illegal constructor") == 0);
    }

    TEST_CASE("AbortSignal.abort, timeout and any")
    {
        WebFixture f;
        f.run("globalThis.a = AbortSignal.abort('now');"
              "globalThis.t = AbortSignal.timeout(5);"
              "const c = new AbortController(); globalThis.any = AbortSignal.any([c.signal, t]);"
              "globalThis.already = AbortSignal.any([AbortSignal.abort('first')]);");
        CHECK(f.eval("a.aborted && a.reason === 'now' && already.reason === 'first'").asBoolean());
        CHECK_FALSE(f.eval("t.aborted || any.aborted").asBoolean());
        REQUIRE(f.tickUntil("t.aborted"));
        CHECK(f.eval("t.reason.name").asString() == "TimeoutError");
        CHECK(f.eval("any.aborted && any.reason === t.reason").asBoolean());
    }
}

TEST_SUITE("encoding")
{
    TEST_CASE("TextEncoder round-trips through TextDecoder")
    {
        WebFixture f;
        CHECK(f.run("const text = 'Gain ✓ 𝄞 ü';"
                    "const bytes = new TextEncoder().encode(text);"
                    "globalThis.result = [bytes.length, new TextDecoder().decode(bytes) === text,"
                    "  new TextEncoder().encoding].join();")
                  .asString()
              == "16,true,utf-8");
    }

    TEST_CASE("lone surrogates encode as U+FFFD")
    {
        WebFixture f;
        CHECK(f.run("globalThis.result = Array.from(new TextEncoder().encode('a\\uD800b')).join();").asString()
              == "97,239,191,189,98");
    }

    TEST_CASE("encodeInto writes whole code points only")
    {
        WebFixture f;
        CHECK(f.run("const out = new Uint8Array(5); const r = new TextEncoder().encodeInto('ab𝄞c', out);"
                    "globalThis.result = [r.read, r.written].join();")
                  .asString()
              == "2,2");
        CHECK(f.run("const out = new Uint8Array(10); const r = new TextEncoder().encodeInto('ab𝄞c', out);"
                    "globalThis.result = [r.read, r.written, Array.from(out.subarray(0, 7)).join(' ')].join();")
                  .asString()
              == "5,7,97 98 240 157 132 158 99");
    }

    TEST_CASE("decodes invalid UTF-8 per maximal subpart, or fails when fatal")
    {
        WebFixture f;
        // Overlong, surrogate, truncated, out of range, stray continuation.
        CHECK(f.run("const d = new TextDecoder();"
                    "const cases = [[0xC0, 0x80], [0xED, 0xA0, 0x80], [0xE2, 0x82], [0xF4, 0x90, 0x80, 0x80],"
                    "  [0x80, 0x41], [0xF0, 0x9F, 0x98], [0xE2, 0x82, 0x41]];"
                    "globalThis.result = cases.map((c) => [...d.decode(new Uint8Array(c))]"
                    "  .map((ch) => ch.codePointAt(0).toString(16)).join(' ')).join('|');")
                  .asString()
              == "fffd fffd|fffd fffd fffd|fffd|fffd fffd fffd fffd|fffd 41|fffd|fffd 41");
        CHECK(f.error("new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array([0xFF]));")
              == "TypeError: The encoded data was not valid UTF-8");
    }

    TEST_CASE("streams multi-byte sequences across chunks")
    {
        WebFixture f;
        CHECK(f.run("const d = new TextDecoder(); const bytes = new TextEncoder().encode('✓𝄞');"
                    "let text = ''; for (const b of bytes) text += d.decode(new Uint8Array([b]), { stream: true });"
                    "text += d.decode();"
                    "const tail = new TextDecoder(); tail.decode(new Uint8Array([0xE2]), { stream: true });"
                    "globalThis.result = [text === '✓𝄞', tail.decode()].join();")
                  .asString()
              == "true,\xEF\xBF\xBD");
    }

    TEST_CASE("handles BOMs, labels and buffer sources")
    {
        WebFixture f;
        CHECK(f.run("const bom = new Uint8Array([0xEF, 0xBB, 0xBF, 0x41]);"
                    "globalThis.result = [new TextDecoder().decode(bom).length,"
                    "  new TextDecoder('utf-8', { ignoreBOM: true }).decode(bom).length,"
                    "  new TextDecoder(' UTF8 ').decode(new Uint8Array([0x41]).buffer),"
                    "  new TextDecoder().decode(new DataView(new Uint8Array([0x42]).buffer)),"
                    "  new TextDecoder().decode()].join();")
                  .asString()
              == "1,2,A,B,");
        CHECK(f.error("new TextDecoder('latin1');").find("RangeError") == 0);
    }
}

TEST_SUITE("crypto")
{
    TEST_CASE("getRandomValues fills integer arrays in place")
    {
        WebFixture f;
        CHECK(f.run("const a = new Uint32Array(64); const same = crypto.getRandomValues(a) === a;"
                    "const view = new Uint8Array(new ArrayBuffer(16), 4, 8); crypto.getRandomValues(view);"
                    "globalThis.result = same && a.some((x) => x !== 0) && new Set(a).size > 60;")
                  .asBoolean());
        CHECK(f.error("crypto.getRandomValues(new Float32Array(4));").find("TypeMismatchError") != std::string::npos);
        CHECK(f.error("crypto.getRandomValues(new Uint8Array(65537));").find("QuotaExceededError")
              != std::string::npos);
        CHECK(f.run("crypto.getRandomValues(new Uint8Array(65536)); globalThis.result = 'ok';").asString() == "ok");
    }

    TEST_CASE("randomUUID returns distinct version 4 UUIDs")
    {
        WebFixture f;
        CHECK(f.run("const ids = Array.from({ length: 200 }, () => crypto.randomUUID());"
                    "globalThis.result = new Set(ids).size === 200 && ids.every((id) =>"
                    "  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id));")
                  .asBoolean());
        CHECK(f.eval("typeof crypto.subtle").asString() == "undefined");
    }
}

TEST_SUITE("structuredClone")
{
    TEST_CASE("deep-copies data, preserving cycles and shared references")
    {
        WebFixture f;
        CHECK(f.run("const shared = { n: 1 };"
                    "const original = { a: [1, 'two', 3n, null, undefined], when: new Date(5), re: /x/gi,"
                    "  map: new Map([['k', shared]]), set: new Set([shared]), boxed: new Number(4),"
                    "  nested: { shared } };"
                    "original.self = original;"
                    "const copy = structuredClone(original);"
                    "globalThis.result = [copy !== original, copy.self === copy, copy.a[2] === 3n,"
                    "  copy.when.getTime(), copy.re.flags, copy.map.get('k') === copy.nested.shared,"
                    "  copy.set.has(copy.nested.shared), copy.nested.shared !== shared, copy.boxed + 1,"
                    "  '4' in copy.a].join();")
                  .asString()
              == "true,true,true,5,gi,true,true,true,5,true");
    }

    TEST_CASE("copies binary data, sharing buffers between views")
    {
        WebFixture f;
        CHECK(
            f.run("const buffer = new ArrayBuffer(8);"
                  "const value = { a: new Uint8Array(buffer, 2, 4), b: new DataView(buffer), buffer };"
                  "value.a[0] = 7; const copy = structuredClone(value);"
                  "copy.a[1] = 9;"
                  "globalThis.result = [copy.a.buffer === copy.buffer, copy.b.buffer === copy.buffer,"
                  "  copy.a.byteOffset, copy.a[0], new Uint8Array(buffer)[3], new Uint8Array(copy.buffer)[3]].join();")
                .asString()
            == "true,true,2,7,0,9");
    }

    TEST_CASE("transfers ArrayBuffers")
    {
        WebFixture f;
        CHECK(f.run("const buffer = new Uint8Array([1, 2, 3]).buffer; const view = new Uint8Array(buffer, 1);"
                    "const copy = structuredClone({ view }, { transfer: [buffer] });"
                    "globalThis.result = [buffer.detached, Array.from(copy.view).join(' ')].join();")
                  .asString()
              == "true,2 3");
        CHECK(f.error("const b = new ArrayBuffer(1); structuredClone(b, { transfer: [b, b] });").find("DataCloneError")
              != std::string::npos);
    }

    TEST_CASE("clones errors and rejects unclonable values")
    {
        WebFixture f;
        CHECK(f.run("const e = structuredClone(new RangeError('bad', { cause: 1 }));"
                    "globalThis.result = [e instanceof RangeError, e.message, e.cause].join();")
                  .asString()
              == "true,bad,1");
        for (const char* value : { "() => {}", "Symbol('s')", "{ f() {} }", "Promise.resolve()", "new WeakMap()" })
        {
            CAPTURE(value);
            CHECK(f.error(std::string("structuredClone(") + value + ");").find("DataCloneError") != std::string::npos);
        }
    }

    TEST_CASE("class instances become plain objects")
    {
        WebFixture f;
        CHECK(f.run("class Point { constructor() { this.x = 1; } get twice() { return 2; } }"
                    "const copy = structuredClone(new Point());"
                    "globalThis.result = [Object.getPrototypeOf(copy) === Object.prototype, copy.x,"
                    "  copy.twice].join();")
                  .asString()
              == "true,1,");
    }
}
