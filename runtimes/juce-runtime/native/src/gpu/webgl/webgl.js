// A canvas node's WebGL 2 context (WebGL2RenderingContext) and its objects
// (WebGLBuffer, WebGLTexture, …), as on the Web.
//
// Embedded into the native runtime; part of soundor:ui. Rendering happens
// natively, in an OpenGL ES 3.0 context of ANGLE's in WebGL compatibility
// mode, so ANGLE validates every call the way a browser's WebGL does. Each
// method converts its arguments the way WebIDL would, checks the WebGL
// objects it was given, then makes one native call: webglCall(id, op, ...).
// The methods whose arguments are only numbers, booleans and objects are
// generated from the Khronos IDL (webgl-generated.js); this file has the
// rest. What Soundor does not implement throws a TypeError saying so.

import * as native from 'soundor:internal/ui';
import { resolveSource } from 'soundor:internal/ui/canvas';
import {
  CONSTANTS,
  GENERATED_OPERATIONS,
  generatedMethods,
} from 'soundor:internal/ui/webgl-generated';

// The hand-written operations, numbered after the generated ones. The same
// order as HandOp in WebGLModule.cpp.
const HAND = [
  'bindFramebuffer',
  'getError',
  'useProgram',
  'deleteFramebuffer',
  'framebufferTexture2D',
  'framebufferRenderbuffer',
  'linkProgram',
  'samplerParameteri',
  'samplerParameterf',
  'shaderSource',
  'getShaderInfoLog',
  'getProgramInfoLog',
  'getShaderSource',
  'getShaderParameter',
  'getProgramParameter',
  'getUniformLocation',
  'getAttribLocation',
  'bindAttribLocation',
  'getActiveAttrib',
  'getActiveUniform',
  'bufferData',
  'bufferSubData',
  'getBufferSubData',
  'texImage2D',
  'texSubImage2D',
  'texImage3D',
  'texSubImage3D',
  'texImage2DOffset',
  'texSubImage2DOffset',
  'readPixels',
  'readPixelsOffset',
  'uniformv',
  'vertexAttribv',
  'getParameter',
  'getIndexedParameter',
  'getBufferParameter',
  'getRenderbufferParameter',
  'getTexParameter',
  'getFramebufferAttachmentParameter',
  'getVertexAttrib',
  'getVertexAttribCurrent',
  'getQueryParameter',
  'getSamplerParameter',
  'getSyncParameter',
  'getInternalformatParameter',
  'getQuery',
  'getUniform',
  'drawBuffers',
  'invalidateFramebuffer',
  'invalidateSubFramebuffer',
  'clearBufferv',
  'fenceSync',
  'clientWaitSync',
  'waitSync',
  'deleteSync',
  'isSync',
  'getShaderPrecisionFormat',
  'getExtensions',
  'requestExtension',
  'transformFeedbackVaryings',
  'getTransformFeedbackVarying',
  'getUniformIndices',
  'getActiveUniforms',
  'getUniformBlockIndex',
  'getActiveUniformBlockParameter',
  'getActiveUniformBlockName',
  'getFragDataLocation',
  'compressedTexImage2D',
  'compressedTexSubImage2D',
  'compressedTexImage3D',
  'compressedTexSubImage3D',
  'getAttachedShaders',
  'drawingBufferSize',
  'texImageCanvas',
  'texSubImageCanvas',
  'getString',
  'getVertexAttribOffset',
];
const OP = Object.fromEntries(
  HAND.map((name, index) => [name, GENERATED_OPERATIONS + index]),
);

const C = CONSTANTS;
const CONTEXT_LOST_WEBGL = 0x9242;
const UNPACK_FLIP_Y_WEBGL = 0x9240;
const UNPACK_PREMULTIPLY_ALPHA_WEBGL = 0x9241;
const UNPACK_COLORSPACE_CONVERSION_WEBGL = 0x9243;
const BROWSER_DEFAULT_WEBGL = 0x9244;
const UNMASKED_VENDOR_WEBGL = 0x9245;
const UNMASKED_RENDERER_WEBGL = 0x9246;
const MAX_ANISOTROPY = 0x84fe;
const COMPLETION_STATUS_KHR = 0x91b1;

const CONSTRUCTING = Symbol('constructing');

/** How getParameter() and friends ask native code for a value. */
const KIND = { int: 0, float: 1, bool: 2, int64: 3, uint: 4 };

function unsupported(what) {
  return new TypeError(`${what} is not supported by Soundor's WebGL`);
}

// ── WebGL objects ────────────────────────────────────────────────────────

/** The state of every WebGL object: its context, OpenGL name, deletion. */
const objects = new WeakMap();

/** The base of WebGL's objects (not a global, as on the Web). */
class WebGLObject {
  constructor(key) {
    if (key !== CONSTRUCTING) throw new TypeError('Illegal constructor');
  }
}

function objectClass(name) {
  // A named class, so that `buffer.constructor.name` reads as on the Web.
  const type = { [name]: class extends WebGLObject {} }[name];
  Object.defineProperty(type.prototype, Symbol.toStringTag, {
    value: name,
    configurable: true,
  });
  return type;
}

export const WebGLBuffer = objectClass('WebGLBuffer');
export const WebGLFramebuffer = objectClass('WebGLFramebuffer');
export const WebGLProgram = objectClass('WebGLProgram');
export const WebGLRenderbuffer = objectClass('WebGLRenderbuffer');
export const WebGLShader = objectClass('WebGLShader');
export const WebGLTexture = objectClass('WebGLTexture');
export const WebGLQuery = objectClass('WebGLQuery');
export const WebGLSampler = objectClass('WebGLSampler');
export const WebGLSync = objectClass('WebGLSync');
export const WebGLTransformFeedback = objectClass('WebGLTransformFeedback');
export const WebGLVertexArrayObject = objectClass('WebGLVertexArrayObject');

const TYPES = {
  WebGLBuffer,
  WebGLFramebuffer,
  WebGLProgram,
  WebGLRenderbuffer,
  WebGLShader,
  WebGLTexture,
  WebGLQuery,
  WebGLSampler,
  WebGLSync,
  WebGLTransformFeedback,
  WebGLVertexArrayObject,
};

/** A WebGLUniformLocation's program, link and location; null for anything else. */
let locationOf;

export class WebGLUniformLocation {
  #program;
  #generation;
  #location;

  constructor(key, program, generation, location) {
    if (key !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#program = program;
    this.#generation = generation;
    this.#location = location;
  }

  static {
    locationOf = (value) =>
      value instanceof WebGLUniformLocation
        ? {
            program: value.#program,
            generation: value.#generation,
            location: value.#location,
          }
        : null;
  }
}
export class WebGLActiveInfo {
  #size;
  #type;
  #name;

  constructor(key, size, type, name) {
    if (key !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#size = size;
    this.#type = type;
    this.#name = name;
  }

  get size() {
    return this.#size;
  }

  get type() {
    return this.#type;
  }

  get name() {
    return this.#name;
  }
}

export class WebGLShaderPrecisionFormat {
  #rangeMin;
  #rangeMax;
  #precision;

