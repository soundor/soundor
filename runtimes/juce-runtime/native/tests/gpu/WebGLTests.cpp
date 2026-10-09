#include "../web/WebTestSupport.h"
#include "GpuTestSupport.h"

#include <cstdint>
#include <string>
#include <vector>

using namespace soundor;
using test::WebFixture;

namespace
{
    RuntimeHost::Options onDevice(std::shared_ptr<gpu::Device> device)
    {
        RuntimeHost::Options options;
        options.gpuDevice = std::move(device);
        options.allowSoftwareGpu = true;
        return options;
    }

    // A 64×64 canvas `c` filling a 64×64 view, its WebGL 2 context `gl`
    // (unless `attributes` is null), and helpers:
    //   program(vertex, fragment): a linked program (throws with the logs)
    //   px(x, y): the RGBA at (x, y) of what is bound for reading, OpenGL's
    //   way up (y = 0 at the bottom)
    //   triangle(): draws a red triangle over the lower left half.
    struct WebGLFixture : WebFixture
    {
        explicit WebGLFixture(std::shared_ptr<gpu::Device> device, const std::string& attributes = "{}")
            : WebFixture(onDevice(std::move(device)))
        {
            host.surface().setSize({ 64, 64 });
            run(R"(
                import { root, createCanvas } from 'soundor:ui';
                const g = globalThis;
                g.c = createCanvas({ width: 64, height: 64 });
                root.appendChild(g.c);
                g.c.width = 64;
                g.c.height = 64;
                g.gl = )"
                + (attributes == "null" ? "null" : "g.c.getContext('webgl2', " + attributes + ")") + R"(;
                g.program = (vertex, fragment, context = g.gl) => {
                    const gl = context;
                    const compile = (type, source) => {
                        const shader = gl.createShader(type);
                        gl.shaderSource(shader, source);
                        gl.compileShader(shader);
                        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
                            throw new Error(gl.getShaderInfoLog(shader));
                        return shader;
                    };
                    const p = gl.createProgram();
                    gl.attachShader(p, compile(gl.VERTEX_SHADER, vertex));
                    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
                    gl.linkProgram(p);
                    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
                        throw new Error(gl.getProgramInfoLog(p));
                    return p;
                };
                g.px = (x, y, context = g.gl) => {
                    const out = new Uint8Array(4);
                    context.readPixels(x, y, 1, 1, context.RGBA, context.UNSIGNED_BYTE, out);
                    return Array.from(out).join(',');
                };
                g.vertex = `#version 300 es
                    in vec2 position;
                    void main() { gl_Position = vec4(position, 0.0, 1.0); }`;
                g.red = `#version 300 es
                    precision mediump float;
                    uniform vec4 color;
                    out vec4 fragColor;
                    void main() { fragColor = color; }`;
                g.triangle = (context = g.gl) => {
                    const gl = context;
                    const p = g.program(g.vertex, g.red, gl);
                    gl.useProgram(p);
                    gl.uniform4f(gl.getUniformLocation(p, 'color'), 1, 0, 0, 1);
                    const vao = gl.createVertexArray();
                    gl.bindVertexArray(vao);
                    const buffer = gl.createBuffer();
                    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
                    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1]), gl.STATIC_DRAW);
                    const at = gl.getAttribLocation(p, 'position');
                    gl.enableVertexAttribArray(at);
                    gl.vertexAttribPointer(at, 2, gl.FLOAT, false, 0, 0);
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    return { program: p, vao, buffer };
                };
            )");
        }

        std::string string(const std::string& expression) { return eval(expression).asString(); }
        double number(const std::string& expression) { return eval(expression).asNumber(); }
        bool boolean(const std::string& expression) { return eval(expression).asBoolean(); }

        // The view rendered: the RGBA at (x, y), y down, unpremultiplied.
        std::string shown(int x, int y)
        {
            constexpr std::size_t side = 64;
            std::vector<std::uint32_t> pixels(side * side, 0);
            host.render({ pixels.data(), 64, 64, side * 4 });
            const std::uint32_t value = pixels[(static_cast<std::size_t>(y) * side) + static_cast<std::size_t>(x)];
            const unsigned a = value >> 24;
            const auto channel = [&](int shift)
            {
                const unsigned premultiplied = (value >> shift) & 0xFF;
                return a == 0 ? 0U : (premultiplied * 255 + a / 2) / a;
            };
            return std::to_string(channel(16)) + "," + std::to_string(channel(8)) + "," + std::to_string(channel(0))
                   + "," + std::to_string(a);
        }
    };
} // namespace

