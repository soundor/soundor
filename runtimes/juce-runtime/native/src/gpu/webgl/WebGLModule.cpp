#include "gpu/webgl/WebGLModule.h"

#include "gpu/webgl/WebGLContext.h"
#include "js/Bindings.h"

#include <algorithm>
#include <cmath>
#include <cstring>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
{
    namespace
    {
        namespace bind = js::bind;

        const char webglKey = 0;

        // A context's WebGL world: its device, its contexts by id, and the
        // fences their code made (OpenGL's are pointers), by id.
        struct WebGL
        {
            std::shared_ptr<Device> device;
            bool allowSoftware = false;
            std::string unavailable; // why there is no device, once known
            std::map<std::uint32_t, std::unique_ptr<WebGLContext>> contexts;
            std::map<std::uint32_t, std::shared_ptr<ui::CanvasBuffer>> canvases;
            std::map<std::uint32_t, WebGLContext::Attributes> attributes;
            std::map<std::uint32_t, GLsync> syncs;
            std::uint32_t nextContext = 1;
            std::uint32_t nextSync = 1;
            std::vector<std::uint8_t> scratch;
        };

        WebGL& webglOf(JSContext* ctx)
        {
            auto* webgl = bind::contextData<WebGL>(ctx, &webglKey);
            if (webgl == nullptr)
                throw std::logic_error("WebGL is not installed in this context");
            return *webgl;
        }

        // Arguments, converted by webgl.js already.
        struct Args
        {
            JSContext* ctx;
            int argc;
            JSValueConst* argv;

            [[nodiscard]] JSValueConst at(int index) const
            {
                if (index >= argc)
                    throw std::invalid_argument("missing WebGL argument");
                return argv[index];
            }
            [[nodiscard]] double number(int index) const
            {
                double out = 0;
                if (JS_ToFloat64(ctx, &out, at(index)) < 0)
                    throw std::invalid_argument("expected a number");
                return out;
            }
            [[nodiscard]] GLuint u32(int index) const
            {
                std::int64_t out = 0;
                if (JS_ToInt64(ctx, &out, at(index)) < 0)
                    throw std::invalid_argument("expected a number");
                return static_cast<GLuint>(out);
            }
            [[nodiscard]] GLint i32(int index) const { return static_cast<GLint>(i64(index)); }
            [[nodiscard]] std::int64_t i64(int index) const
            {
                std::int64_t out = 0;
                if (JS_ToInt64(ctx, &out, at(index)) < 0)
                    throw std::invalid_argument("expected a number");
                return out;
            }
            [[nodiscard]] GLfloat f32(int index) const { return static_cast<GLfloat>(number(index)); }
            [[nodiscard]] GLboolean boolean(int index) const
            {
                return JS_ToBool(ctx, at(index)) > 0 ? GL_TRUE : GL_FALSE;
            }
            [[nodiscard]] bool flag(int index) const { return index < argc && JS_ToBool(ctx, argv[index]) > 0; }
            [[nodiscard]] std::string string(int index) const
            {
                std::string out;
                if (! bind::read(ctx, at(index), bind::Path { "WebGL" }, out))
                    throw std::invalid_argument("expected a string");
                return out;
            }
            [[nodiscard]] bool isNull(int index) const
            {
                return index >= argc || JS_IsNull(argv[index]) || JS_IsUndefined(argv[index]);
            }
            // The bytes [byteOffset, byteOffset + byteLength) of a view: checked
            // against its extent, so OpenGL never reads or writes past it.
            [[nodiscard]] std::span<std::byte> bytes(int view, int offsetAt, int lengthAt) const
            {
                std::span<std::byte> all;
                if (! bind::readBytes(ctx, at(view), bind::Path { "WebGL" }, all))
                    throw std::invalid_argument("expected an ArrayBuffer or a typed array");
                const std::int64_t offset = i64(offsetAt);
                const std::int64_t length = i64(lengthAt);
                if (offset < 0 || length < 0 || static_cast<std::size_t>(offset + length) > all.size())
                    throw std::out_of_range("outside the buffer");
                return all.subspan(static_cast<std::size_t>(offset), static_cast<std::size_t>(length));
            }
            [[nodiscard]] std::vector<GLuint> u32s(int index) const
            {
                std::vector<double> numbers;
                if (! bind::readArray(ctx, at(index), bind::Path { "WebGL" }, numbers,
                                      [](JSContext* c, JSValueConst value, const bind::Path& path, double& element)
                                      { return bind::read(c, value, path, element); }))
                    throw std::invalid_argument("expected an array of numbers");
                std::vector<GLuint> out;
                out.reserve(numbers.size());
                for (const double number : numbers)
                    out.push_back(static_cast<GLuint>(static_cast<std::int64_t>(number)));
                return out;
            }
            [[nodiscard]] std::vector<std::string> strings(int index) const
            {
                std::vector<std::string> out;
                if (! bind::readArray(ctx, at(index), bind::Path { "WebGL" }, out,
                                      [](JSContext* c, JSValueConst value, const bind::Path& path, std::string& element)
                                      { return bind::read(c, value, path, element); }))
                    throw std::invalid_argument("expected an array of strings");
                return out;
            }
        };

        // A byte offset into a bound buffer, as OpenGL's pointer arguments take it.
        void* offset(std::int64_t bytes)
        {
            // NOLINTNEXTLINE(performance-no-int-to-ptr): OpenGL's offsets are pointers.
            return reinterpret_cast<void*>(static_cast<std::intptr_t>(bytes));
        }

#include "gpu/webgl/generated/WebGLGenerated.inc"

        // The hand-written operations, numbered after the generated ones.
        enum class HandOp : std::uint8_t
        {
            BindFramebuffer,
            GetError,
            UseProgram,
            DeleteFramebuffer,
            FramebufferTexture2D,
            FramebufferRenderbuffer,
            LinkProgram,
            SamplerParameteri,
            SamplerParameterf,
            ShaderSource,
            GetShaderInfoLog,
            GetProgramInfoLog,
            GetShaderSource,
            GetShaderParameter,
            GetProgramParameter,
            GetUniformLocation,
            GetAttribLocation,
            BindAttribLocation,
            GetActiveAttrib,
            GetActiveUniform,
            BufferData,
            BufferSubData,
            GetBufferSubData,
            TexImage2D,
            TexSubImage2D,
            TexImage3D,
            TexSubImage3D,
            TexImage2DOffset,
            TexSubImage2DOffset,
            ReadPixels,
            ReadPixelsOffset,
            Uniformv,
            VertexAttribv,
            GetParameter,
            GetIndexedParameter,
            GetBufferParameter,
            GetRenderbufferParameter,
            GetTexParameter,
            GetFramebufferAttachmentParameter,
            GetVertexAttrib,
            GetVertexAttribCurrent,
            GetQueryParameter,
            GetSamplerParameter,
            GetSyncParameter,
            GetInternalformatParameter,
            GetQuery,
            GetUniform,
            DrawBuffers,
            InvalidateFramebuffer,
            InvalidateSubFramebuffer,
            ClearBufferv,
            FenceSync,
            ClientWaitSync,
            WaitSync,
            DeleteSync,
            IsSync,
            GetShaderPrecisionFormat,
            GetExtensions,
            RequestExtension,
            TransformFeedbackVaryings,
            GetTransformFeedbackVarying,
            GetUniformIndices,
            GetActiveUniforms,
            GetUniformBlockIndex,
            GetActiveUniformBlockParameter,
            GetActiveUniformBlockName,
            GetFragDataLocation,
            CompressedTexImage2D,
            CompressedTexSubImage2D,
            CompressedTexImage3D,
            CompressedTexSubImage3D,
            GetAttachedShaders,
            DrawingBufferSize,
            TexImageCanvas,
            TexSubImageCanvas,
            GetString,
            GetVertexAttribOffset,
        };

        // ── Values ───────────────────────────────────────────────────────────

        JSValue numbers(JSContext* ctx, std::span<const double> values)
        {
            JSValue array = JS_NewArray(ctx);
            for (std::size_t i = 0; i < values.size(); ++i)
                JS_SetPropertyUint32(ctx, array, static_cast<std::uint32_t>(i), JS_NewFloat64(ctx, values[i]));
            return array;
        }

        template <typename T>
        JSValue numbersOf(JSContext* ctx, std::span<const T> values)
        {
            std::vector<double> converted;
            converted.reserve(values.size());
            for (const T value : values)
                converted.push_back(static_cast<double>(value));
            return numbers(ctx, converted);
        }

        JSValue string(JSContext* ctx, std::string_view value)
        {
            return JS_NewStringLen(ctx, value.data(), value.size());
        }

        // The name, type and size of an active attribute, uniform or varying.
        JSValue activeInfo(JSContext* ctx, GLint size, GLenum type, const std::vector<char>& name, GLsizei length)
        {
            JSValue array = JS_NewArray(ctx);
            JS_SetPropertyUint32(ctx, array, 0, JS_NewInt32(ctx, size));
            JS_SetPropertyUint32(ctx, array, 1, JS_NewUint32(ctx, type));
            JS_SetPropertyUint32(ctx, array, 2,
                                 string(ctx, std::string_view(name.data(), static_cast<std::size_t>(length))));
            return array;
        }

        std::string infoLog(GLuint object, bool program)
        {
            GLint length = 0;
            (program ? glGetProgramiv : glGetShaderiv)(object, GL_INFO_LOG_LENGTH, &length);
            std::string log(static_cast<std::size_t>(std::max(length, 1)), '\0');
            GLsizei written = 0;
            if (program)
                glGetProgramInfoLog(object, length, &written, log.data());
            else
                glGetShaderInfoLog(object, length, &written, log.data());
            log.resize(static_cast<std::size_t>(written));
            return log;
        }

        // Bytes per pixel of `format` and `type` (0: unknown).
        std::size_t pixelSize(GLenum format, GLenum type)
        {
            std::size_t components = 0;
            switch (format)
            {
                case GL_RED:
                case GL_RED_INTEGER:
                case GL_ALPHA:
                case GL_LUMINANCE:
                case GL_DEPTH_COMPONENT:
                    components = 1;
                    break;
                case GL_RG:
                case GL_RG_INTEGER:
                case GL_LUMINANCE_ALPHA:
                case GL_DEPTH_STENCIL:
                    components = 2;
                    break;
                case GL_RGB:
                case GL_RGB_INTEGER:
                    components = 3;
                    break;
                case GL_RGBA:
                case GL_RGBA_INTEGER:
                    components = 4;
                    break;
                default:
                    return 0;
            }
            switch (type)
            {
                case GL_UNSIGNED_BYTE:
                case GL_BYTE:
                    return components;
                case GL_UNSIGNED_SHORT:
                case GL_SHORT:
                case GL_HALF_FLOAT:
                case GL_HALF_FLOAT_OES:
                    return components * 2;
                case GL_UNSIGNED_INT:
                case GL_INT:
                case GL_FLOAT:
                    return components * 4;
                case GL_UNSIGNED_SHORT_5_6_5:
                case GL_UNSIGNED_SHORT_4_4_4_4:
                case GL_UNSIGNED_SHORT_5_5_5_1:
                    return 2;
                case GL_UNSIGNED_INT_2_10_10_10_REV:
                case GL_UNSIGNED_INT_10F_11F_11F_REV:
                case GL_UNSIGNED_INT_5_9_9_9_REV:
                case GL_UNSIGNED_INT_24_8:
                    return 4;
                case GL_FLOAT_32_UNSIGNED_INT_24_8_REV:
                    return 8;
                default:
                    return 0;
            }
        }

        // WebGL's UNPACK_FLIP_Y_WEBGL and UNPACK_PREMULTIPLY_ALPHA_WEBGL for an
        // upload: the pixels, rows reversed and colors premultiplied (8-bit
        // RGBA only), in a copy. Rows are as packed as UNPACK_ALIGNMENT says.
        std::span<const std::byte> unpacked(WebGL& webgl, std::span<const std::byte> data, GLsizei width,
                                            GLsizei height, GLsizei depth, GLenum format, GLenum type, bool flipY,
                                            bool premultiply)
        {
            const std::size_t pixel = pixelSize(format, type);
            if ((! flipY && ! premultiply) || pixel == 0 || width <= 0 || height <= 0)
                return data;
            GLint alignment = 4;
            glGetIntegerv(GL_UNPACK_ALIGNMENT, &alignment);
            const std::size_t rowBytes = static_cast<std::size_t>(width) * pixel;
            const std::size_t stride = (rowBytes + static_cast<std::size_t>(alignment) - 1)
                                       / static_cast<std::size_t>(alignment) * static_cast<std::size_t>(alignment);
            const std::size_t slices = static_cast<std::size_t>(std::max(depth, 1));
            const std::size_t needed = stride * static_cast<std::size_t>(height) * slices;
            if (data.size() < needed)
                return data; // too short: the robust call refuses it
            webgl.scratch.assign(reinterpret_cast<const std::uint8_t*>(data.data()),
                                 reinterpret_cast<const std::uint8_t*>(data.data()) + data.size());
            for (std::size_t slice = 0; slice < slices; ++slice)
            {
                std::uint8_t* base = webgl.scratch.data() + slice * stride * static_cast<std::size_t>(height);
                const std::uint8_t* source = reinterpret_cast<const std::uint8_t*>(data.data())
                                             + slice * stride * static_cast<std::size_t>(height);
                for (GLsizei y = 0; y < height; ++y)
                {
                    const GLsizei from = flipY ? height - 1 - y : y;
                    std::uint8_t* row = base + static_cast<std::size_t>(y) * stride;
                    std::memcpy(row, source + static_cast<std::size_t>(from) * stride, rowBytes);
                    if (premultiply && format == GL_RGBA && type == GL_UNSIGNED_BYTE)
                        for (std::size_t x = 0; x < rowBytes; x += 4)
                        {
                            const unsigned a = row[x + 3];
                            for (std::size_t c = 0; c < 3; ++c)
                                row[x + c] = static_cast<std::uint8_t>((row[x + c] * a + 127) / 255);
                        }
                }
            }
            return std::as_bytes(std::span<const std::uint8_t>(webgl.scratch));
        }

        GLsizei bufSize(std::span<const std::byte> data)
        {
            return static_cast<GLsizei>(std::min<std::size_t>(data.size(), 0x7FFFFFFF));
        }

        // A canvas's pixels as RGBA bytes, rows top first (or flipped), not
        // premultiplied unless asked: what texImage2D takes from a canvas.
        std::span<const std::byte> canvasPixels(WebGL& webgl, const ui::CanvasBuffer& canvas, bool flipY,
                                                bool premultiply)
        {
            const render::RasterSurface& pixels = canvas.pixels;
            const auto w = static_cast<std::size_t>(pixels.width());
            const auto h = static_cast<std::size_t>(pixels.height());
            webgl.scratch.resize(w * h * 4);
            for (std::size_t y = 0; y < h; ++y)
            {
                const std::uint32_t* row = pixels.pixels() + (flipY ? h - 1 - y : y) * w;
                std::uint8_t* out = webgl.scratch.data() + y * w * 4;
                for (std::size_t x = 0; x < w; ++x)
                {
                    const std::uint32_t p = row[x];
                    unsigned a = p >> 24;
                    unsigned r = (p >> 16) & 0xFF;
                    unsigned g = (p >> 8) & 0xFF;
                    unsigned b = p & 0xFF;
                    if (! premultiply && a != 0 && a != 255)
                    {
                        r = std::min(255U, (r * 255 + a / 2) / a);
                        g = std::min(255U, (g * 255 + a / 2) / a);
                        b = std::min(255U, (b * 255 + a / 2) / a);
                    }
                    out[x * 4] = static_cast<std::uint8_t>(r);
                    out[x * 4 + 1] = static_cast<std::uint8_t>(g);
                    out[x * 4 + 2] = static_cast<std::uint8_t>(b);
                    out[x * 4 + 3] = static_cast<std::uint8_t>(a);
                }
            }
            return std::as_bytes(std::span<const std::uint8_t>(webgl.scratch));
        }

        // getParameter() and friends: values by the type webgl.js asks for.
        enum class Kind : std::uint8_t
        {
            Int,
            Float,
            Bool,
            Int64,
            Uint,
        };

        JSValue parameter(JSContext* ctx, GLenum pname, Kind kind, std::optional<GLuint> index = std::nullopt)
        {
            GLsizei length = 0;
            switch (kind)
            {
                case Kind::Float:
                {
                    std::array<GLfloat, 16> values {};
                    glGetFloatvRobustANGLE(pname, static_cast<GLsizei>(values.size()), &length, values.data());
                    if (length <= 0)
                        return JS_NULL;
                    return numbersOf<GLfloat>(ctx, std::span(values.data(), static_cast<std::size_t>(length)));
                }
                case Kind::Bool:
                {
                    std::array<GLboolean, 16> values {};
                    glGetBooleanvRobustANGLE(pname, static_cast<GLsizei>(values.size()), &length, values.data());
                    if (length <= 0)
                        return JS_NULL;
                    return numbersOf<GLboolean>(ctx, std::span(values.data(), static_cast<std::size_t>(length)));
                }
                case Kind::Int64:
                {
                    std::array<GLint64, 4> values {};
                    if (index)
                        glGetInteger64i_vRobustANGLE(pname, *index, static_cast<GLsizei>(values.size()), &length,
                                                     values.data());
                    else
                        glGetInteger64vRobustANGLE(pname, static_cast<GLsizei>(values.size()), &length, values.data());
                    if (length <= 0)
                        return JS_NULL;
                    return numbersOf<GLint64>(ctx, std::span(values.data(), static_cast<std::size_t>(length)));
                }
                case Kind::Int:
                case Kind::Uint:
                {
                    std::vector<GLint> values(64);
                    if (index)
                        glGetIntegeri_vRobustANGLE(pname, *index, static_cast<GLsizei>(values.size()), &length,
                                                   values.data());
                    else
                    {
                        // Some lists are long (compressed formats).
                        GLint count = 0;
                        if (pname == GL_COMPRESSED_TEXTURE_FORMATS)
                            glGetIntegerv(GL_NUM_COMPRESSED_TEXTURE_FORMATS, &count);
                        values.resize(std::max<std::size_t>(64, static_cast<std::size_t>(count)));
                        glGetIntegervRobustANGLE(pname, static_cast<GLsizei>(values.size()), &length, values.data());
                    }
                    if (length <= 0 && pname != GL_COMPRESSED_TEXTURE_FORMATS)
                        return JS_NULL;
                    values.resize(static_cast<std::size_t>(std::max(length, 0)));
                    if (kind == Kind::Uint)
                    {
                        std::vector<double> unsignedValues;
                        unsignedValues.reserve(values.size());
                        for (const GLint value : values)
                            unsignedValues.push_back(static_cast<GLuint>(value));
                        return numbers(ctx, unsignedValues);
                    }
                    return numbersOf<GLint>(ctx, values);
                }
            }
            return JS_NULL;
        }

        GLint uniformTypeAt(GLuint program, GLint location, GLint& size)
        {
            GLint count = 0;
            glGetProgramiv(program, GL_ACTIVE_UNIFORMS, &count);
            GLint maxLength = 0;
            glGetProgramiv(program, GL_ACTIVE_UNIFORM_MAX_LENGTH, &maxLength);
            std::vector<char> name(static_cast<std::size_t>(std::max(maxLength, 1)) + 8);
            for (GLint i = 0; i < count; ++i)
            {
                GLsizei length = 0;
                GLenum type = 0;
                glGetActiveUniform(program, static_cast<GLuint>(i), static_cast<GLsizei>(name.size()), &length, &size,
                                   &type, name.data());
                std::string base(name.data(), static_cast<std::size_t>(length));
                if (base.ends_with("[0]"))
                    base.resize(base.size() - 3);
                // An array's elements are base[i].
                const GLint first = glGetUniformLocation(program, base.c_str());
                if (first == location)
                    return static_cast<GLint>(type);
                for (GLint element = 1; element < size; ++element)
                    if (glGetUniformLocation(program, (base + "[" + std::to_string(element) + "]").c_str()) == location)
                        return static_cast<GLint>(type);
            }
            return 0;
        }

        // How many numbers a uniform of `type` holds, and as what.
        std::pair<int, Kind> uniformShape(GLenum type)
        {
            switch (type)
            {
                case GL_FLOAT:
                    return { 1, Kind::Float };
                case GL_FLOAT_VEC2:
                    return { 2, Kind::Float };
                case GL_FLOAT_VEC3:
                    return { 3, Kind::Float };
                case GL_FLOAT_VEC4:
                case GL_FLOAT_MAT2:
                    return { 4, Kind::Float };
                case GL_FLOAT_MAT2x3:
                case GL_FLOAT_MAT3x2:
                    return { 6, Kind::Float };
                case GL_FLOAT_MAT2x4:
                case GL_FLOAT_MAT4x2:
                    return { 8, Kind::Float };
                case GL_FLOAT_MAT3:
                    return { 9, Kind::Float };
                case GL_FLOAT_MAT3x4:
                case GL_FLOAT_MAT4x3:
                    return { 12, Kind::Float };
                case GL_FLOAT_MAT4:
                    return { 16, Kind::Float };
                case GL_UNSIGNED_INT:
                    return { 1, Kind::Uint };
                case GL_UNSIGNED_INT_VEC2:
                    return { 2, Kind::Uint };
                case GL_UNSIGNED_INT_VEC3:
                    return { 3, Kind::Uint };
                case GL_UNSIGNED_INT_VEC4:
                    return { 4, Kind::Uint };
                case GL_BOOL:
                    return { 1, Kind::Bool };
                case GL_BOOL_VEC2:
                    return { 2, Kind::Bool };
                case GL_BOOL_VEC3:
                    return { 3, Kind::Bool };
                case GL_BOOL_VEC4:
                    return { 4, Kind::Bool };
                case GL_INT_VEC2:
                    return { 2, Kind::Int };
                case GL_INT_VEC3:
                    return { 3, Kind::Int };
                case GL_INT_VEC4:
                    return { 4, Kind::Int };
                default: // int and samplers
                    return { 1, Kind::Int };
            }
        }

        JSValue callHand(JSContext* ctx, WebGL& webgl, WebGLContext& context, HandOp op, const Args& a)
        {
            switch (op)
            {
                case HandOp::BindFramebuffer:
                    context.bindFramebuffer(a.u32(0), a.u32(1));
                    return JS_UNDEFINED;
                case HandOp::GetError:
                    return JS_NewUint32(ctx, glGetError());
                case HandOp::UseProgram:
                    glUseProgram(a.u32(0));
                    return JS_UNDEFINED;
                case HandOp::DeleteFramebuffer:
                {
                    const GLuint name = a.u32(0);
                    glDeleteFramebuffers(1, &name);
                    // Deleting a bound framebuffer binds the default: the drawing buffer.
                    if (name == context.drawBinding() || name == context.readBinding())
                        context.bindFramebuffer(
                            name == context.drawBinding() && name == context.readBinding()
                                ? GL_FRAMEBUFFER
                                : (name == context.drawBinding() ? GL_DRAW_FRAMEBUFFER : GL_READ_FRAMEBUFFER),
                            0);
                    return JS_UNDEFINED;
                }
                case HandOp::FramebufferTexture2D:
                    glFramebufferTexture2D(a.u32(0), a.u32(1), a.u32(2), a.u32(3), a.i32(4));
                    return JS_UNDEFINED;
                case HandOp::FramebufferRenderbuffer:
                    glFramebufferRenderbuffer(a.u32(0), a.u32(1), a.u32(2), a.u32(3));
                    return JS_UNDEFINED;
                case HandOp::LinkProgram:
                    glLinkProgram(a.u32(0));
                    return JS_UNDEFINED;
                case HandOp::SamplerParameteri:
                    glSamplerParameteri(a.u32(0), a.u32(1), a.i32(2));
                    return JS_UNDEFINED;
                case HandOp::SamplerParameterf:
                    glSamplerParameterf(a.u32(0), a.u32(1), a.f32(2));
                    return JS_UNDEFINED;
                case HandOp::ShaderSource:
                {
                    const std::string source = a.string(1);
                    const char* text = source.c_str();
                    const auto length = static_cast<GLint>(source.size());
                    glShaderSource(a.u32(0), 1, &text, &length);
                    return JS_UNDEFINED;
                }
                case HandOp::GetShaderInfoLog:
                    return string(ctx, infoLog(a.u32(0), false));
                case HandOp::GetProgramInfoLog:
                    return string(ctx, infoLog(a.u32(0), true));
                case HandOp::GetShaderSource:
                {
                    GLint length = 0;
                    glGetShaderiv(a.u32(0), GL_SHADER_SOURCE_LENGTH, &length);
                    std::string source(static_cast<std::size_t>(std::max(length, 1)), '\0');
                    GLsizei written = 0;
                    glGetShaderSource(a.u32(0), length, &written, source.data());
                    source.resize(static_cast<std::size_t>(written));
                    return string(ctx, source);
                }
                case HandOp::GetShaderParameter:
                {
                    GLint value = 0;
                    GLsizei length = 0;
                    glGetShaderivRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetProgramParameter:
                {
                    GLint value = 0;
                    GLsizei length = 0;
                    glGetProgramivRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetUniformLocation:
                    return JS_NewInt32(ctx, glGetUniformLocation(a.u32(0), a.string(1).c_str()));
                case HandOp::GetAttribLocation:
                    return JS_NewInt32(ctx, glGetAttribLocation(a.u32(0), a.string(1).c_str()));
                case HandOp::BindAttribLocation:
                    glBindAttribLocation(a.u32(0), a.u32(1), a.string(2).c_str());
                    return JS_UNDEFINED;
                case HandOp::GetActiveAttrib:
                case HandOp::GetActiveUniform:
                case HandOp::GetTransformFeedbackVarying:
                {
                    const GLuint program = a.u32(0);
                    GLint maxLength = 0;
                    glGetProgramiv(program,
                                   op == HandOp::GetActiveAttrib    ? GL_ACTIVE_ATTRIBUTE_MAX_LENGTH
                                   : op == HandOp::GetActiveUniform ? GL_ACTIVE_UNIFORM_MAX_LENGTH
                                                                    : GL_TRANSFORM_FEEDBACK_VARYING_MAX_LENGTH,
                                   &maxLength);
                    std::vector<char> name(static_cast<std::size_t>(std::max(maxLength, 1)));
                    GLsizei length = -1;
                    GLint size = 0;
                    GLenum type = 0;
                    const auto bufferSize = static_cast<GLsizei>(name.size());
                    if (op == HandOp::GetActiveAttrib)
                        glGetActiveAttrib(program, a.u32(1), bufferSize, &length, &size, &type, name.data());
                    else if (op == HandOp::GetActiveUniform)
                        glGetActiveUniform(program, a.u32(1), bufferSize, &length, &size, &type, name.data());
                    else
                        glGetTransformFeedbackVarying(program, a.u32(1), bufferSize, &length, &size, &type,
                                                      name.data());
                    if (length < 0 || type == 0)
                        return JS_NULL;
                    return activeInfo(ctx, size, type, name, length);
                }
                case HandOp::BufferData:
                {
                    if (a.isNull(1))
                    {
                        glBufferData(a.u32(0), static_cast<GLsizeiptr>(a.i64(3)), nullptr, a.u32(4));
                        return JS_UNDEFINED;
                    }
                    const std::span<std::byte> data = a.bytes(1, 2, 3);
                    glBufferData(a.u32(0), static_cast<GLsizeiptr>(data.size()), data.data(), a.u32(4));
                    return JS_UNDEFINED;
                }
                case HandOp::BufferSubData:
                {
                    const std::span<std::byte> data = a.bytes(2, 3, 4);
                    glBufferSubData(a.u32(0), static_cast<GLintptr>(a.i64(1)), static_cast<GLsizeiptr>(data.size()),
                                    data.data());
                    return JS_UNDEFINED;
                }
                case HandOp::GetBufferSubData:
                {
                    const std::span<std::byte> destination = a.bytes(2, 3, 4);
                    if (destination.empty())
                        return JS_UNDEFINED;
                    void* mapped = glMapBufferRange(a.u32(0), static_cast<GLintptr>(a.i64(1)),
                                                    static_cast<GLsizeiptr>(destination.size()), GL_MAP_READ_BIT);
                    if (mapped != nullptr)
                    {
                        std::memcpy(destination.data(), mapped, destination.size());
                        glUnmapBuffer(a.u32(0));
                    }
                    return JS_UNDEFINED;
                }
                case HandOp::TexImage2D:
                {
                    // target, level, internalformat, width, height, border, format, type, data, offset, length, flipY,
                    // premultiply
                    std::span<const std::byte> data;
                    if (! a.isNull(8))
                        data = unpacked(webgl, a.bytes(8, 9, 10), a.i32(3), a.i32(4), 1, a.u32(6), a.u32(7), a.flag(11),
                                        a.flag(12));
                    glTexImage2DRobustANGLE(a.u32(0), a.i32(1), a.i32(2), a.i32(3), a.i32(4), a.i32(5), a.u32(6),
                                            a.u32(7), bufSize(data), a.isNull(8) ? nullptr : data.data());
                    return JS_UNDEFINED;
                }
                case HandOp::TexSubImage2D:
                {
                    // target, level, x, y, width, height, format, type, data, offset, length, flipY, premultiply
                    const std::span<const std::byte> data = unpacked(webgl, a.bytes(8, 9, 10), a.i32(4), a.i32(5), 1,
                                                                     a.u32(6), a.u32(7), a.flag(11), a.flag(12));
                    glTexSubImage2DRobustANGLE(a.u32(0), a.i32(1), a.i32(2), a.i32(3), a.i32(4), a.i32(5), a.u32(6),
                                               a.u32(7), bufSize(data), data.data());
                    return JS_UNDEFINED;
                }
                case HandOp::TexImage3D:
                {
                    // target, level, internalformat, width, height, depth, border, format, type, data, offset, length,
                    // flipY, premultiply
                    std::span<const std::byte> data;
                    if (! a.isNull(9))
                        data = unpacked(webgl, a.bytes(9, 10, 11), a.i32(3), a.i32(4), a.i32(5), a.u32(7), a.u32(8),
                                        a.flag(12), a.flag(13));
                    glTexImage3DRobustANGLE(a.u32(0), a.i32(1), a.i32(2), a.i32(3), a.i32(4), a.i32(5), a.i32(6),
                                            a.u32(7), a.u32(8), bufSize(data), a.isNull(9) ? nullptr : data.data());
                    return JS_UNDEFINED;
                }
                case HandOp::TexSubImage3D:
                {
                    // target, level, x, y, z, width, height, depth, format, type, data, offset, length, flipY,
                    // premultiply
                    const std::span<const std::byte> data =
                        unpacked(webgl, a.bytes(10, 11, 12), a.i32(5), a.i32(6), a.i32(7), a.u32(8), a.u32(9),
                                 a.flag(13), a.flag(14));
                    glTexSubImage3DRobustANGLE(a.u32(0), a.i32(1), a.i32(2), a.i32(3), a.i32(4), a.i32(5), a.i32(6),
                                               a.i32(7), a.u32(8), a.u32(9), bufSize(data), data.data());
                    return JS_UNDEFINED;
                }
                case HandOp::TexImage2DOffset:
                    // From the bound PIXEL_UNPACK_BUFFER, at an offset.
                    glTexImage2D(a.u32(0), a.i32(1), a.i32(2), a.i32(3), a.i32(4), a.i32(5), a.u32(6), a.u32(7),
                                 offset(a.i64(8)));
                    return JS_UNDEFINED;
                case HandOp::TexSubImage2DOffset:
                    glTexSubImage2D(a.u32(0), a.i32(1), a.i32(2), a.i32(3), a.i32(4), a.i32(5), a.u32(6), a.u32(7),
                                    offset(a.i64(8)));
                    return JS_UNDEFINED;
                case HandOp::ReadPixels:
                {
                    const std::span<std::byte> destination = a.bytes(6, 7, 8);
                    context.prepareRead();
                    GLsizei length = 0;
                    GLsizei columns = 0;
                    GLsizei rows = 0;
                    glReadPixelsRobustANGLE(a.i32(0), a.i32(1), a.i32(2), a.i32(3), a.u32(4), a.u32(5),
                                            static_cast<GLsizei>(std::min<std::size_t>(destination.size(), 0x7FFFFFFF)),
                                            &length, &columns, &rows, destination.data());
                    return JS_UNDEFINED;
                }
                case HandOp::ReadPixelsOffset:
                    context.prepareRead();
                    glReadPixels(a.i32(0), a.i32(1), a.i32(2), a.i32(3), a.u32(4), a.u32(5), offset(a.i64(6)));
                    return JS_UNDEFINED;
                case HandOp::Uniformv:
                {
                    // kind, location, data, byteOffset, byteLength, transpose
                    const int kind = a.i32(0);
                    const GLint location = a.i32(1);
                    const std::span<std::byte> data = a.bytes(2, 3, 4);
                    const auto* f = reinterpret_cast<const GLfloat*>(data.data());
                    const auto* i = reinterpret_cast<const GLint*>(data.data());
                    const auto* u = reinterpret_cast<const GLuint*>(data.data());
                    const GLboolean transpose = a.boolean(5);
                    static constexpr std::array<int, 21> sizes { 1, 2, 3, 4,  1, 2, 3, 4,  1, 2, 3,
                                                                 4, 4, 9, 16, 6, 8, 6, 12, 8, 12 };
                    if (kind < 0 || kind >= static_cast<int>(sizes.size()))
                        throw std::invalid_argument("unknown uniform kind");
                    const auto count = static_cast<GLsizei>(
                        data.size() / 4 / static_cast<std::size_t>(sizes[static_cast<std::size_t>(kind)]));
                    switch (kind)
                    {
                        case 0:
                            glUniform1fv(location, count, f);
                            break;
                        case 1:
                            glUniform2fv(location, count, f);
                            break;
                        case 2:
                            glUniform3fv(location, count, f);
                            break;
                        case 3:
                            glUniform4fv(location, count, f);
                            break;
                        case 4:
                            glUniform1iv(location, count, i);
                            break;
                        case 5:
                            glUniform2iv(location, count, i);
                            break;
                        case 6:
                            glUniform3iv(location, count, i);
                            break;
                        case 7:
                            glUniform4iv(location, count, i);
                            break;
                        case 8:
                            glUniform1uiv(location, count, u);
                            break;
                        case 9:
                            glUniform2uiv(location, count, u);
                            break;
                        case 10:
                            glUniform3uiv(location, count, u);
                            break;
                        case 11:
                            glUniform4uiv(location, count, u);
                            break;
                        case 12:
                            glUniformMatrix2fv(location, count, transpose, f);
                            break;
                        case 13:
                            glUniformMatrix3fv(location, count, transpose, f);
                            break;
                        case 14:
                            glUniformMatrix4fv(location, count, transpose, f);
                            break;
                        case 15:
                            glUniformMatrix2x3fv(location, count, transpose, f);
                            break;
                        case 16:
                            glUniformMatrix2x4fv(location, count, transpose, f);
                            break;
                        case 17:
                            glUniformMatrix3x2fv(location, count, transpose, f);
                            break;
                        case 18:
                            glUniformMatrix3x4fv(location, count, transpose, f);
                            break;
                        case 19:
                            glUniformMatrix4x2fv(location, count, transpose, f);
                            break;
                        default:
                            glUniformMatrix4x3fv(location, count, transpose, f);
                            break;
                    }
                    return JS_UNDEFINED;
                }
                case HandOp::VertexAttribv:
                {
                    // kind, index, data (as many values as the kind needs)
                    const GLuint index = a.u32(1);
                    const std::span<std::byte> data = a.bytes(2, 3, 4);
                    const auto* f = reinterpret_cast<const GLfloat*>(data.data());
                    switch (a.i32(0))
                    {
                        case 0:
                            glVertexAttrib1fv(index, f);
                            break;
                        case 1:
                            glVertexAttrib2fv(index, f);
                            break;
                        case 2:
                            glVertexAttrib3fv(index, f);
                            break;
                        case 3:
                            glVertexAttrib4fv(index, f);
                            break;
                        case 4:
                            glVertexAttribI4iv(index, reinterpret_cast<const GLint*>(data.data()));
                            break;
                        default:
                            glVertexAttribI4uiv(index, reinterpret_cast<const GLuint*>(data.data()));
                            break;
                    }
                    return JS_UNDEFINED;
                }
                case HandOp::GetParameter:
                {
                    const GLenum pname = a.u32(0);
                    const auto kind = static_cast<Kind>(a.i32(1));
                    // The drawing buffer is framebuffer null to WebGL.
                    if (pname == GL_DRAW_FRAMEBUFFER_BINDING)
                        return numbers(ctx, std::array<double, 1> { static_cast<double>(context.drawBinding()) });
                    if (pname == GL_READ_FRAMEBUFFER_BINDING)
                        return numbers(ctx, std::array<double, 1> { static_cast<double>(context.readBinding()) });
                    return parameter(ctx, pname, kind);
                }
                case HandOp::GetIndexedParameter:
                    return parameter(ctx, a.u32(0), static_cast<Kind>(a.i32(2)), a.u32(1));
                case HandOp::GetBufferParameter:
                {
                    GLint64 value = 0;
                    GLsizei length = 0;
                    glGetBufferParameteri64vRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewFloat64(ctx, static_cast<double>(value)) : JS_NULL;
                }
                case HandOp::GetRenderbufferParameter:
                {
                    GLint value = 0;
                    GLsizei length = 0;
                    glGetRenderbufferParameterivRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetTexParameter:
                {
                    GLsizei length = 0;
                    if (a.flag(2))
                    {
                        GLfloat value = 0;
                        glGetTexParameterfvRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                        return length > 0 ? JS_NewFloat64(ctx, value) : JS_NULL;
                    }
                    GLint value = 0;
                    glGetTexParameterivRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetFramebufferAttachmentParameter:
                {
                    GLint value = 0;
                    GLsizei length = 0;
                    glGetFramebufferAttachmentParameterivRobustANGLE(a.u32(0), a.u32(1), a.u32(2), 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetVertexAttrib:
                {
                    GLint value = 0;
                    GLsizei length = 0;
                    glGetVertexAttribivRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetVertexAttribCurrent:
                {
                    std::array<GLfloat, 4> values {};
                    GLsizei length = 0;
                    glGetVertexAttribfvRobustANGLE(a.u32(0), GL_CURRENT_VERTEX_ATTRIB, 4, &length, values.data());
                    return length > 0 ? numbersOf<GLfloat>(ctx, values) : JS_NULL;
                }
                case HandOp::GetQueryParameter:
                {
                    GLuint value = 0;
                    GLsizei length = 0;
                    glGetQueryObjectuivRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewUint32(ctx, value) : JS_NULL;
                }
                case HandOp::GetSamplerParameter:
                {
                    GLsizei length = 0;
                    if (a.flag(2))
                    {
                        GLfloat value = 0;
                        glGetSamplerParameterfvRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                        return length > 0 ? JS_NewFloat64(ctx, value) : JS_NULL;
                    }
                    GLint value = 0;
                    glGetSamplerParameterivRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetSyncParameter:
                {
                    const auto found = webgl.syncs.find(a.u32(0));
                    if (found == webgl.syncs.end())
                        return JS_NULL;
                    GLint value = 0;
                    GLsizei length = 0;
                    glGetSynciv(found->second, a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetInternalformatParameter:
                {
                    GLint count = 0;
                    glGetInternalformativ(a.u32(0), a.u32(1), GL_NUM_SAMPLE_COUNTS, 1, &count);
                    std::vector<GLint> values(static_cast<std::size_t>(std::max(count, 1)));
                    GLsizei length = 0;
                    glGetInternalformativRobustANGLE(a.u32(0), a.u32(1), a.u32(2), static_cast<GLsizei>(values.size()),
                                                     &length, values.data());
                    values.resize(static_cast<std::size_t>(std::max(length, 0)));
                    return numbersOf<GLint>(ctx, values);
                }
                case HandOp::GetQuery:
                {
                    GLint value = 0;
                    GLsizei length = 0;
                    glGetQueryivRobustANGLE(a.u32(0), a.u32(1), 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetUniform:
                {
                    const GLuint program = a.u32(0);
                    const GLint location = a.i32(1);
                    GLint size = 0;
                    const GLint type = uniformTypeAt(program, location, size);
                    if (type == 0)
                        return JS_NULL;
                    const auto [count, kind] = uniformShape(static_cast<GLenum>(type));
                    std::array<double, 16> values {};
                    GLsizei length = 0;
                    if (kind == Kind::Float)
                    {
                        std::array<GLfloat, 16> floats {};
                        glGetUniformfvRobustANGLE(program, location, 16, &length, floats.data());
                        std::copy_n(floats.begin(), count, values.begin());
                    }
                    else if (kind == Kind::Uint)
                    {
                        std::array<GLuint, 16> uints {};
                        glGetUniformuivRobustANGLE(program, location, 16, &length, uints.data());
                        std::copy_n(uints.begin(), count, values.begin());
                    }
                    else
                    {
                        std::array<GLint, 16> ints {};
                        glGetUniformivRobustANGLE(program, location, 16, &length, ints.data());
                        std::copy_n(ints.begin(), count, values.begin());
                    }
                    JSValue result = JS_NewArray(ctx);
                    JS_SetPropertyUint32(ctx, result, 0, JS_NewUint32(ctx, static_cast<std::uint32_t>(type)));
                    JS_SetPropertyUint32(ctx, result, 1,
                                         numbers(ctx, std::span(values.data(), static_cast<std::size_t>(count))));
                    return result;
                }
                case HandOp::DrawBuffers:
                {
                    std::vector<GLuint> buffers = a.u32s(0);
                    // The drawing buffer's one buffer is BACK to WebGL.
                    if (context.drawBinding() == 0)
                        for (GLuint& buffer : buffers)
                            if (buffer == GL_BACK)
                                buffer = GL_COLOR_ATTACHMENT0;
                    glDrawBuffers(static_cast<GLsizei>(buffers.size()), buffers.data());
                    return JS_UNDEFINED;
                }
                case HandOp::InvalidateFramebuffer:
                case HandOp::InvalidateSubFramebuffer:
                {
                    std::vector<GLuint> attachments = a.u32s(1);
                    const GLenum target = a.u32(0);
                    const GLuint bound = target == GL_READ_FRAMEBUFFER ? context.readBinding() : context.drawBinding();
                    if (bound == 0)
                        for (GLuint& attachment : attachments)
                        {
                            if (attachment == GL_COLOR)
                                attachment = GL_COLOR_ATTACHMENT0;
                            else if (attachment == GL_DEPTH)
                                attachment = GL_DEPTH_ATTACHMENT;
                            else if (attachment == GL_STENCIL)
                                attachment = GL_STENCIL_ATTACHMENT;
                        }
                    if (op == HandOp::InvalidateFramebuffer)
                        glInvalidateFramebuffer(target, static_cast<GLsizei>(attachments.size()), attachments.data());
                    else
                        glInvalidateSubFramebuffer(target, static_cast<GLsizei>(attachments.size()), attachments.data(),
                                                   a.i32(2), a.i32(3), a.i32(4), a.i32(5));
                    return JS_UNDEFINED;
                }
                case HandOp::ClearBufferv:
                {
                    // kind (0 f, 1 i, 2 ui), buffer, drawbuffer, data, byteOffset, byteLength
                    context.prepareDraw();
                    const std::span<std::byte> data = a.bytes(3, 4, 5);
                    const GLenum buffer = a.u32(1);
                    const GLint drawbuffer = a.i32(2);
                    if (a.i32(0) == 0)
                        glClearBufferfv(buffer, drawbuffer, reinterpret_cast<const GLfloat*>(data.data()));
                    else if (a.i32(0) == 1)
                        glClearBufferiv(buffer, drawbuffer, reinterpret_cast<const GLint*>(data.data()));
                    else
                        glClearBufferuiv(buffer, drawbuffer, reinterpret_cast<const GLuint*>(data.data()));
                    context.drew();
                    return JS_UNDEFINED;
                }
                case HandOp::FenceSync:
                {
                    GLsync sync = glFenceSync(a.u32(0), a.u32(1));
                    if (sync == nullptr)
                        return JS_NewUint32(ctx, 0);
                    const std::uint32_t id = webgl.nextSync++;
                    webgl.syncs.emplace(id, sync);
                    return JS_NewUint32(ctx, id);
                }
                case HandOp::ClientWaitSync:
                {
                    const auto found = webgl.syncs.find(a.u32(0));
                    if (found == webgl.syncs.end())
                        return JS_NewUint32(ctx, GL_WAIT_FAILED);
                    // WebGL never blocks: the timeout must be 0.
                    return JS_NewUint32(ctx, glClientWaitSync(found->second, a.u32(1), 0));
                }
                case HandOp::WaitSync:
                {
                    const auto found = webgl.syncs.find(a.u32(0));
                    if (found != webgl.syncs.end())
                        glWaitSync(found->second, a.u32(1), GL_TIMEOUT_IGNORED);
                    return JS_UNDEFINED;
                }
                case HandOp::DeleteSync:
                {
                    const auto found = webgl.syncs.find(a.u32(0));
                    if (found != webgl.syncs.end())
                    {
                        glDeleteSync(found->second);
                        webgl.syncs.erase(found);
                    }
                    return JS_UNDEFINED;
                }
                case HandOp::IsSync:
                {
                    const auto found = webgl.syncs.find(a.u32(0));
                    return JS_NewBool(ctx, found != webgl.syncs.end() && glIsSync(found->second) == GL_TRUE);
                }
                case HandOp::GetShaderPrecisionFormat:
                {
                    std::array<GLint, 2> range {};
                    GLint precision = 0;
                    glGetShaderPrecisionFormat(a.u32(0), a.u32(1), range.data(), &precision);
                    return numbers(ctx,
                                   std::array<double, 3> { static_cast<double>(range[0]), static_cast<double>(range[1]),
                                                           static_cast<double>(precision) });
                }
                case HandOp::GetExtensions:
                {
                    // Enabled and requestable OpenGL ES extensions, one string.
                    const auto* enabled = reinterpret_cast<const char*>(glGetString(GL_EXTENSIONS));
                    const auto* requestable =
                        reinterpret_cast<const char*>(glGetString(GL_REQUESTABLE_EXTENSIONS_ANGLE));
                    return string(ctx, std::string(enabled != nullptr ? enabled : "") + " "
                                           + (requestable != nullptr ? requestable : ""));
                }
                case HandOp::RequestExtension:
                {
                    const std::string name = a.string(0);
                    const auto* enabled = reinterpret_cast<const char*>(glGetString(GL_EXTENSIONS));
                    if (enabled != nullptr
                        && (" " + std::string(enabled) + " ").find(" " + name + " ") != std::string::npos)
                        return JS_TRUE;
                    glRequestExtensionANGLE(name.c_str());
                    enabled = reinterpret_cast<const char*>(glGetString(GL_EXTENSIONS));
                    return JS_NewBool(ctx, enabled != nullptr
                                               && (" " + std::string(enabled) + " ").find(" " + name + " ")
                                                      != std::string::npos);
                }
                case HandOp::TransformFeedbackVaryings:
                {
                    const std::vector<std::string> names = a.strings(1);
                    std::vector<const char*> pointers;
                    pointers.reserve(names.size());
                    for (const std::string& name : names)
                        pointers.push_back(name.c_str());
                    glTransformFeedbackVaryings(a.u32(0), static_cast<GLsizei>(pointers.size()), pointers.data(),
                                                a.u32(2));
                    return JS_UNDEFINED;
                }
                case HandOp::GetUniformIndices:
                {
                    const std::vector<std::string> names = a.strings(1);
                    std::vector<const char*> pointers;
                    pointers.reserve(names.size());
                    for (const std::string& name : names)
                        pointers.push_back(name.c_str());
                    std::vector<GLuint> indices(names.size(), GL_INVALID_INDEX);
                    glGetUniformIndices(a.u32(0), static_cast<GLsizei>(pointers.size()), pointers.data(),
                                        indices.data());
                    return numbersOf<GLuint>(ctx, indices);
                }
                case HandOp::GetActiveUniforms:
                {
                    const std::vector<GLuint> indices = a.u32s(1);
                    std::vector<GLint> values(indices.size());
                    glGetActiveUniformsiv(a.u32(0), static_cast<GLsizei>(indices.size()), indices.data(), a.u32(2),
                                          values.data());
                    return numbersOf<GLint>(ctx, values);
                }
                case HandOp::GetUniformBlockIndex:
                    return JS_NewUint32(ctx, glGetUniformBlockIndex(a.u32(0), a.string(1).c_str()));
                case HandOp::GetActiveUniformBlockParameter:
                {
                    const GLuint program = a.u32(0);
                    const GLuint index = a.u32(1);
                    const GLenum pname = a.u32(2);
                    if (pname == GL_UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES)
                    {
                        GLint count = 0;
                        glGetActiveUniformBlockiv(program, index, GL_UNIFORM_BLOCK_ACTIVE_UNIFORMS, &count);
                        std::vector<GLint> values(static_cast<std::size_t>(std::max(count, 0)));
                        GLsizei length = 0;
                        glGetActiveUniformBlockivRobustANGLE(program, index, pname, static_cast<GLsizei>(values.size()),
                                                             &length, values.data());
                        return numbersOf<GLint>(ctx, values);
                    }
                    GLint value = 0;
                    GLsizei length = 0;
                    glGetActiveUniformBlockivRobustANGLE(program, index, pname, 1, &length, &value);
                    return length > 0 ? JS_NewInt32(ctx, value) : JS_NULL;
                }
                case HandOp::GetActiveUniformBlockName:
                {
                    GLint maxLength = 0;
                    glGetProgramiv(a.u32(0), GL_ACTIVE_UNIFORM_BLOCK_MAX_NAME_LENGTH, &maxLength);
                    std::vector<char> name(static_cast<std::size_t>(std::max(maxLength, 1)));
                    GLsizei length = -1;
                    glGetActiveUniformBlockName(a.u32(0), a.u32(1), static_cast<GLsizei>(name.size()), &length,
                                                name.data());
                    if (length < 0)
                        return JS_NULL;
                    return string(ctx, std::string_view(name.data(), static_cast<std::size_t>(length)));
                }
                case HandOp::GetFragDataLocation:
                    return JS_NewInt32(ctx, glGetFragDataLocation(a.u32(0), a.string(1).c_str()));
                // OpenGL reads exactly imageSize bytes: the data's size.
                case HandOp::CompressedTexImage2D:
                {
                    const std::span<std::byte> data = a.bytes(6, 7, 8);
                    glCompressedTexImage2D(a.u32(0), a.i32(1), a.u32(2), a.i32(3), a.i32(4), a.i32(5), bufSize(data),
                                           data.data());
                    return JS_UNDEFINED;
                }
                case HandOp::CompressedTexSubImage2D:
                {
                    const std::span<std::byte> data = a.bytes(7, 8, 9);
                    glCompressedTexSubImage2D(a.u32(0), a.i32(1), a.i32(2), a.i32(3), a.i32(4), a.i32(5), a.u32(6),
                                              bufSize(data), data.data());
                    return JS_UNDEFINED;
                }
                case HandOp::CompressedTexImage3D:
                {
                    const std::span<std::byte> data = a.bytes(7, 8, 9);
                    glCompressedTexImage3D(a.u32(0), a.i32(1), a.u32(2), a.i32(3), a.i32(4), a.i32(5), a.i32(6),
                                           bufSize(data), data.data());
                    return JS_UNDEFINED;
                }
                case HandOp::CompressedTexSubImage3D:
                {
                    const std::span<std::byte> data = a.bytes(9, 10, 11);
                    glCompressedTexSubImage3D(a.u32(0), a.i32(1), a.i32(2), a.i32(3), a.i32(4), a.i32(5), a.i32(6),
                                              a.i32(7), a.u32(8), bufSize(data), data.data());
                    return JS_UNDEFINED;
                }
                case HandOp::GetAttachedShaders:
                {
                    std::array<GLuint, 8> shaders {};
                    GLsizei count = 0;
                    glGetAttachedShaders(a.u32(0), static_cast<GLsizei>(shaders.size()), &count, shaders.data());
                    return numbersOf<GLuint>(ctx,
                                             std::span(shaders.data(), static_cast<std::size_t>(std::max(count, 0))));
                }
                case HandOp::DrawingBufferSize:
                    return numbers(ctx, std::array<double, 2> { static_cast<double>(context.drawingBufferWidth()),
                                                                static_cast<double>(context.drawingBufferHeight()) });
                case HandOp::TexImageCanvas:
                case HandOp::TexSubImageCanvas:
                {
                    // TexImageCanvas: target, level, internalformat, format, type, canvas node, flipY, premultiply
                    // TexSubImageCanvas: target, level, x, y, format, type, canvas node, flipY, premultiply
                    const bool sub = op == HandOp::TexSubImageCanvas;
                    const auto canvas = ui::surfaceOf(ctx).canvasBuffer(static_cast<ui::NodeId>(a.u32(sub ? 6 : 5)));
                    const std::span<const std::byte> data =
                        canvasPixels(webgl, *canvas, a.flag(sub ? 7 : 6), a.flag(sub ? 8 : 7));
                    const GLsizei w = canvas->pixels.width();
                    const GLsizei h = canvas->pixels.height();
                    GLint alignment = 4;
                    glGetIntegerv(GL_UNPACK_ALIGNMENT, &alignment);
                    glPixelStorei(GL_UNPACK_ALIGNMENT, 4);
                    if (sub)
                        glTexSubImage2DRobustANGLE(a.u32(0), a.i32(1), a.i32(2), a.i32(3), w, h, a.u32(4), a.u32(5),
                                                   bufSize(data), data.data());
                    else
                        glTexImage2DRobustANGLE(a.u32(0), a.i32(1), a.i32(2), w, h, 0, a.u32(3), a.u32(4),
                                                bufSize(data), data.data());
                    glPixelStorei(GL_UNPACK_ALIGNMENT, alignment);
                    return JS_UNDEFINED;
                }
                case HandOp::GetVertexAttribOffset:
                {
                    void* pointer = nullptr;
                    glGetVertexAttribPointerv(a.u32(0), a.u32(1), &pointer);
                    return JS_NewInt64(ctx, static_cast<std::int64_t>(reinterpret_cast<std::intptr_t>(pointer)));
                }
                case HandOp::GetString:
                {
                    const auto* value = reinterpret_cast<const char*>(glGetString(a.u32(0)));
                    return value != nullptr ? string(ctx, value) : JS_NULL;
                }
            }
            return JS_UNDEFINED;
        }

        // ── Entry points ─────────────────────────────────────────────────────

        // webglCreate(node, [alpha, depth, stencil, antialias, premultipliedAlpha,
        // preserveDrawingBuffer, failIfMajorPerformanceCaveat]): a context id,
        // or why there is none (a string).
        JSValue webglCreate(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (! bind::expectArgumentCount(ctx, "webglCreate", argc, 2))
                return JS_EXCEPTION;
            return bind::invoke(
                ctx, "webglCreate",
                [&]() -> JSValue
                {
                    const Args a { ctx, argc, argv };
                    WebGL& webgl = webglOf(ctx);
                    const std::vector<GLuint> flags = a.u32s(1);
                    if (flags.size() < 7)
                        throw std::invalid_argument("expected seven attributes");
                    WebGLContext::Attributes attributes { flags[0] != 0, flags[1] != 0, flags[2] != 0, flags[3] != 0,
                                                          flags[4] != 0, flags[5] != 0, flags[6] != 0 };
                    if (webgl.device == nullptr)
                    {
                        if (! webgl.unavailable.empty())
                            return string(ctx, webgl.unavailable);
                        std::string why;
                        webgl.device = Device::create({ .policy = webgl.allowSoftware ? DevicePolicy::AllowSoftware
                                                                                      : DevicePolicy::HardwareOnly },
                                                      &why);
                        if (webgl.device == nullptr)
                        {
                            webgl.unavailable = "no GPU for WebGL: " + why;
                            return string(ctx, webgl.unavailable);
                        }
                    }
                    const auto node = static_cast<ui::NodeId>(a.u32(0));
                    auto canvas = ui::surfaceOf(ctx).canvasBuffer(node);
                    std::string why;
                    auto context = WebGLContext::create(webgl.device, canvas, attributes, &why);
                    if (context == nullptr)
                        return string(ctx, "WebGL 2 is not available: " + why);
                    const std::uint32_t id = webgl.nextContext++;
                    webgl.attributes.emplace(id, context->attributes());
                    webgl.contexts.emplace(id, std::move(context));
                    webgl.canvases.emplace(id, std::move(canvas));
                    return JS_NewUint32(ctx, id);
                });
        }

        // webglAttributes(id): what was granted, in webglCreate's order.
        JSValue webglAttributes(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (! bind::expectArgumentCount(ctx, "webglAttributes", argc, 1))
                return JS_EXCEPTION;
            return bind::invoke(ctx, "webglAttributes",
                                [&]() -> JSValue
                                {
                                    const Args a { ctx, argc, argv };
                                    const auto found = webglOf(ctx).attributes.find(a.u32(0));
                                    if (found == webglOf(ctx).attributes.end())
                                        return JS_NULL;
                                    const WebGLContext::Attributes& g = found->second;
                                    const std::array<double, 7> values {
                                        g.alpha ? 1.0 : 0.0,
                                        g.depth ? 1.0 : 0.0,
                                        g.stencil ? 1.0 : 0.0,
                                        g.antialias ? 1.0 : 0.0,
                                        g.premultipliedAlpha ? 1.0 : 0.0,
                                        g.preserveDrawingBuffer ? 1.0 : 0.0,
                                        g.failIfMajorPerformanceCaveat ? 1.0 : 0.0,
                                    };
                                    return numbers(ctx, values);
                                });
        }

        // webglCall(id, op, ...): one native entry for every method.
        JSValue webglCall(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (! bind::expectArgumentCount(ctx, "webglCall", argc, 2))
                return JS_EXCEPTION;
            return bind::invoke(ctx, "webglCall",
                                [&]() -> JSValue
                                {
                                    const Args all { ctx, argc, argv };
                                    WebGL& webgl = webglOf(ctx);
                                    const auto found = webgl.contexts.find(all.u32(0));
                                    if (found == webgl.contexts.end())
                                        throw std::invalid_argument("unknown WebGL context");
                                    WebGLContext& context = *found->second;
                                    context.makeCurrent();
                                    const int op = all.i32(1);
                                    const Args args { ctx, argc - 2, argv + 2 };
                                    if (op < generatedOperations)
                                        return callGenerated(ctx, context, op, args);
                                    return callHand(ctx, webgl, context, static_cast<HandOp>(op - generatedOperations),
                                                    args);
                                });
        }

        // webglResize(id): the canvas was resized; the drawing buffer follows.
        JSValue webglResize(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (! bind::expectArgumentCount(ctx, "webglResize", argc, 1))
                return JS_EXCEPTION;
            return bind::invoke(ctx, "webglResize",
                                [&]() -> JSValue
                                {
                                    const Args a { ctx, argc, argv };
                                    const auto found = webglOf(ctx).contexts.find(a.u32(0));
                                    if (found != webglOf(ctx).contexts.end())
                                        found->second->resize();
                                    return JS_UNDEFINED;
                                });
        }

        // webglLose(id): loseContext(); webglRelease(id): the canvas is gone.
        JSValue webglLose(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (! bind::expectArgumentCount(ctx, "webglLose", argc, 1))
                return JS_EXCEPTION;
            return bind::invoke(ctx, "webglLose",
                                [&]() -> JSValue
                                {
                                    const Args a { ctx, argc, argv };
                                    const auto found = webglOf(ctx).contexts.find(a.u32(0));
                                    if (found != webglOf(ctx).contexts.end())
                                        found->second->lose();
                                    return JS_UNDEFINED;
                                });
        }

        JSValue webglRelease(JSContext* ctx, JSValueConst, int argc, JSValueConst* argv)
        {
            if (! bind::expectArgumentCount(ctx, "webglRelease", argc, 1))
                return JS_EXCEPTION;
            return bind::invoke(ctx, "webglRelease",
                                [&]() -> JSValue
                                {
                                    const Args a { ctx, argc, argv };
                                    WebGL& webgl = webglOf(ctx);
                                    webgl.contexts.erase(a.u32(0));
                                    webgl.canvases.erase(a.u32(0));
                                    webgl.attributes.erase(a.u32(0));
                                    return JS_UNDEFINED;
                                });
        }
    } // namespace

    std::span<const ui::NativeFunction> webglFunctions()
    {
        static constexpr ui::NativeFunction functions[] = {
            { "webglCreate", webglCreate, 2 }, { "webglAttributes", webglAttributes, 1 },
            { "webglCall", webglCall, 2 },     { "webglResize", webglResize, 1 },
            { "webglLose", webglLose, 1 },     { "webglRelease", webglRelease, 1 },
        };
        return functions;
    }

    void installWebGL(js::Context& context, std::shared_ptr<Device> device, bool allowSoftware)
    {
        auto webgl = std::make_shared<WebGL>();
        webgl->device = std::move(device);
        webgl->allowSoftware = allowSoftware;
        bind::setContextData(context, &webglKey, std::move(webgl));
    }

    void presentWebGL(js::Context& context)
    {
        auto* webgl = bind::contextData<WebGL>(js::rawContext(context), &webglKey);
        if (webgl == nullptr)
            return;
        for (auto& [id, webglContext] : webgl->contexts)
            webglContext->present();
    }
} // namespace soundor::inline SOUNDOR_ABI_NAMESPACE::gpu