  constructor(key, rangeMin, rangeMax, precision) {
    if (key !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#rangeMin = rangeMin;
    this.#rangeMax = rangeMax;
    this.#precision = precision;
  }

  get rangeMin() {
    return this.#rangeMin;
  }

  get rangeMax() {
    return this.#rangeMax;
  }

  get precision() {
    return this.#precision;
  }
}

// ── Conversions ──────────────────────────────────────────────────────────

/** A typed array or DataView's bytes, as a Uint8Array over the same memory. */
function bytesOf(view) {
  return new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
}

function isView(value) {
  return ArrayBuffer.isView(value);
}

/** The element size of a view (1 for a DataView). */
function elementSize(view) {
  return view.BYTES_PER_ELEMENT ?? 1;
}

/**
 * The byte range [offset, offset + length) of `view` that srcOffset and
 * length (in elements, length 0 meaning the rest) select, or null when it
 * lies outside the view (an INVALID_VALUE).
 */
function rangeOf(view, srcOffset = 0, length = 0) {
  const size = elementSize(view);
  const elements = view.byteLength / size;
  const offset = Number(srcOffset) >>> 0;
  const count = Number(length) >>> 0;
  if (offset > elements) return null;
  const taken = count === 0 ? elements - offset : count;
  if (offset + taken > elements) return null;
  return { offset: offset * size, length: taken * size };
}

/** A sequence of numbers as a typed array of `Type` (as WebIDL would take it). */
function typed(value, Type, what) {
  if (value instanceof Type) return value;
  if (value !== null && typeof value === 'object' && !isView(value)) {
    if (typeof value[Symbol.iterator] === 'function')
      return Type.from(value, Number);
  }
  throw new TypeError(
    `Failed to execute '${what}' on 'WebGL2RenderingContext': The provided value is not of type '(${Type.name} or sequence)'.`,
  );
}

// ── The context ──────────────────────────────────────────────────────────

/** The contexts' native counterparts go when they do. */
const contexts = new FinalizationRegistry((id) => native.webglRelease(id));

let stateOf;
// A context's uniform*v() and vertexAttrib*v(), defined below the class.
let uniformv;
let vertexAttribv;

/** WebGL's extensions Soundor offers: the OpenGL ES ones they need, and what they add. */
const EXTENSIONS = {
  EXT_color_buffer_float: { requires: ['GL_EXT_color_buffer_float'] },
  EXT_color_buffer_half_float: {
    requires: ['GL_EXT_color_buffer_half_float'],
    constants: {
      RGBA16F_EXT: 0x881a,
      RGB16F_EXT: 0x881b,
      FRAMEBUFFER_ATTACHMENT_COMPONENT_TYPE_EXT: 0x8211,
      UNSIGNED_NORMALIZED_EXT: 0x8c17,
    },
  },
  EXT_float_blend: { requires: ['GL_EXT_float_blend'] },
  EXT_texture_filter_anisotropic: {
    requires: ['GL_EXT_texture_filter_anisotropic'],
    constants: {
      TEXTURE_MAX_ANISOTROPY_EXT: 0x84fe,
      MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84ff,
    },
  },
  EXT_texture_norm16: {
    requires: ['GL_EXT_texture_norm16'],
    constants: {
      R16_EXT: 0x822a,
      RG16_EXT: 0x822c,
      RGB16_EXT: 0x8054,
      RGBA16_EXT: 0x805b,
      R16_SNORM_EXT: 0x8f98,
      RG16_SNORM_EXT: 0x8f99,
      RGB16_SNORM_EXT: 0x8f9a,
      RGBA16_SNORM_EXT: 0x8f9b,
    },
  },
  // Offered everywhere: without the driver's, compiling and linking are
  // done when they return, so COMPLETION_STATUS_KHR is always true.
  KHR_parallel_shader_compile: {
    requires: [],
    optional: ['GL_KHR_parallel_shader_compile'],
    constants: { COMPLETION_STATUS_KHR },
  },
  OES_texture_float_linear: { requires: ['GL_OES_texture_float_linear'] },
  WEBGL_debug_renderer_info: {
    requires: [],
    constants: { UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL },
  },
  WEBGL_lose_context: {
    requires: [],
    methods: (context) => ({
      loseContext() {
        stateOf(context).lose(true);
      },
      restoreContext() {
        throw unsupported('restoreContext()');
      },
    }),
  },
};

/** Object-valued getParameter() names, and the type of their value. */
const OBJECT_PARAMETERS = new Map([
  [C.ARRAY_BUFFER_BINDING, 'WebGLBuffer'],
  [C.ELEMENT_ARRAY_BUFFER_BINDING, 'WebGLBuffer'],
  [C.COPY_READ_BUFFER_BINDING, 'WebGLBuffer'],
  [C.COPY_WRITE_BUFFER_BINDING, 'WebGLBuffer'],
  [C.PIXEL_PACK_BUFFER_BINDING, 'WebGLBuffer'],
  [C.PIXEL_UNPACK_BUFFER_BINDING, 'WebGLBuffer'],
  [C.TRANSFORM_FEEDBACK_BUFFER_BINDING, 'WebGLBuffer'],
  [C.UNIFORM_BUFFER_BINDING, 'WebGLBuffer'],
  [C.CURRENT_PROGRAM, 'WebGLProgram'],
  [C.FRAMEBUFFER_BINDING, 'WebGLFramebuffer'],
  [C.READ_FRAMEBUFFER_BINDING, 'WebGLFramebuffer'],
  [C.RENDERBUFFER_BINDING, 'WebGLRenderbuffer'],
  [C.TEXTURE_BINDING_2D, 'WebGLTexture'],
  [C.TEXTURE_BINDING_CUBE_MAP, 'WebGLTexture'],
  [C.TEXTURE_BINDING_3D, 'WebGLTexture'],
  [C.TEXTURE_BINDING_2D_ARRAY, 'WebGLTexture'],
  [C.SAMPLER_BINDING, 'WebGLSampler'],
  [C.TRANSFORM_FEEDBACK_BINDING, 'WebGLTransformFeedback'],
  [C.VERTEX_ARRAY_BINDING, 'WebGLVertexArrayObject'],
]);

/** getParameter() names whose value is an array, and its type. */
const ARRAY_PARAMETERS = new Map([
  [C.ALIASED_LINE_WIDTH_RANGE, Float32Array],
  [C.ALIASED_POINT_SIZE_RANGE, Float32Array],
  [C.BLEND_COLOR, Float32Array],
  [C.COLOR_CLEAR_VALUE, Float32Array],
  [C.DEPTH_RANGE, Float32Array],
  [C.MAX_VIEWPORT_DIMS, Int32Array],
  [C.SCISSOR_BOX, Int32Array],
  [C.VIEWPORT, Int32Array],
  [C.COMPRESSED_TEXTURE_FORMATS, Uint32Array],
  [C.COLOR_WRITEMASK, Array],
]);

const BOOLEAN_PARAMETERS = new Set([
  C.BLEND,
  C.CULL_FACE,
  C.DEPTH_TEST,
  C.DEPTH_WRITEMASK,
  C.DITHER,
  C.POLYGON_OFFSET_FILL,
  C.SAMPLE_ALPHA_TO_COVERAGE,
  C.SAMPLE_COVERAGE,
  C.SAMPLE_COVERAGE_INVERT,
  C.SCISSOR_TEST,
  C.STENCIL_TEST,
  C.RASTERIZER_DISCARD,
  C.TRANSFORM_FEEDBACK_ACTIVE,
  C.TRANSFORM_FEEDBACK_PAUSED,
  C.COLOR_WRITEMASK,
]);

const FLOAT_PARAMETERS = new Set([
  C.DEPTH_CLEAR_VALUE,
  C.LINE_WIDTH,
  C.POLYGON_OFFSET_FACTOR,
  C.POLYGON_OFFSET_UNITS,
  C.SAMPLE_COVERAGE_VALUE,
  C.MAX_TEXTURE_LOD_BIAS,
  C.ALIASED_LINE_WIDTH_RANGE,
  C.ALIASED_POINT_SIZE_RANGE,
  C.BLEND_COLOR,
  C.COLOR_CLEAR_VALUE,
  C.DEPTH_RANGE,
  0x84ff, // MAX_TEXTURE_MAX_ANISOTROPY_EXT
]);

const INT64_PARAMETERS = new Set([
  C.MAX_ELEMENT_INDEX,
  C.MAX_SERVER_WAIT_TIMEOUT,
  C.MAX_UNIFORM_BLOCK_SIZE,
  C.MAX_COMBINED_VERTEX_UNIFORM_COMPONENTS,
  C.MAX_COMBINED_FRAGMENT_UNIFORM_COMPONENTS,
]);

const UINT_PARAMETERS = new Set([
  C.STENCIL_VALUE_MASK,
  C.STENCIL_WRITEMASK,
  C.STENCIL_BACK_VALUE_MASK,
  C.STENCIL_BACK_WRITEMASK,
  C.COMPRESSED_TEXTURE_FORMATS,
]);

/** What parameter `pname` is asked for as. */
function kindOf(pname) {
  if (BOOLEAN_PARAMETERS.has(pname)) return KIND.bool;
  if (FLOAT_PARAMETERS.has(pname)) return KIND.float;
  if (INT64_PARAMETERS.has(pname)) return KIND.int64;
  if (UINT_PARAMETERS.has(pname)) return KIND.uint;
  return KIND.int;
}

/** A uniform's value, from getUniform's native [type, numbers]. */
function uniformValue([type, values]) {
  switch (type) {
    case C.FLOAT:
      return values[0];
    case C.FLOAT_VEC2:
    case C.FLOAT_VEC3:
    case C.FLOAT_VEC4:
    case C.FLOAT_MAT2:
    case C.FLOAT_MAT3:
    case C.FLOAT_MAT4:
    case C.FLOAT_MAT2x3:
    case C.FLOAT_MAT2x4:
    case C.FLOAT_MAT3x2:
    case C.FLOAT_MAT3x4:
    case C.FLOAT_MAT4x2:
    case C.FLOAT_MAT4x3:
      return Float32Array.from(values);
    case C.INT_VEC2:
    case C.INT_VEC3:
    case C.INT_VEC4:
      return Int32Array.from(values);
    case C.UNSIGNED_INT:
      return values[0];
    case C.UNSIGNED_INT_VEC2:
    case C.UNSIGNED_INT_VEC3:
    case C.UNSIGNED_INT_VEC4:
      return Uint32Array.from(values);
    case C.BOOL:
      return values[0] !== 0;
    case C.BOOL_VEC2:
    case C.BOOL_VEC3:
    case C.BOOL_VEC4:
      return values.map((value) => value !== 0);
    default: // int and samplers
      return values[0];
  }
}

/** The uniform*v() kinds native code knows (WebGLModule.cpp, Uniformv). */
const UNIFORM_KINDS = {
  uniform1fv: [0, 1, Float32Array],
  uniform2fv: [1, 2, Float32Array],
  uniform3fv: [2, 3, Float32Array],
  uniform4fv: [3, 4, Float32Array],
  uniform1iv: [4, 1, Int32Array],
  uniform2iv: [5, 2, Int32Array],
  uniform3iv: [6, 3, Int32Array],
  uniform4iv: [7, 4, Int32Array],
  uniform1uiv: [8, 1, Uint32Array],
  uniform2uiv: [9, 2, Uint32Array],
  uniform3uiv: [10, 3, Uint32Array],
  uniform4uiv: [11, 4, Uint32Array],
  uniformMatrix2fv: [12, 4, Float32Array],
  uniformMatrix3fv: [13, 9, Float32Array],
  uniformMatrix4fv: [14, 16, Float32Array],
  uniformMatrix2x3fv: [15, 6, Float32Array],
  uniformMatrix2x4fv: [16, 8, Float32Array],
  uniformMatrix3x2fv: [17, 6, Float32Array],
  uniformMatrix3x4fv: [18, 12, Float32Array],
  uniformMatrix4x2fv: [19, 8, Float32Array],
  uniformMatrix4x3fv: [20, 12, Float32Array],
};

const VERTEX_ATTRIB_KINDS = {
  vertexAttrib1fv: [0, 1, Float32Array],
  vertexAttrib2fv: [1, 2, Float32Array],
  vertexAttrib3fv: [2, 3, Float32Array],
  vertexAttrib4fv: [3, 4, Float32Array],
  vertexAttribI4iv: [4, 4, Int32Array],
  vertexAttribI4uiv: [5, 4, Uint32Array],
};

/** Per-context state: everything WebGL keeps that OpenGL does not. */
class ContextState {
  constructor(context, canvas, node, id) {
    this.context = context;
    this.canvas = canvas;
    this.node = node;
    this.id = id;
    this.lost = false;
    this.lostReported = false;
    // Errors JavaScript found, reported by getError() before OpenGL's.
    this.errors = [];
    // Live objects, by type and OpenGL name: one wrapper per object.
    this.names = new Map(Object.keys(TYPES).map((type) => [type, new Map()]));
    this.program = null;
    // Relinking a program makes its uniform locations stale.
    this.generations = new WeakMap();
    this.drawFramebuffer = null;
    this.readFramebuffer = null;
    this.flipY = false;
    this.premultiplyAlpha = false;
    this.colorspaceConversion = BROWSER_DEFAULT_WEBGL;
    this.size = null;
    this.extensions = new Map();
    // Extensions' OpenGL ES parts Soundor stands in for.
    this.emulated = new Set();
    this.available = null;
  }