TEST_SUITE("WebGL 2")
{
    TEST_CASE("getContext('webgl2') gives one WebGL2RenderingContext, sized like the canvas")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device);
        REQUIRE(f.boolean("gl !== null"));
        CHECK(f.boolean("gl instanceof WebGL2RenderingContext"));
        CHECK(f.boolean("c.getContext('webgl2') === gl"));
        CHECK(f.boolean("c.getContext('2d') === null"));
        CHECK(f.boolean("gl.canvas === c"));
        CHECK(f.number("gl.drawingBufferWidth") == 64);
        CHECK(f.number("gl.drawingBufferHeight") == 64);
        CHECK(f.boolean("gl.TRIANGLES === 4 && WebGL2RenderingContext.TRIANGLES === 4"));
        CHECK(f.string("gl.getParameter(gl.VERSION)").starts_with("WebGL 2.0"));
        CHECK(f.string("gl.getParameter(gl.SHADING_LANGUAGE_VERSION)").starts_with("WebGL GLSL ES 3.00"));
        CHECK(f.string("JSON.stringify(gl.getContextAttributes())").find("\"preserveDrawingBuffer\":false")
              != std::string::npos);
        CHECK(f.number("gl.getError()") == 0);
        CHECK(f.string("typeof WebGLBuffer + typeof WebGLTexture + typeof WebGLUniformLocation")
              == "functionfunctionfunction");
        CHECK(f.error("new WebGLBuffer()").find("Illegal constructor") != std::string::npos);
    }

    TEST_CASE("a raw triangle: drawn, read back, and shown in the canvas the right way up")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device, "{ antialias: false }");
        f.run(R"(
            gl.clearColor(0, 0, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            triangle();
        )");
        CHECK(f.number("gl.getError()") == 0);
        // OpenGL's way up: the lower left is red, the upper right blue.
        CHECK(f.string("px(4, 4)") == "255,0,0,255");
        CHECK(f.string("px(60, 60)") == "0,0,255,255");
        // On screen, y goes down: the lower left is at the bottom.
        f.host.tick();
        CHECK(f.shown(4, 60) == "255,0,0,255");
        CHECK(f.shown(60, 4) == "0,0,255,255");
    }

    TEST_CASE("antialiased drawing is resolved for reading and showing")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device);
        CHECK(f.boolean("gl.getContextAttributes().antialias"));
        f.run("gl.clearColor(0, 1, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); triangle();");
        CHECK(f.string("px(4, 4)") == "255,0,0,255");
        CHECK(f.string("px(60, 60)") == "0,255,0,255");
        f.host.tick();
        CHECK(f.shown(4, 60) == "255,0,0,255");
        CHECK(f.shown(60, 4) == "0,255,0,255");
    }

    TEST_CASE("the drawing buffer is cleared after it is shown, unless preserved")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        {
            WebGLFixture f(device, "{ antialias: false }");
            f.run("gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);");
            f.host.tick();
            CHECK(f.shown(10, 10) == "255,0,0,255");
            // Not drawn since: still shown, but a read finds it cleared.
            f.host.tick();
            CHECK(f.shown(10, 10) == "255,0,0,255");
            CHECK(f.string("px(10, 10)") == "0,0,0,0");
        }
        {
            WebGLFixture f(device, "{ antialias: false, preserveDrawingBuffer: true }");
            f.run("gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);");
            f.host.tick();
            CHECK(f.string("px(10, 10)") == "255,0,0,255");
        }
    }

    TEST_CASE("alpha: false shows opaque; premultipliedAlpha: false is premultiplied when shown")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        {
            WebGLFixture f(device, "{ alpha: false, antialias: false }");
            f.run("gl.clearColor(1, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);");
            f.host.tick();
            CHECK(f.shown(10, 10) == "255,0,0,255");
        }
        {
            WebGLFixture f(device, "{ premultipliedAlpha: false, antialias: false }");
            f.run("gl.clearColor(1, 0, 0, 0.5); gl.clear(gl.COLOR_BUFFER_BIT);");
            f.host.tick();
            // Unpremultiplied red at half alpha.
            const std::string shown = f.shown(10, 10);
            CHECK(shown.starts_with("255,0,0,12"));
        }
    }

    TEST_CASE("buffers: data in, data out, and their parameters")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device);
        f.run(R"(
            const b = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, b);
            gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), gl.DYNAMIC_DRAW);
            gl.bufferSubData(gl.ARRAY_BUFFER, 2, new Uint8Array([9, 9, 9, 9]), 1, 2);
            const out = new Uint8Array(8);
            gl.getBufferSubData(gl.ARRAY_BUFFER, 0, out);
            globalThis.result = [Array.from(out).join(' '),
                                 gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE),
                                 gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_USAGE) === gl.DYNAMIC_DRAW,
                                 gl.getParameter(gl.ARRAY_BUFFER_BINDING) === b,
                                 gl.isBuffer(b)].join(',');
            gl.bufferData(gl.ARRAY_BUFFER, 16, gl.STATIC_DRAW);
        )");
        CHECK(f.string("result") == "1 2 9 9 5 6 7 8,8,true,true,true");
        CHECK(f.number("gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE)") == 16);
        CHECK(f.number("gl.getError()") == 0);
        // Out of the source's range: INVALID_VALUE, nothing uploaded.
        f.run("gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(4), gl.STATIC_DRAW, 5);");
        CHECK(f.number("gl.getError()") == f.number("gl.INVALID_VALUE"));
        f.run("gl.deleteBuffer(gl.getParameter(gl.ARRAY_BUFFER_BINDING));");
        CHECK(f.boolean("gl.getParameter(gl.ARRAY_BUFFER_BINDING) === null"));
    }

    TEST_CASE("textures: uploaded from arrays (flipped if asked) and sampled")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device, "{ antialias: false }");
        f.run(R"(
            const p = program(`#version 300 es
                in vec2 position;
                out vec2 uv;
                void main() { uv = position * 0.5 + 0.5; gl_Position = vec4(position, 0.0, 1.0); }`,
                `#version 300 es
                precision mediump float;
                uniform sampler2D image;
                in vec2 uv;
                out vec4 fragColor;
                void main() { fragColor = texture(image, uv); }`);
            gl.useProgram(p);
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            // Rows: red then green, the first row being the bottom one to OpenGL.
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                          new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.uniform1i(gl.getUniformLocation(p, 'image'), 0);
            const b = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, b);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(gl.getAttribLocation(p, 'position'), 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            globalThis.result = [px(10, 10), px(10, 50)].join(' ');
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 2, 0, gl.RGBA, gl.UNSIGNED_BYTE,
                          new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255]));
            gl.drawArrays(gl.TRIANGLES, 0, 3);
            globalThis.result += ' ' + [px(10, 10), px(10, 50)].join(' ');
        )");
        CHECK(f.string("result") == "255,0,0,255 0,255,0,255 0,255,0,255 255,0,0,255");
        CHECK(f.boolean("gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL)"));
        CHECK(f.number("gl.getError()") == 0);
        // Too little data for the size: OpenGL's (robust) refusal.
        f.run("gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 4, 4, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));");
        CHECK(f.number("gl.getError()") == f.number("gl.INVALID_OPERATION"));
    }

    TEST_CASE("framebuffers: drawing into a texture, and back to the drawing buffer with null")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device, "{ antialias: false }");
        f.run(R"(
            gl.clearColor(0, 0, 1, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 8, 8);
            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            gl.viewport(0, 0, 8, 8);
            gl.clearColor(0, 1, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
            const inside = px(2, 2);
            const bound = gl.getParameter(gl.FRAMEBUFFER_BINDING) === fb;
            const attached = gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                                                                  gl.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) === t;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.viewport(0, 0, 64, 64);
            globalThis.result = [status, inside, bound, attached, px(2, 2),
                                 gl.getParameter(gl.FRAMEBUFFER_BINDING)].join(' ');
        )");
        CHECK(f.string("result") == "true 0,255,0,255 true true 0,0,255,255 ");
        CHECK(f.number("gl.getError()") == 0);
        // The drawing buffer takes no attachments.
        f.run("gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, gl.createTexture(), 0);");
        CHECK(f.number("gl.getError()") == f.number("gl.INVALID_OPERATION"));
        CHECK(f.number("gl.getFramebufferAttachmentParameter(gl.FRAMEBUFFER, gl.BACK, "
                       "gl.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE)")
              == f.number("gl.FRAMEBUFFER_DEFAULT"));
        CHECK(f.number("gl.getParameter(gl.READ_BUFFER)") == f.number("gl.BACK"));
    }

    TEST_CASE("objects are checked: deleted, from another context, or of the wrong type")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device);
        f.run(R"(
            import { root, createCanvas } from 'soundor:ui';
            const other = createCanvas({ width: 8, height: 8 });
            root.appendChild(other);
            globalThis.gl2 = other.getContext('webgl2');
        )");
        REQUIRE(f.boolean("gl2 !== null && gl2 !== gl"));
        f.run("gl.bindBuffer(gl.ARRAY_BUFFER, gl2.createBuffer());");
        CHECK(f.number("gl.getError()") == f.number("gl.INVALID_OPERATION"));
        CHECK(f.number("gl.getError()") == 0);
        f.run("const b = gl.createBuffer(); gl.deleteBuffer(b); gl.bindBuffer(gl.ARRAY_BUFFER, b);"
              "globalThis.result = gl.isBuffer(b);");
        CHECK_FALSE(f.boolean("result"));
        CHECK(f.number("gl.getError()") == f.number("gl.INVALID_OPERATION"));
        CHECK(f.error("gl.bindBuffer(gl.ARRAY_BUFFER, gl.createTexture());").find("WebGLBuffer") != std::string::npos);
        CHECK(f.error("gl.bindBuffer(gl.ARRAY_BUFFER);").find("2 arguments required") != std::string::npos);
        // A location of another program, or of an earlier link.
        f.run(R"(
            const a = program(vertex, red);
            const b = program(vertex, red);
            const at = gl.getUniformLocation(a, 'color');
            gl.useProgram(b);
            gl.uniform4f(at, 1, 1, 1, 1);
            globalThis.first = gl.getError();
            gl.useProgram(a);
            gl.uniform4f(at, 1, 1, 1, 1);
            globalThis.second = gl.getError();
            gl.linkProgram(a);
            gl.uniform4f(at, 1, 1, 1, 1);
            globalThis.third = gl.getError();
            gl.uniform4f(null, 1, 1, 1, 1);
            globalThis.fourth = gl.getError();
            const fresh = gl.getUniformLocation(a, 'color');
            gl.uniform4fv(fresh, [0.25, 0.5, 0.75, 1]);
            globalThis.value = Array.from(gl.getUniform(a, fresh)).join(',');
        )");
        CHECK(f.number("first") == f.number("gl.INVALID_OPERATION"));
        CHECK(f.number("second") == 0);
        CHECK(f.number("third") == f.number("gl.INVALID_OPERATION"));
        CHECK(f.number("fourth") == 0);
        CHECK(f.string("value") == "0.25,0.5,0.75,1");
        // OpenGL's own validation (ANGLE's, in WebGL mode).
        f.run("gl.enable(0x1234);");
        CHECK(f.number("gl.getError()") == f.number("gl.INVALID_ENUM"));
    }

    TEST_CASE("getParameter answers with WebGL's types")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device);
        CHECK(f.string("gl.getParameter(gl.VIEWPORT).constructor.name + gl.getParameter(gl.VIEWPORT).join(',')")
              == "Int32Array0,0,64,64");
        CHECK(f.string("gl.getParameter(gl.COLOR_CLEAR_VALUE).constructor.name") == "Float32Array");
        CHECK(f.string("JSON.stringify(gl.getParameter(gl.COLOR_WRITEMASK))") == "[true,true,true,true]");
        CHECK(f.boolean("gl.getParameter(gl.DEPTH_TEST) === false"));
        CHECK(f.boolean("gl.getParameter(gl.CURRENT_PROGRAM) === null"));
        CHECK(f.number("gl.getParameter(gl.MAX_TEXTURE_SIZE)") >= 2048);
        CHECK(f.number("gl.getParameter(gl.STENCIL_WRITEMASK)") >= 255);
        CHECK(f.boolean("gl.getParameter(0x1234) === null && gl.getError() === gl.INVALID_ENUM"));
        CHECK(f.boolean("gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT).precision > 0"));
        CHECK(f.boolean("gl.getSupportedExtensions().includes('WEBGL_lose_context')"));
        CHECK(f.boolean("gl.getExtension('webgl_debug_renderer_info') !== null"));
        CHECK(f.boolean("typeof gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)"
                        " === 'string'"));
        CHECK(f.boolean("gl.getExtension('NOT_AN_EXTENSION') === null"));
        // Everywhere, emulated where the driver lacks it.
        CHECK(f.boolean("gl.getSupportedExtensions().includes('KHR_parallel_shader_compile')"));
        CHECK(f.boolean(
            "(() => { const ext = gl.getExtension('KHR_parallel_shader_compile');"
            " const p = gl.createProgram();"
            " return gl.getProgramParameter(p, ext.COMPLETION_STATUS_KHR) === true && gl.getError() === 0; })()"));
    }

    TEST_CASE("resizing the canvas resizes and clears the drawing buffer")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device, "{ antialias: false, preserveDrawingBuffer: true }");
        f.run("gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); c.width = 32; c.height = 16;");
        CHECK(f.number("gl.drawingBufferWidth") == 32);
        CHECK(f.number("gl.drawingBufferHeight") == 16);
        CHECK(f.string("px(4, 4)") == "0,0,0,0");
        CHECK(f.number("gl.getError()") == 0);
    }

    TEST_CASE("losing the context: reported once, then every call does nothing")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device);
        f.run(R"(
            globalThis.events = 0;
            c.addEventListener('webglcontextlost', () => { globalThis.events += 1; });
            gl.getExtension('WEBGL_lose_context').loseContext();
        )");
        CHECK(f.boolean("gl.isContextLost()"));
        CHECK(f.number("gl.getError()") == f.number("gl.CONTEXT_LOST_WEBGL"));
        CHECK(f.number("gl.getError()") == 0);
        CHECK(f.boolean("gl.createBuffer() === null && gl.getParameter(gl.VIEWPORT) === null"));
        CHECK(f.tickUntil("events === 1"));
        CHECK(f.boolean("gl.getContextAttributes() === null"));
    }

    TEST_CASE("unsupported features fail clearly")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device);
        CHECK(f.error("gl.drawingBufferStorage(gl.RGBA8, 1, 1);").find("not supported by Soundor's WebGL")
              != std::string::npos);
        CHECK(f.error("gl.getExtension('WEBGL_lose_context').restoreContext();").find("not supported")
              != std::string::npos);
        CHECK(f.error("gl.drawingBufferColorSpace = 'display-p3';").find("not supported") != std::string::npos);
    }

    TEST_CASE("canvases are texture sources")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        WebGLFixture f(device, "{ antialias: false }");
        f.run(R"(
            import { createCanvas } from 'soundor:ui';
            const source = createCanvas({ width: 2, height: 2 });
            source.width = 2;
            source.height = 2;
            const ctx = source.getContext('2d');
            ctx.fillStyle = 'rgb(0, 0, 255)';
            ctx.fillRect(0, 0, 2, 1); // the top row
            ctx.fillStyle = 'rgb(255, 255, 0)';
            ctx.fillRect(0, 1, 2, 1);
            const t = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, t);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
            // Not flipped: the canvas's top row is the texture's first.
            globalThis.result = [px(0, 0), px(0, 1)].join(' ');
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE,
                          { width: 1, height: 1, data: new Uint8ClampedArray([1, 2, 3, 4]) });
            globalThis.result += ' ' + px(0, 0);
        )");
        CHECK(f.string("result") == "0,0,255,255 255,255,0,255 1,2,3,4");
        CHECK(f.number("gl.getError()") == 0);
        CHECK(f.error("gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.FLOAT, c);").find("not supported")
              != std::string::npos);
    }

    TEST_CASE("without a GPU device allowed, getContext('webgl2') is null and says why")
    {
        // Hardware only, as in a plugin: whether there is one decides.
        std::string failure;
        const bool hardware = gpu::Device::create({ .policy = gpu::DevicePolicy::HardwareOnly }, &failure) != nullptr;
        WebFixture f;
        f.host.surface().setSize({ 64, 64 });
        f.run(R"(
            import { root, createCanvas } from 'soundor:ui';
            const c = createCanvas();
            root.appendChild(c);
            globalThis.gl = c.getContext('webgl2');
            globalThis.second = c.getContext('2d') !== null;
        )");
        if (hardware)
            CHECK(f.eval("gl !== null").asBoolean());
        else
        {
            CHECK(f.eval("gl === null && second").asBoolean());
            bool reported = false;
            for (const auto& [level, message] : f.logs)
                reported = reported || message.find("getContext('webgl2'): no GPU for WebGL") != std::string::npos;
            CHECK(reported);
        }
    }
}