  synthesize(error) {
    if (!this.errors.includes(error)) this.errors.push(error);
  }

  call(op, ...args) {
    if (this.lost) return null;
    return native.webglCall(this.id, op, ...args);
  }

  wrap(type, name) {
    if (name === null || name === 0) return null;
    const object = new TYPES[type](CONSTRUCTING);
    objects.set(object, { state: this, name, type, deleted: false });
    this.names.get(type).set(name, object);
    return object;
  }

  /** The wrapper of OpenGL's object `name` of `type`, or null. */
  objectNamed(type, name) {
    return this.names.get(type).get(name) ?? null;
  }

  lose(byRequest) {
    if (this.lost) return;
    this.lost = true;
    if (byRequest) native.webglLose(this.id);
    this.synthesize(CONTEXT_LOST_WEBGL);
    const canvas = this.canvas;
    setTimeout(() => {
      if (typeof canvas.dispatchEvent === 'function') {
        const event = new Event('webglcontextlost', { cancelable: true });
        event.statusMessage = '';
        canvas.dispatchEvent(event);
      }
    }, 0);
  }

  drawingBufferSize() {
    this.size ??= this.call(OP.drawingBufferSize) ?? [0, 0];
    return this.size;
  }
}

/** The helpers the generated methods call (webgl-generated.js). */
const gl = {
  require(context, name, given, required) {
    stateOf(context);
    if (given < required)
      throw new TypeError(
        `Failed to execute '${name}' on 'WebGL2RenderingContext': ${required} argument${required === 1 ? '' : 's'} required, but only ${given} present.`,
      );
  },
  u32: (value) => Number(value) >>> 0,
  i32: (value) => Number(value) | 0,
  i64(value) {
    const number = Math.trunc(Number(value));
    return Number.isFinite(number) ? number : 0;
  },
  f32: (value) => Number(value),
  bool: (value) => Boolean(value),
  /**
   * The OpenGL name of `object` (0 for null where null is allowed), or -1
   * when the call must not happen: the object belongs to another context or
   * was deleted (an INVALID_OPERATION).
   */
  name(context, object, type, nullable, method) {
    const state = stateOf(context);
    if (object === null || object === undefined) {
      if (nullable) return 0;
      throw new TypeError(
        `Failed to execute '${method}' on 'WebGL2RenderingContext': parameter is not of type '${type}'.`,
      );
    }
    if (!(object instanceof TYPES[type]))
      throw new TypeError(
        `Failed to execute '${method}' on 'WebGL2RenderingContext': parameter is not of type '${type}'.`,
      );
    const record = objects.get(object);
    if (state.lost) return -1;
    if (record.state !== state || record.deleted) {
      state.synthesize(C.INVALID_OPERATION);
      return -1;
    }
    return record.name;
  },
  /** The OpenGL name of a live object of this context, else 0. */
  nameIfLive(context, object, type) {
    const state = stateOf(context);
    if (object === null || object === undefined) return 0;
    if (!(object instanceof TYPES[type]))
      throw new TypeError(`parameter is not of type '${type}'.`);
    const record = objects.get(object);
    return record.state === state && !record.deleted && !state.lost
      ? record.name
      : 0;
  },
  /**
   * The location in the current program, -1 for null (ignored by OpenGL),
   * or -2 when the call must not happen: the location is of another program
   * or an older link (an INVALID_OPERATION).
   */
  location(context, location, method) {
    const state = stateOf(context);
    if (location === null || location === undefined) return -2;
    const at = locationOf(location);
    if (at === null)
      throw new TypeError(
        `Failed to execute '${method}' on 'WebGL2RenderingContext': parameter is not of type 'WebGLUniformLocation'.`,
      );
    if (state.lost) return -2;
    if (
      at.program !== state.program ||
      state.generations.get(at.program) !== at.generation
    ) {
      state.synthesize(C.INVALID_OPERATION);
      return -2;
    }
    return at.location;
  },
  wrap: (context, type, name) => stateOf(context).wrap(type, name),
  delete(context, object, type, op) {
    const state = stateOf(context);
    if (object === null || object === undefined) return;
    if (!(object instanceof TYPES[type]))
      throw new TypeError(`parameter is not of type '${type}'.`);
    const record = objects.get(object);
    if (record.state !== state) {
      state.synthesize(C.INVALID_OPERATION);
      return;
    }
    if (record.deleted || state.lost) return;
    record.deleted = true;
    state.names.get(type).delete(record.name);
    if (state.program === object) state.program = null;
    if (state.drawFramebuffer === object) state.drawFramebuffer = null;
    if (state.readFramebuffer === object) state.readFramebuffer = null;
    state.call(op, record.name);
  },
  call: (context, op, ...args) => stateOf(context).call(op, ...args),
};

const generated = generatedMethods(gl);

/** The name of `object` for a hand-written method, or -1 (see gl.name). */
function nameOf(context, object, type, nullable, method) {
  return gl.name(context, object, type, nullable, method);
}

/** Whether the framebuffer bound to `target` is the drawing buffer. */
function boundToDrawingBuffer(state, target) {
  return target === C.READ_FRAMEBUFFER
    ? state.readFramebuffer === null
    : state.drawFramebuffer === null;
}

/** A canvas source's upload: what texImage2D() takes from a node or ImageData. */
function sourceUpload(state, source, method) {
  const resolved = resolveSource(source);
  if (resolved?.kind === 'canvas') return { canvas: resolved.id };
  if (resolved?.kind === 'image')
    throw unsupported(`${method}() from an image node`);
  if (
    source !== null &&
    typeof source === 'object' &&
    source.data instanceof Uint8ClampedArray &&
    Number.isInteger(source.width) &&
    Number.isInteger(source.height)
  )
    return {
      width: source.width,
      height: source.height,
      data: bytesOf(source.data),
    };
  throw new TypeError(
    `Failed to execute '${method}' on 'WebGL2RenderingContext': The provided value is not of type '(ArrayBufferView or TexImageSource)'.`,
  );
}

function checkCanvasFormat(format, type, method) {
  if (format !== C.RGBA || type !== C.UNSIGNED_BYTE)
    throw unsupported(
      `${method}() from a canvas with a format other than RGBA/UNSIGNED_BYTE`,
    );
}

/** ImageData uploads are always tightly packed RGBA bytes. */
function withAlignment(state, alignment, upload) {
  // UNPACK_ALIGNMENT is OpenGL's; ImageData rows need 4 (they are always
  // 4-aligned), so the default is fine unless code changed it.
  const previous = state.call(
    OP.getParameter,
    C.UNPACK_ALIGNMENT,
    KIND.int,
  )?.[0];
  if (previous !== alignment)
    generated.pixelStorei.call(state.context, C.UNPACK_ALIGNMENT, alignment);
  try {
    upload();
  } finally {
    if (previous !== alignment && previous !== undefined)
      generated.pixelStorei.call(state.context, C.UNPACK_ALIGNMENT, previous);
  }
}

export class WebGL2RenderingContext {
  #state;

  constructor(key, canvas, node, id) {
    if (key !== CONSTRUCTING) throw new TypeError('Illegal constructor');
    this.#state = new ContextState(this, canvas, node, id);
  }

  static {
    stateOf = (context) => {
      if (!(context instanceof WebGL2RenderingContext))
        throw new TypeError('Illegal invocation');
      return context.#state;
    };
    uniformv = (context, ...args) => {
      stateOf(context);
      context.#uniformv(...args);
    };
    vertexAttribv = (context, ...args) => {
      stateOf(context);
      context.#vertexAttribv(...args);
    };
  }

  get canvas() {
    return this.#state.canvas;
  }

  get drawingBufferWidth() {
    return this.#state.drawingBufferSize()[0];
  }

  get drawingBufferHeight() {
    return this.#state.drawingBufferSize()[1];
  }

  get drawingBufferFormat() {
    return C.RGBA8;
  }

  get drawingBufferColorSpace() {
    return 'srgb';
  }

  set drawingBufferColorSpace(value) {
    if (value !== 'srgb')
      throw unsupported(`drawingBufferColorSpace '${value}'`);
  }

  get unpackColorSpace() {
    return 'srgb';
  }

  set unpackColorSpace(value) {
    if (value !== 'srgb') throw unsupported(`unpackColorSpace '${value}'`);
  }

  getContextAttributes() {
    const state = this.#state;
    if (state.lost) return null;
    const [
      alpha,
      depth,
      stencil,
      antialias,
      premultipliedAlpha,
      preserveDrawingBuffer,
      failIfMajorPerformanceCaveat,
    ] = native.webglAttributes(state.id).map(Boolean);
    return {
      alpha,
      depth,
      stencil,
      antialias,
      premultipliedAlpha,
      preserveDrawingBuffer,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat,
      desynchronized: false,
      xrCompatible: false,
    };
  }

  isContextLost() {
    return this.#state.lost;
  }

  makeXRCompatible() {
    return Promise.reject(unsupported('makeXRCompatible()'));
  }

  getSupportedExtensions() {
    const state = this.#state;
    if (state.lost) return null;
    state.available ??= new Set(
      String(state.call(OP.getExtensions) ?? '')
        .split(' ')
        .filter(Boolean),
    );
    return Object.entries(EXTENSIONS)
      .filter(([, extension]) =>
        extension.requires.every((name) => state.available.has(name)),
      )
      .map(([name]) => name);
  }

  getExtension(name) {
    const state = this.#state;
    gl.require(this, 'getExtension', arguments.length, 1);
    if (state.lost) return null;
    const key = Object.keys(EXTENSIONS).find(
      (known) => known.toLowerCase() === String(name).toLowerCase(),
    );
    if (key === undefined) return null;
    if (state.extensions.has(key)) return state.extensions.get(key);
    const extension = EXTENSIONS[key];
    if (!this.getSupportedExtensions().includes(key)) return null;
    for (const required of extension.requires)
      if (!state.call(OP.requestExtension, required)) return null;
    for (const optional of extension.optional ?? [])
      if (state.available.has(optional))
        state.call(OP.requestExtension, optional);
      else state.emulated.add(optional);
    const object = { ...extension.constants, ...extension.methods?.(this) };
    state.extensions.set(key, object);
    return object;
  }

  getError() {
    const state = this.#state;
    if (state.errors.length > 0) return state.errors.shift();
    if (state.lost) return C.NO_ERROR;
    return state.call(OP.getError);
  }

  // ── Framebuffers ───────────────────────────────────────────────────────

  bindFramebuffer(target, framebuffer) {
    gl.require(this, 'bindFramebuffer', arguments.length, 2);
    const state = this.#state;
    const name = nameOf(
      this,
      framebuffer,
      'WebGLFramebuffer',
      true,
      'bindFramebuffer',
    );
    if (name < 0) return;
    const t = gl.u32(target);
    if (
      t !== C.FRAMEBUFFER &&
      t !== C.DRAW_FRAMEBUFFER &&
      t !== C.READ_FRAMEBUFFER
    ) {
      state.synthesize(C.INVALID_ENUM);
      return;
    }
    state.call(OP.bindFramebuffer, t, name);
    const bound = framebuffer ?? null;
    if (t !== C.READ_FRAMEBUFFER) state.drawFramebuffer = bound;
    if (t !== C.DRAW_FRAMEBUFFER) state.readFramebuffer = bound;
  }

  deleteFramebuffer(framebuffer) {
    gl.require(this, 'deleteFramebuffer', arguments.length, 1);
    gl.delete(this, framebuffer, 'WebGLFramebuffer', OP.deleteFramebuffer);
  }

  framebufferTexture2D(target, attachment, textarget, texture, level) {
    gl.require(this, 'framebufferTexture2D', arguments.length, 5);
    const state = this.#state;
    const name = nameOf(
      this,
      texture,
      'WebGLTexture',
      true,
      'framebufferTexture2D',
    );
    if (name < 0) return;
    const t = gl.u32(target);
    if (boundToDrawingBuffer(state, t)) {
      state.synthesize(C.INVALID_OPERATION);
      return;
    }
    state.call(
      OP.framebufferTexture2D,
      t,
      gl.u32(attachment),
      gl.u32(textarget),
      name,
      gl.i32(level),
    );
  }

  framebufferRenderbuffer(
    target,
    attachment,
    renderbuffertarget,
    renderbuffer,
  ) {
    gl.require(this, 'framebufferRenderbuffer', arguments.length, 4);
    const state = this.#state;
    const name = nameOf(
      this,
      renderbuffer,
      'WebGLRenderbuffer',
      true,
      'framebufferRenderbuffer',
    );
    if (name < 0) return;
    const t = gl.u32(target);
    if (boundToDrawingBuffer(state, t)) {
      state.synthesize(C.INVALID_OPERATION);
      return;
    }
    state.call(
      OP.framebufferRenderbuffer,
      t,
      gl.u32(attachment),
      gl.u32(renderbuffertarget),
      name,
    );
  }

  framebufferTextureLayer(target, attachment, texture, level, layer) {
    gl.require(this, 'framebufferTextureLayer', arguments.length, 5);
    if (boundToDrawingBuffer(this.#state, gl.u32(target))) {
      this.#state.synthesize(C.INVALID_OPERATION);
      return;
    }
    generated.framebufferTextureLayer.call(
      this,
      target,
      attachment,
      texture,
      level,
      layer,
    );
  }

  getFramebufferAttachmentParameter(target, attachment, pname) {
    gl.require(this, 'getFramebufferAttachmentParameter', arguments.length, 3);
    const state = this.#state;
    const t = gl.u32(target);
    let a = gl.u32(attachment);
    const p = gl.u32(pname);
    if (boundToDrawingBuffer(state, t)) {
      // The drawing buffer's attachments are BACK, DEPTH and STENCIL.
      const map = {
        [C.BACK]: C.COLOR_ATTACHMENT0,
        [C.DEPTH]: C.DEPTH_ATTACHMENT,
        [C.STENCIL]: C.STENCIL_ATTACHMENT,
      };
      if (!(a in map)) {
        state.synthesize(C.INVALID_ENUM);
        return null;
      }
      if (p === C.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) {
        state.synthesize(C.INVALID_ENUM);
        return null;
      }
      a = map[a];
      if (p === C.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE) {
        const type = state.call(OP.getFramebufferAttachmentParameter, t, a, p);
        return type === null
          ? null
          : type === C.NONE
            ? C.NONE
            : C.FRAMEBUFFER_DEFAULT;
      }
    }
    if (p === C.FRAMEBUFFER_ATTACHMENT_OBJECT_NAME) {
      const type = state.call(
        OP.getFramebufferAttachmentParameter,
        t,
        a,
        C.FRAMEBUFFER_ATTACHMENT_OBJECT_TYPE,
      );
      const name = state.call(OP.getFramebufferAttachmentParameter, t, a, p);
      if (type === C.TEXTURE) return state.objectNamed('WebGLTexture', name);
      if (type === C.RENDERBUFFER)
        return state.objectNamed('WebGLRenderbuffer', name);
      return null;
    }
    return state.call(OP.getFramebufferAttachmentParameter, t, a, p);
  }

  readBuffer(src) {
    gl.require(this, 'readBuffer', arguments.length, 1);
    const state = this.#state;
    const value = gl.u32(src);
    // The drawing buffer's one color buffer is BACK to WebGL.
    if (state.readFramebuffer === null && value === C.BACK) {
      generated.readBuffer.call(this, C.COLOR_ATTACHMENT0);
      return;
    }
    if (state.readFramebuffer === null && value !== C.NONE) {
      state.synthesize(C.INVALID_OPERATION);
      return;
    }
    generated.readBuffer.call(this, value);
  }

  drawBuffers(buffers) {
    gl.require(this, 'drawBuffers', arguments.length, 1);
    const values = Array.from(buffers, gl.u32);
    this.#state.call(OP.drawBuffers, values);
  }

  invalidateFramebuffer(target, attachments) {
    gl.require(this, 'invalidateFramebuffer', arguments.length, 2);
    this.#state.call(
      OP.invalidateFramebuffer,
      gl.u32(target),
      Array.from(attachments, gl.u32),
    );
  }

  invalidateSubFramebuffer(target, attachments, x, y, width, height) {
    gl.require(this, 'invalidateSubFramebuffer', arguments.length, 6);
    this.#state.call(
      OP.invalidateSubFramebuffer,
      gl.u32(target),
      Array.from(attachments, gl.u32),
      gl.i32(x),
      gl.i32(y),
      gl.i32(width),
      gl.i32(height),
    );
  }

  drawingBufferStorage() {
    throw unsupported('drawingBufferStorage()');
  }

  // ── Programs and shaders ───────────────────────────────────────────────

  useProgram(program) {
    gl.require(this, 'useProgram', arguments.length, 1);
    const state = this.#state;
    const name = nameOf(this, program, 'WebGLProgram', true, 'useProgram');
    if (name < 0) return;
    state.call(OP.useProgram, name);
    // OpenGL refuses an unlinked program: remember what it took.
    const current = state.call(
      OP.getParameter,
      C.CURRENT_PROGRAM,
      KIND.int,
    )?.[0];
    state.program = current === name ? (program ?? null) : state.program;
  }

  linkProgram(program) {
    gl.require(this, 'linkProgram', arguments.length, 1);
    const state = this.#state;
    const name = nameOf(this, program, 'WebGLProgram', false, 'linkProgram');
    if (name < 0) return;
    state.call(OP.linkProgram, name);
    state.generations.set(program, (state.generations.get(program) ?? 0) + 1);
  }

  shaderSource(shader, source) {
    gl.require(this, 'shaderSource', arguments.length, 2);
    const name = nameOf(this, shader, 'WebGLShader', false, 'shaderSource');
    if (name < 0) return;
    this.#state.call(OP.shaderSource, name, String(source));
  }

  getShaderSource(shader) {
    gl.require(this, 'getShaderSource', arguments.length, 1);
    const name = nameOf(this, shader, 'WebGLShader', false, 'getShaderSource');
    if (name < 0) return null;
    return this.#state.call(OP.getShaderSource, name);
  }

  getShaderInfoLog(shader) {
    gl.require(this, 'getShaderInfoLog', arguments.length, 1);
    const name = nameOf(this, shader, 'WebGLShader', false, 'getShaderInfoLog');
    if (name < 0) return null;
    return this.#state.call(OP.getShaderInfoLog, name);
  }

  getProgramInfoLog(program) {
    gl.require(this, 'getProgramInfoLog', arguments.length, 1);
    const name = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getProgramInfoLog',
    );
    if (name < 0) return null;
    return this.#state.call(OP.getProgramInfoLog, name);
  }

  getShaderParameter(shader, pname) {
    gl.require(this, 'getShaderParameter', arguments.length, 2);
    const name = nameOf(
      this,
      shader,
      'WebGLShader',
      false,
      'getShaderParameter',
    );
    if (name < 0) return null;
    const p = gl.u32(pname);
    if (
      p === COMPLETION_STATUS_KHR &&
      this.#state.emulated.has('GL_KHR_parallel_shader_compile')
    )
      return true;
    const value = this.#state.call(OP.getShaderParameter, name, p);
    if (value === null) return null;
    return p === C.SHADER_TYPE ? value : value !== 0;
  }

  getProgramParameter(program, pname) {
    gl.require(this, 'getProgramParameter', arguments.length, 2);
    const name = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getProgramParameter',
    );
    if (name < 0) return null;
    const p = gl.u32(pname);
    if (
      p === COMPLETION_STATUS_KHR &&
      this.#state.emulated.has('GL_KHR_parallel_shader_compile')
    )
      return true;
    const value = this.#state.call(OP.getProgramParameter, name, p);
    if (value === null) return null;
    return p === C.DELETE_STATUS ||
      p === C.LINK_STATUS ||
      p === C.VALIDATE_STATUS ||
      p === COMPLETION_STATUS_KHR
      ? value !== 0
      : value;
  }

  getAttachedShaders(program) {
    gl.require(this, 'getAttachedShaders', arguments.length, 1);
    const state = this.#state;
    const name = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getAttachedShaders',
    );
    if (name < 0) return null;
    return (state.call(OP.getAttachedShaders, name) ?? []).map((shader) =>
      state.objectNamed('WebGLShader', shader),
    );
  }

  getUniformLocation(program, name) {
    gl.require(this, 'getUniformLocation', arguments.length, 2);
    const state = this.#state;
    const programName = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getUniformLocation',
    );
    if (programName < 0) return null;
    const location = state.call(
      OP.getUniformLocation,
      programName,
      String(name),
    );
    if (location === null || location < 0) return null;
    return new WebGLUniformLocation(
      CONSTRUCTING,
      program,
      state.generations.get(program),
      location,
    );
  }

  getAttribLocation(program, name) {
    gl.require(this, 'getAttribLocation', arguments.length, 2);
    const programName = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getAttribLocation',
    );
    if (programName < 0) return -1;
    return (
      this.#state.call(OP.getAttribLocation, programName, String(name)) ?? -1
    );
  }

  bindAttribLocation(program, index, name) {
    gl.require(this, 'bindAttribLocation', arguments.length, 3);
    const programName = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'bindAttribLocation',
    );
    if (programName < 0) return;
    this.#state.call(
      OP.bindAttribLocation,
      programName,
      gl.u32(index),
      String(name),
    );
  }

  getFragDataLocation(program, name) {
    gl.require(this, 'getFragDataLocation', arguments.length, 2);
    const programName = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getFragDataLocation',
    );
    if (programName < 0) return -1;
    return (
      this.#state.call(OP.getFragDataLocation, programName, String(name)) ?? -1
    );
  }

  #activeInfo(op, method, program, index) {
    const name = nameOf(this, program, 'WebGLProgram', false, method);
    if (name < 0) return null;
    const info = this.#state.call(op, name, gl.u32(index));
    return info === null ? null : new WebGLActiveInfo(CONSTRUCTING, ...info);
  }

  getActiveAttrib(program, index) {
    gl.require(this, 'getActiveAttrib', arguments.length, 2);
    return this.#activeInfo(
      OP.getActiveAttrib,
      'getActiveAttrib',
      program,
      index,
    );
  }

  getActiveUniform(program, index) {
    gl.require(this, 'getActiveUniform', arguments.length, 2);
    return this.#activeInfo(
      OP.getActiveUniform,
      'getActiveUniform',
      program,
      index,
    );
  }

  getTransformFeedbackVarying(program, index) {
    gl.require(this, 'getTransformFeedbackVarying', arguments.length, 2);
    return this.#activeInfo(
      OP.getTransformFeedbackVarying,
      'getTransformFeedbackVarying',
      program,
      index,
    );
  }

  transformFeedbackVaryings(program, varyings, bufferMode) {
    gl.require(this, 'transformFeedbackVaryings', arguments.length, 3);
    const name = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'transformFeedbackVaryings',
    );
    if (name < 0) return;
    this.#state.call(
      OP.transformFeedbackVaryings,
      name,
      Array.from(varyings, String),
      gl.u32(bufferMode),
    );
  }

  getUniform(program, location) {
    gl.require(this, 'getUniform', arguments.length, 2);
    const state = this.#state;
    const name = nameOf(this, program, 'WebGLProgram', false, 'getUniform');
    if (name < 0) return null;
    const at = locationOf(location);
    if (at === null)
      throw new TypeError(
        "Failed to execute 'getUniform' on 'WebGL2RenderingContext': parameter 2 is not of type 'WebGLUniformLocation'.",
      );
    if (
      at.program !== program ||
      state.generations.get(program) !== at.generation
    ) {
      state.synthesize(C.INVALID_OPERATION);
      return null;
    }
    const value = state.call(OP.getUniform, name, at.location);
    return value === null ? null : uniformValue(value);
  }

  getUniformIndices(program, uniformNames) {
    gl.require(this, 'getUniformIndices', arguments.length, 2);
    const name = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getUniformIndices',
    );
    if (name < 0) return null;
    return this.#state.call(
      OP.getUniformIndices,
      name,
      Array.from(uniformNames, String),
    );
  }

  getActiveUniforms(program, uniformIndices, pname) {
    gl.require(this, 'getActiveUniforms', arguments.length, 3);
    const name = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getActiveUniforms',
    );
    if (name < 0) return null;
    const p = gl.u32(pname);
    const values = this.#state.call(
      OP.getActiveUniforms,
      name,
      Array.from(uniformIndices, gl.u32),
      p,
    );
    if (values === null) return null;
    if (p === C.UNIFORM_IS_ROW_MAJOR) return values.map((value) => value !== 0);
    if (p === C.UNIFORM_TYPE) return values.map((value) => value >>> 0);
    return values;
  }

  getUniformBlockIndex(program, uniformBlockName) {
    gl.require(this, 'getUniformBlockIndex', arguments.length, 2);
    const name = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getUniformBlockIndex',
    );
    if (name < 0) return C.INVALID_INDEX;
    return this.#state.call(
      OP.getUniformBlockIndex,
      name,
      String(uniformBlockName),
    );
  }

  getActiveUniformBlockParameter(program, uniformBlockIndex, pname) {
    gl.require(this, 'getActiveUniformBlockParameter', arguments.length, 3);
    const name = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getActiveUniformBlockParameter',
    );
    if (name < 0) return null;
    const p = gl.u32(pname);
    const value = this.#state.call(
      OP.getActiveUniformBlockParameter,
      name,
      gl.u32(uniformBlockIndex),
      p,
    );
    if (value === null) return null;
    if (p === C.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES)
      return Uint32Array.from(value);
    if (
      p === C.UNIFORM_BLOCK_REFERENCED_BY_VERTEX_SHADER ||
      p === C.UNIFORM_BLOCK_REFERENCED_BY_FRAGMENT_SHADER
    )
      return value !== 0;
    return value;
  }

  getActiveUniformBlockName(program, uniformBlockIndex) {
    gl.require(this, 'getActiveUniformBlockName', arguments.length, 2);
    const name = nameOf(
      this,
      program,
      'WebGLProgram',
      false,
      'getActiveUniformBlockName',
    );
    if (name < 0) return null;
    return this.#state.call(
      OP.getActiveUniformBlockName,
      name,
      gl.u32(uniformBlockIndex),
    );
  }

  getShaderPrecisionFormat(shadertype, precisiontype) {
    gl.require(this, 'getShaderPrecisionFormat', arguments.length, 2);
    const value = this.#state.call(
      OP.getShaderPrecisionFormat,
      gl.u32(shadertype),
      gl.u32(precisiontype),
    );
    return value === null
      ? null
      : new WebGLShaderPrecisionFormat(CONSTRUCTING, ...value);
  }

  // ── Uniforms and attributes ────────────────────────────────────────────

  #uniformv(method, location, transpose, data, srcOffset, srcLength) {
    const [kind, size, Type] = UNIFORM_KINDS[method];
    const state = this.#state;
    const at = gl.location(this, location, method);
    if (at === -2) return;
    const values = typed(data, Type, method);
    const range = rangeOf(values, srcOffset, srcLength);
    if (
      range === null ||
      range.length === 0 ||
      (range.length / Type.BYTES_PER_ELEMENT) % size !== 0
    ) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    state.call(
      OP.uniformv,
      kind,
      at,
      values,
      range.offset,
      range.length,
      transpose,
    );
  }

  #vertexAttribv(method, index, data) {
    const [kind, size, Type] = VERTEX_ATTRIB_KINDS[method];
    const state = this.#state;
    const values = typed(data, Type, method);
    if (values.length < size) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    state.call(
      OP.vertexAttribv,
      kind,
      gl.u32(index),
      values,
      0,
      size * Type.BYTES_PER_ELEMENT,
    );
  }

  getVertexAttrib(index, pname) {
    gl.require(this, 'getVertexAttrib', arguments.length, 2);
    const state = this.#state;
    const i = gl.u32(index);
    const p = gl.u32(pname);
    if (p === C.CURRENT_VERTEX_ATTRIB) {
      const value = state.call(OP.getVertexAttribCurrent, i);
      return value === null ? null : Float32Array.from(value);
    }
    const value = state.call(OP.getVertexAttrib, i, p);
    if (value === null) return null;
    if (p === C.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING)
      return state.objectNamed('WebGLBuffer', value);
    if (
      p === C.VERTEX_ATTRIB_ARRAY_ENABLED ||
      p === C.VERTEX_ATTRIB_ARRAY_NORMALIZED ||
      p === C.VERTEX_ATTRIB_ARRAY_INTEGER
    )
      return value !== 0;
    return value;
  }

  getVertexAttribOffset(index, pname) {
    gl.require(this, 'getVertexAttribOffset', arguments.length, 2);
    return (
      this.#state.call(
        OP.getVertexAttribOffset,
        gl.u32(index),
        gl.u32(pname),
      ) ?? 0
    );
  }

  // ── Buffers ────────────────────────────────────────────────────────────

  bufferData(target, data, usage, srcOffset, length) {
    gl.require(this, 'bufferData', arguments.length, 3);
    const state = this.#state;
    const t = gl.u32(target);
    const u = gl.u32(usage);
    if (typeof data === 'number' || typeof data === 'bigint') {
      const size = gl.i64(Number(data));
      if (size < 0) {
        state.synthesize(C.INVALID_VALUE);
        return;
      }
      state.call(OP.bufferData, t, null, 0, size, u);
      return;
    }
    if (data === null || data === undefined) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    if (data instanceof ArrayBuffer) {
      state.call(OP.bufferData, t, data, 0, data.byteLength, u);
      return;
    }
    if (!isView(data))
      throw new TypeError(
        "Failed to execute 'bufferData' on 'WebGL2RenderingContext': The provided value is not of type '(ArrayBuffer or ArrayBufferView)'.",
      );
    const range = rangeOf(data, srcOffset, length);
    if (range === null) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    state.call(OP.bufferData, t, bytesOf(data), range.offset, range.length, u);
  }

  bufferSubData(target, dstByteOffset, srcData, srcOffset, length) {
    gl.require(this, 'bufferSubData', arguments.length, 3);
    const state = this.#state;
    const offset = gl.i64(dstByteOffset);
    if (srcData instanceof ArrayBuffer) {
      state.call(
        OP.bufferSubData,
        gl.u32(target),
        offset,
        srcData,
        0,
        srcData.byteLength,
      );
      return;
    }
    if (!isView(srcData))
      throw new TypeError(
        "Failed to execute 'bufferSubData' on 'WebGL2RenderingContext': The provided value is not of type '(ArrayBuffer or ArrayBufferView)'.",
      );
    const range = rangeOf(srcData, srcOffset, length);
    if (range === null) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    state.call(
      OP.bufferSubData,
      gl.u32(target),
      offset,
      bytesOf(srcData),
      range.offset,
      range.length,
    );
  }

  getBufferSubData(target, srcByteOffset, dstBuffer, dstOffset, length) {
    gl.require(this, 'getBufferSubData', arguments.length, 3);
    const state = this.#state;
    if (!isView(dstBuffer))
      throw new TypeError(
        "Failed to execute 'getBufferSubData' on 'WebGL2RenderingContext': parameter 3 is not of type 'ArrayBufferView'.",
      );
    const range = rangeOf(dstBuffer, dstOffset, length);
    if (range === null) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    state.call(
      OP.getBufferSubData,
      gl.u32(target),
      gl.i64(srcByteOffset),
      bytesOf(dstBuffer),
      range.offset,
      range.length,
    );
  }

  getBufferParameter(target, pname) {
    gl.require(this, 'getBufferParameter', arguments.length, 2);
    return this.#state.call(
      OP.getBufferParameter,
      gl.u32(target),
      gl.u32(pname),
    );
  }

  // ── Textures ───────────────────────────────────────────────────────────

  /** Uploads ArrayBufferView data, null, or a source, by texImage2D's overloads. */
  texImage2D(...args) {
    gl.require(this, 'texImage2D', args.length, 6);
    const state = this.#state;
    const [target, level, internalformat] = [
      gl.u32(args[0]),
      gl.i32(args[1]),
      gl.i32(args[2]),
    ];
    if (args.length < 9) {
      // (target, level, internalformat, format, type, source)
      const [format, type] = [gl.u32(args[3]), gl.u32(args[4])];
      this.#uploadSource('texImage2D', args[5], format, type, (upload) => {
        if (upload.canvas !== undefined)
          state.call(
            OP.texImageCanvas,
            target,
            level,
            internalformat,
            format,
            type,
            upload.canvas,
            state.flipY,
            state.premultiplyAlpha,
          );
        else
          state.call(
            OP.texImage2D,
            target,
            level,
            internalformat,
            upload.width,
            upload.height,
            0,
            format,
            type,
            upload.data,
            0,
            upload.data.byteLength,
            state.flipY,
            state.premultiplyAlpha,
          );
      });
      return;
    }
    const [width, height, border, format, type] = args
      .slice(3, 8)
      .map((value, index) => (index < 3 ? gl.i32(value) : gl.u32(value)));
    const pixels = args[8];
    if (typeof pixels === 'number') {
      state.call(
        OP.texImage2DOffset,
        target,
        level,
        internalformat,
        width,
        height,
        border,
        format,
        type,
        gl.i64(pixels),
      );
      return;
    }
    if (pixels === null || pixels === undefined) {
      state.call(
        OP.texImage2D,
        target,
        level,
        internalformat,
        width,
        height,
        border,
        format,
        type,
        null,
        0,
        0,
        false,
        false,
      );
      return;
    }
    if (isView(pixels)) {
      const range = rangeOf(pixels, args[9] ?? 0, 0);
      if (range === null) {
        state.synthesize(C.INVALID_VALUE);
        return;
      }
      state.call(
        OP.texImage2D,
        target,
        level,
        internalformat,
        width,
        height,
        border,
        format,
        type,
        bytesOf(pixels),
        range.offset,
        range.length,
        state.flipY,
        state.premultiplyAlpha,
      );
      return;
    }
    this.#uploadSource('texImage2D', pixels, format, type, (upload) => {
      if (upload.canvas !== undefined)
        state.call(
          OP.texImageCanvas,
          target,
          level,
          internalformat,
          format,
          type,
          upload.canvas,
          state.flipY,
          state.premultiplyAlpha,
        );
      else
        state.call(
          OP.texImage2D,
          target,
          level,
          internalformat,
          upload.width,
          upload.height,
          border,
          format,
          type,
          upload.data,
          0,
          upload.data.byteLength,
          state.flipY,
          state.premultiplyAlpha,
        );
    });
  }

  texSubImage2D(...args) {
    gl.require(this, 'texSubImage2D', args.length, 7);
    const state = this.#state;
    const [target, level, x, y] = [
      gl.u32(args[0]),
      gl.i32(args[1]),
      gl.i32(args[2]),
      gl.i32(args[3]),
    ];
    if (args.length < 9) {
      // (target, level, x, y, format, type, source)
      const [format, type] = [gl.u32(args[4]), gl.u32(args[5])];
      this.#uploadSource('texSubImage2D', args[6], format, type, (upload) => {
        if (upload.canvas !== undefined)
          state.call(
            OP.texSubImageCanvas,
            target,
            level,
            x,
            y,
            format,
            type,
            upload.canvas,
            state.flipY,
            state.premultiplyAlpha,
          );
        else
          state.call(
            OP.texSubImage2D,
            target,
            level,
            x,
            y,
            upload.width,
            upload.height,
            format,
            type,
            upload.data,
            0,
            upload.data.byteLength,
            state.flipY,
            state.premultiplyAlpha,
          );
      });
      return;
    }
    const [width, height] = [gl.i32(args[4]), gl.i32(args[5])];
    const [format, type] = [gl.u32(args[6]), gl.u32(args[7])];
    const pixels = args[8];
    if (typeof pixels === 'number') {
      state.call(
        OP.texSubImage2DOffset,
        target,
        level,
        x,
        y,
        width,
        height,
        format,
        type,
        gl.i64(pixels),
      );
      return;
    }
    if (pixels === null || pixels === undefined)
      throw new TypeError(
        "Failed to execute 'texSubImage2D' on 'WebGL2RenderingContext': parameter 9 is not of type 'ArrayBufferView'.",
      );
    if (isView(pixels)) {
      const range = rangeOf(pixels, args[9] ?? 0, 0);
      if (range === null) {
        state.synthesize(C.INVALID_VALUE);
        return;
      }
      state.call(
        OP.texSubImage2D,
        target,
        level,
        x,
        y,
        width,
        height,
        format,
        type,
        bytesOf(pixels),
        range.offset,
        range.length,
        state.flipY,
        state.premultiplyAlpha,
      );
      return;
    }
    this.#uploadSource('texSubImage2D', pixels, format, type, (upload) => {
      if (upload.canvas !== undefined)
        state.call(
          OP.texSubImageCanvas,
          target,
          level,
          x,
          y,
          format,
          type,
          upload.canvas,
          state.flipY,
          state.premultiplyAlpha,
        );
      else
        state.call(
          OP.texSubImage2D,
          target,
          level,
          x,
          y,
          upload.width,
          upload.height,
          format,
          type,
          upload.data,
          0,
          upload.data.byteLength,
          state.flipY,
          state.premultiplyAlpha,
        );
    });
  }

  #uploadSource(method, source, format, type, upload) {
    const state = this.#state;
    if (state.lost) return;
    const resolved = sourceUpload(state, source, method);
    checkCanvasFormat(format, type, method);
    if (resolved.canvas !== undefined) upload(resolved);
    else withAlignment(state, 1, () => upload(resolved));
  }

  texImage3D(
    target,
    level,
    internalformat,
    width,
    height,
    depth,
    border,
    format,
    type,
    srcData,
    srcOffset,
  ) {
    gl.require(this, 'texImage3D', arguments.length, 10);
    const state = this.#state;
    const fixed = [
      gl.u32(target),
      gl.i32(level),
      gl.i32(internalformat),
      gl.i32(width),
      gl.i32(height),
      gl.i32(depth),
      gl.i32(border),
      gl.u32(format),
      gl.u32(type),
    ];
    if (srcData === null || srcData === undefined) {
      state.call(OP.texImage3D, ...fixed, null, 0, 0, false, false);
      return;
    }
    if (!isView(srcData))
      throw unsupported('texImage3D() from a buffer offset or an image source');
    const range = rangeOf(srcData, srcOffset ?? 0, 0);
    if (range === null) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    if (state.flipY || state.premultiplyAlpha) {
      state.synthesize(C.INVALID_OPERATION);
      return;
    }
    state.call(
      OP.texImage3D,
      ...fixed,
      bytesOf(srcData),
      range.offset,
      range.length,
      false,
      false,
    );
  }

  texSubImage3D(
    target,
    level,
    xoffset,
    yoffset,
    zoffset,
    width,
    height,
    depth,
    format,
    type,
    srcData,
    srcOffset,
  ) {
    gl.require(this, 'texSubImage3D', arguments.length, 11);
    const state = this.#state;
    if (!isView(srcData))
      throw unsupported(
        'texSubImage3D() from a buffer offset or an image source',
      );
    const range = rangeOf(srcData, srcOffset ?? 0, 0);
    if (range === null) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    if (state.flipY || state.premultiplyAlpha) {
      state.synthesize(C.INVALID_OPERATION);
      return;
    }
    state.call(
      OP.texSubImage3D,
      gl.u32(target),
      gl.i32(level),
      gl.i32(xoffset),
      gl.i32(yoffset),
      gl.i32(zoffset),
      gl.i32(width),
      gl.i32(height),
      gl.i32(depth),
      gl.u32(format),
      gl.u32(type),
      bytesOf(srcData),
      range.offset,
      range.length,
      false,
      false,
    );
  }

  #compressed(method, op, fixed, data, srcOffset, srcLengthOverride) {
    const state = this.#state;
    if (!isView(data)) throw unsupported(`${method}() from a buffer offset`);
    const range = rangeOf(data, srcOffset ?? 0, srcLengthOverride ?? 0);
    if (range === null) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    state.call(op, ...fixed, bytesOf(data), range.offset, range.length);
  }

  compressedTexImage2D(
    target,
    level,
    internalformat,
    width,
    height,
    border,
    data,
    srcOffset,
    srcLengthOverride,
  ) {
    gl.require(this, 'compressedTexImage2D', arguments.length, 7);
    this.#compressed(
      'compressedTexImage2D',
      OP.compressedTexImage2D,
      [
        gl.u32(target),
        gl.i32(level),
        gl.u32(internalformat),
        gl.i32(width),
        gl.i32(height),
        gl.i32(border),
      ],
      data,
      srcOffset,
      srcLengthOverride,
    );
  }

  compressedTexSubImage2D(
    target,
    level,
    xoffset,
    yoffset,
    width,
    height,
    format,
    data,
    srcOffset,
    srcLengthOverride,
  ) {
    gl.require(this, 'compressedTexSubImage2D', arguments.length, 8);
    this.#compressed(
      'compressedTexSubImage2D',
      OP.compressedTexSubImage2D,
      [
        gl.u32(target),
        gl.i32(level),
        gl.i32(xoffset),
        gl.i32(yoffset),
        gl.i32(width),
        gl.i32(height),
        gl.u32(format),
      ],
      data,
      srcOffset,
      srcLengthOverride,
    );
  }

  compressedTexImage3D(
    target,
    level,
    internalformat,
    width,
    height,
    depth,
    border,
    data,
    srcOffset,
    srcLengthOverride,
  ) {
    gl.require(this, 'compressedTexImage3D', arguments.length, 8);
    this.#compressed(
      'compressedTexImage3D',
      OP.compressedTexImage3D,
      [
        gl.u32(target),
        gl.i32(level),
        gl.u32(internalformat),
        gl.i32(width),
        gl.i32(height),
        gl.i32(depth),
        gl.i32(border),
      ],
      data,
      srcOffset,
      srcLengthOverride,
    );
  }

  compressedTexSubImage3D(
    target,
    level,
    xoffset,
    yoffset,
    zoffset,
    width,
    height,
    depth,
    format,
    data,
    srcOffset,
    srcLengthOverride,
  ) {
    gl.require(this, 'compressedTexSubImage3D', arguments.length, 10);
    this.#compressed(
      'compressedTexSubImage3D',
      OP.compressedTexSubImage3D,
      [
        gl.u32(target),
        gl.i32(level),
        gl.i32(xoffset),
        gl.i32(yoffset),
        gl.i32(zoffset),
        gl.i32(width),
        gl.i32(height),
        gl.i32(depth),
        gl.u32(format),
      ],
      data,
      srcOffset,
      srcLengthOverride,
    );
  }

  getTexParameter(target, pname) {
    gl.require(this, 'getTexParameter', arguments.length, 2);
    const p = gl.u32(pname);
    const float =
      p === C.TEXTURE_MAX_LOD ||
      p === C.TEXTURE_MIN_LOD ||
      p === MAX_ANISOTROPY;
    const value = this.#state.call(
      OP.getTexParameter,
      gl.u32(target),
      p,
      float,
    );
    if (value === null) return null;
    return p === C.TEXTURE_IMMUTABLE_FORMAT ? value !== 0 : value;
  }

  samplerParameteri(sampler, pname, param) {
    gl.require(this, 'samplerParameteri', arguments.length, 3);
    const name = nameOf(
      this,
      sampler,
      'WebGLSampler',
      false,
      'samplerParameteri',
    );
    if (name < 0) return;
    this.#state.call(OP.samplerParameteri, name, gl.u32(pname), gl.i32(param));
  }

  samplerParameterf(sampler, pname, param) {
    gl.require(this, 'samplerParameterf', arguments.length, 3);
    const name = nameOf(
      this,
      sampler,
      'WebGLSampler',
      false,
      'samplerParameterf',
    );
    if (name < 0) return;
    this.#state.call(OP.samplerParameterf, name, gl.u32(pname), gl.f32(param));
  }

  getSamplerParameter(sampler, pname) {
    gl.require(this, 'getSamplerParameter', arguments.length, 2);
    const name = nameOf(
      this,
      sampler,
      'WebGLSampler',
      false,
      'getSamplerParameter',
    );
    if (name < 0) return null;
    const p = gl.u32(pname);
    return this.#state.call(
      OP.getSamplerParameter,
      name,
      p,
      p === C.TEXTURE_MAX_LOD || p === C.TEXTURE_MIN_LOD,
    );
  }

  getRenderbufferParameter(target, pname) {
    gl.require(this, 'getRenderbufferParameter', arguments.length, 2);
    return this.#state.call(
      OP.getRenderbufferParameter,
      gl.u32(target),
      gl.u32(pname),
    );
  }

  getInternalformatParameter(target, internalformat, pname) {
    gl.require(this, 'getInternalformatParameter', arguments.length, 3);
    const value = this.#state.call(
      OP.getInternalformatParameter,
      gl.u32(target),
      gl.u32(internalformat),
      gl.u32(pname),
    );
    return value === null ? null : Int32Array.from(value);
  }

  pixelStorei(pname, param) {
    gl.require(this, 'pixelStorei', arguments.length, 2);
    const state = this.#state;
    const p = gl.u32(pname);
    if (p === UNPACK_FLIP_Y_WEBGL) state.flipY = Boolean(param);
    else if (p === UNPACK_PREMULTIPLY_ALPHA_WEBGL)
      state.premultiplyAlpha = Boolean(param);
    else if (p === UNPACK_COLORSPACE_CONVERSION_WEBGL) {
      const value = gl.u32(param);
      if (value !== C.NONE && value !== BROWSER_DEFAULT_WEBGL)
        state.synthesize(C.INVALID_VALUE);
      else state.colorspaceConversion = value;
    } else generated.pixelStorei.call(this, p, param);
  }

  // ── Reading ────────────────────────────────────────────────────────────

  readPixels(x, y, width, height, format, type, dstData, dstOffset) {
    gl.require(this, 'readPixels', arguments.length, 7);
    const state = this.#state;
    const fixed = [
      gl.i32(x),
      gl.i32(y),
      gl.i32(width),
      gl.i32(height),
      gl.u32(format),
      gl.u32(type),
    ];
    if (typeof dstData === 'number') {
      state.call(OP.readPixelsOffset, ...fixed, gl.i64(dstData));
      return;
    }
    if (!isView(dstData))
      throw new TypeError(
        "Failed to execute 'readPixels' on 'WebGL2RenderingContext': parameter 7 is not of type 'ArrayBufferView'.",
      );
    const range = rangeOf(dstData, dstOffset ?? 0, 0);
    if (range === null) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    state.call(
      OP.readPixels,
      ...fixed,
      bytesOf(dstData),
      range.offset,
      range.length,
    );
  }

  getParameter(pname) {
    gl.require(this, 'getParameter', arguments.length, 1);
    const state = this.#state;
    const p = gl.u32(pname);
    if (state.lost) return null;
    switch (p) {
      case C.VERSION:
        return 'WebGL 2.0 (OpenGL ES 3.0 Soundor)';
      case C.SHADING_LANGUAGE_VERSION:
        return 'WebGL GLSL ES 3.00 (OpenGL ES GLSL ES 3.0 Soundor)';
      case C.VENDOR:
        return 'Soundor';
      case C.RENDERER:
        return 'Soundor WebGL';
      case UNMASKED_VENDOR_WEBGL:
      case UNMASKED_RENDERER_WEBGL:
        if (!state.extensions.has('WEBGL_debug_renderer_info')) break;
        return state.call(
          OP.getString,
          p === UNMASKED_VENDOR_WEBGL ? C.VENDOR : C.RENDERER,
        );
      case UNPACK_FLIP_Y_WEBGL:
        return state.flipY;
      case UNPACK_PREMULTIPLY_ALPHA_WEBGL:
        return state.premultiplyAlpha;
      case UNPACK_COLORSPACE_CONVERSION_WEBGL:
        return state.colorspaceConversion;
      case C.FRAMEBUFFER_BINDING:
        return state.drawFramebuffer;
      case C.READ_FRAMEBUFFER_BINDING:
        return state.readFramebuffer;
      case C.CURRENT_PROGRAM:
        return state.program;
      default:
        break;
    }
    const value = state.call(OP.getParameter, p, kindOf(p));
    if (value === null) return null;
    const type = OBJECT_PARAMETERS.get(p);
    if (type !== undefined) return state.objectNamed(type, value[0]);
    const Type = ARRAY_PARAMETERS.get(p);
    if (Type === Array) return value.map((element) => element !== 0);
    if (Type !== undefined) return Type.from(value);
    if (BOOLEAN_PARAMETERS.has(p)) return value[0] !== 0;
    // The drawing buffer's color buffer is BACK, whatever OpenGL calls it.
    if (
      (p === C.READ_BUFFER && state.readFramebuffer === null) ||
      (p === C.DRAW_BUFFER0 && state.drawFramebuffer === null)
    )
      return value[0] === C.NONE ? C.NONE : C.BACK;
    return value[0];
  }

  getIndexedParameter(target, index) {
    gl.require(this, 'getIndexedParameter', arguments.length, 2);
    const state = this.#state;
    const t = gl.u32(target);
    const isBinding =
      t === C.TRANSFORM_FEEDBACK_BUFFER_BINDING ||
      t === C.UNIFORM_BUFFER_BINDING;
    const value = state.call(
      OP.getIndexedParameter,
      t,
      gl.u32(index),
      isBinding ? KIND.int : KIND.int64,
    );
    if (value === null) return null;
    return isBinding ? state.objectNamed('WebGLBuffer', value[0]) : value[0];
  }

  // ── Clearing ───────────────────────────────────────────────────────────

  #clearBuffer(method, kind, Type, buffer, drawbuffer, values, srcOffset) {
    const state = this.#state;
    const data = typed(values, Type, method);
    const range = rangeOf(data, srcOffset ?? 0, 0);
    const b = gl.u32(buffer);
    const needed = b === C.COLOR ? 4 : 1;
    if (range === null || range.length < needed * 4) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    state.call(
      OP.clearBufferv,
      kind,
      b,
      gl.i32(drawbuffer),
      data,
      range.offset,
      range.length,
    );
  }

  clearBufferfv(buffer, drawbuffer, values, srcOffset) {
    gl.require(this, 'clearBufferfv', arguments.length, 3);
    this.#clearBuffer(
      'clearBufferfv',
      0,
      Float32Array,
      buffer,
      drawbuffer,
      values,
      srcOffset,
    );
  }

  clearBufferiv(buffer, drawbuffer, values, srcOffset) {
    gl.require(this, 'clearBufferiv', arguments.length, 3);
    this.#clearBuffer(
      'clearBufferiv',
      1,
      Int32Array,
      buffer,
      drawbuffer,
      values,
      srcOffset,
    );
  }

  clearBufferuiv(buffer, drawbuffer, values, srcOffset) {
    gl.require(this, 'clearBufferuiv', arguments.length, 3);
    this.#clearBuffer(
      'clearBufferuiv',
      2,
      Uint32Array,
      buffer,
      drawbuffer,
      values,
      srcOffset,
    );
  }

  // ── Queries and syncs ──────────────────────────────────────────────────

  getQuery(target, pname) {
    gl.require(this, 'getQuery', arguments.length, 2);
    const state = this.#state;
    const value = state.call(OP.getQuery, gl.u32(target), gl.u32(pname));
    return value === null ? null : state.objectNamed('WebGLQuery', value);
  }

  getQueryParameter(query, pname) {
    gl.require(this, 'getQueryParameter', arguments.length, 2);
    const name = nameOf(this, query, 'WebGLQuery', false, 'getQueryParameter');
    if (name < 0) return null;
    const p = gl.u32(pname);
    const value = this.#state.call(OP.getQueryParameter, name, p);
    if (value === null) return null;
    return p === C.QUERY_RESULT_AVAILABLE ? value !== 0 : value;
  }

  fenceSync(condition, flags) {
    gl.require(this, 'fenceSync', arguments.length, 2);
    const state = this.#state;
    const id = state.call(OP.fenceSync, gl.u32(condition), gl.u32(flags));
    return id === null || id === 0 ? null : state.wrap('WebGLSync', id);
  }

  clientWaitSync(sync, flags, timeout) {
    gl.require(this, 'clientWaitSync', arguments.length, 3);
    const state = this.#state;
    const name = nameOf(this, sync, 'WebGLSync', false, 'clientWaitSync');
    if (name < 0) return C.WAIT_FAILED;
    // WebGL's MAX_CLIENT_WAIT_TIMEOUT_WEBGL is 0: it never blocks.
    if (gl.i64(timeout) > 0) {
      state.synthesize(C.INVALID_OPERATION);
      return C.WAIT_FAILED;
    }
    return state.call(OP.clientWaitSync, name, gl.u32(flags));
  }

  waitSync(sync, flags, timeout) {
    gl.require(this, 'waitSync', arguments.length, 3);
    const state = this.#state;
    const name = nameOf(this, sync, 'WebGLSync', false, 'waitSync');
    if (name < 0) return;
    if (Number(timeout) !== -1) {
      state.synthesize(C.INVALID_VALUE);
      return;
    }
    state.call(OP.waitSync, name, gl.u32(flags));
  }

  deleteSync(sync) {
    gl.require(this, 'deleteSync', arguments.length, 1);
    gl.delete(this, sync, 'WebGLSync', OP.deleteSync);
  }

  isSync(sync) {
    gl.require(this, 'isSync', arguments.length, 1);
    const name = gl.nameIfLive(this, sync, 'WebGLSync');
    return name > 0 && Boolean(this.#state.call(OP.isSync, name));
  }

  getSyncParameter(sync, pname) {
    gl.require(this, 'getSyncParameter', arguments.length, 2);
    const name = nameOf(this, sync, 'WebGLSync', false, 'getSyncParameter');
    if (name < 0) return null;
    return this.#state.call(OP.getSyncParameter, name, gl.u32(pname));
  }
}

// The generated methods, and the vector forms of uniform and vertexAttrib.
{
  const proto = WebGL2RenderingContext.prototype;
  for (const [name, method] of Object.entries(generated))
    if (!Object.hasOwn(proto, name))
      Object.defineProperty(proto, name, {
        value: method,
        writable: true,
        enumerable: true,
        configurable: true,
      });
  for (const name of Object.keys(UNIFORM_KINDS)) {
    const matrix = name.startsWith('uniformMatrix');
    Object.defineProperty(proto, name, {
      value: matrix
        ? function (location, transpose, data, srcOffset, srcLength) {
            gl.require(this, name, arguments.length, 3);
            return uniformv(
              this,
              name,
              location,
              Boolean(transpose),
              data,
              srcOffset,
              srcLength,
            );
          }
        : function (location, data, srcOffset, srcLength) {
            gl.require(this, name, arguments.length, 2);
            return uniformv(
              this,
              name,
              location,
              false,
              data,
              srcOffset,
              srcLength,
            );
          },
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  for (const name of Object.keys(VERTEX_ATTRIB_KINDS))
    Object.defineProperty(proto, name, {
      value(index, values) {
        gl.require(this, name, arguments.length, 2);
        return vertexAttribv(this, name, index, values);
      },
      writable: true,
      enumerable: true,
      configurable: true,
    });
  for (const [name, value] of Object.entries(CONSTANTS)) {
    Object.defineProperty(proto, name, { value, enumerable: true });
    Object.defineProperty(WebGL2RenderingContext, name, {
      value,
      enumerable: true,
    });
  }
}

/**
 * The WebGL 2 context of a canvas node, or null when there is none (no
 * acceptable GPU): then why is logged, as browsers do.
 */
export function createWebGL2(canvas, node, options) {
  const settings = options ?? {};
  const attribute = (name, fallback) =>
    settings[name] === undefined ? fallback : Boolean(settings[name]);
  const flags = [
    attribute('alpha', true),
    attribute('depth', true),
    attribute('stencil', false),
    attribute('antialias', true),
    attribute('premultipliedAlpha', true),
    attribute('preserveDrawingBuffer', false),
    attribute('failIfMajorPerformanceCaveat', false),
  ].map(Number);
  if (settings.xrCompatible === true)
    throw unsupported("getContext('webgl2', { xrCompatible: true })");
  const id = native.webglCreate(node, flags);
  if (typeof id === 'string') {
    console.warn(`getContext('webgl2'): ${id}`);
    return null;
  }
  const context = new WebGL2RenderingContext(CONSTRUCTING, canvas, node, id);
  contexts.register(context, id);
  return context;
}

/** The canvas was resized: so is its drawing buffer, which starts cleared. */
export function resizeWebGL(context) {
  const state = stateOf(context);
  state.size = null;
  if (!state.lost) native.webglResize(state.id);
}

// Web globals, as in a browser's window.
for (const [name, value] of Object.entries({
  WebGL2RenderingContext,
  WebGLActiveInfo,
  WebGLShaderPrecisionFormat,
  WebGLUniformLocation,
  ...TYPES,
})) {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    enumerable: false,
    configurable: true,
  });
}
