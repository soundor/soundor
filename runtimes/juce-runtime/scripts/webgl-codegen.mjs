// Generates the mechanical part of Soundor's WebGL2RenderingContext from the
// Khronos WebGL IDL (native/src/gpu/webgl/idl): its constants, and the
// methods whose arguments are numbers, booleans and WebGL objects. Each such
// method converts its arguments as WebIDL does in JavaScript, then makes one
// native call, whose C++ side calls the OpenGL ES function of the same name.
// Everything else (data uploads, getters, strings, the default framebuffer)
// is written by hand in webgl.js and WebGLModule.cpp.
//
//   node scripts/webgl-codegen.mjs [--check]
//
// Output: native/src/gpu/webgl/generated/{webgl-generated.js,WebGLGenerated.inc},
// and the TypeScript declarations of WebGL 2 in packages/core/src/webgl-dts.ts.
// --check fails when they are not up to date.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const webgl = join(root, 'native/src/gpu/webgl');
const coreSource = join(root, '../../packages/core/src');

/** IDL types by how a value of theirs travels: its WebIDL conversion and C++ reader. */
const SCALARS = {
  GLenum: { js: 'u32', cpp: 'u32' },
  GLbitfield: { js: 'u32', cpp: 'u32' },
  GLuint: { js: 'u32', cpp: 'u32' },
  GLint: { js: 'i32', cpp: 'i32' },
  GLsizei: { js: 'i32', cpp: 'i32' },
  GLintptr: { js: 'i64', cpp: 'i64' },
  GLsizeiptr: { js: 'i64', cpp: 'i64' },
  GLint64: { js: 'i64', cpp: 'i64' },
  GLfloat: { js: 'f32', cpp: 'f32' },
  GLclampf: { js: 'f32', cpp: 'f32' },
  GLboolean: { js: 'bool', cpp: 'boolean' },
  boolean: { js: 'bool', cpp: 'boolean' },
};

/** WebGL objects: their wrapper class, and how OpenGL ES makes, ends and recognizes one. */
export const OBJECTS = {
  WebGLBuffer: {
    gen: 'glGenBuffers',
    del: 'glDeleteBuffers',
    is: 'glIsBuffer',
  },
  WebGLFramebuffer: {
    gen: 'glGenFramebuffers',
    del: 'glDeleteFramebuffers',
    is: 'glIsFramebuffer',
  },
  WebGLRenderbuffer: {
    gen: 'glGenRenderbuffers',
    del: 'glDeleteRenderbuffers',
    is: 'glIsRenderbuffer',
  },
  WebGLTexture: {
    gen: 'glGenTextures',
    del: 'glDeleteTextures',
    is: 'glIsTexture',
    // Textures belong to the device (its contexts share them), not to the
    // context: the context keeps track of its own, to delete them with it.
    owned: true,
  },
  WebGLQuery: { gen: 'glGenQueries', del: 'glDeleteQueries', is: 'glIsQuery' },
  WebGLSampler: {
    gen: 'glGenSamplers',
    del: 'glDeleteSamplers',
    is: 'glIsSampler',
  },
  WebGLTransformFeedback: {
    gen: 'glGenTransformFeedbacks',
    del: 'glDeleteTransformFeedbacks',
    is: 'glIsTransformFeedback',
  },
  WebGLVertexArrayObject: {
    gen: 'glGenVertexArrays',
    del: 'glDeleteVertexArrays',
    is: 'glIsVertexArray',
  },
  WebGLProgram: {
    create: 'glCreateProgram()',
    del: 'glDeleteProgram',
    is: 'glIsProgram',
    single: true,
  },
  WebGLShader: {
    create: 'glCreateShader(a.u32(0))',
    del: 'glDeleteShader',
    is: 'glIsShader',
    single: true,
  },
};

/** Written by hand although their signature would do: they need more than one call. */
const HANDWRITTEN = new Set([
  'bindFramebuffer', // null is Soundor's drawing buffer, not framebuffer 0
  'getError', // merges the errors JavaScript found with OpenGL's
  'isContextLost',
  'useProgram', // remembered, to check uniform locations
  'deleteFramebuffer', // the drawing buffer's binding comes back
  'framebufferTexture2D', // checked against the drawing buffer
  'framebufferRenderbuffer',
  'linkProgram', // forgets the program's uniform locations
  'drawingBufferStorage',
  'samplerParameterf', // fine to generate, but named oddly in some IDL versions
  'samplerParameteri',
  'getVertexAttribOffset', // glGetVertexAttribPointerv in OpenGL ES
]);

/** Draw into the bound draw framebuffer: Soundor's drawing buffer may change. */
const DRAWS = new Set([
  'clear',
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'drawRangeElements',
  'blitFramebuffer',
]);

/** Read the bound read framebuffer: a multisampled drawing buffer is resolved first. */
const READS = new Set([
  'copyTexImage2D',
  'copyTexSubImage2D',
  'copyTexSubImage3D',
  'blitFramebuffer',
]);

/** Byte offsets OpenGL ES takes as pointers (into the bound buffer). */
const POINTER_OFFSETS = new Set([
  'drawElements',
  'drawElementsInstanced',
  'drawRangeElements',
  'vertexAttribPointer',
  'vertexAttribIPointer',
]);

/** OpenGL ES names that are not 'gl' + the WebGL name. */
const GL_NAMES = {
  clearDepth: 'glClearDepthf',
  depthRange: 'glDepthRangef',
  // WebGL's finish() need not wait, and Soundor never stalls the UI thread.
  finish: 'glFlush',
};

function strip(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** The constants and operations of the WebGL 1 and 2 rendering context mixins. */
export function parseIdl(sources) {
  const constants = [];
  const operations = [];
  const seen = new Set();
  for (const source of sources) {
    const text = strip(source);
    const mixin = /interface mixin (\w+)\s*\{([\s\S]*?)\n\};/g;
    for (let match; (match = mixin.exec(text));) {
      const [, interfaceName, body] = match;
      if (
        !interfaceName.endsWith('Base') &&
        !interfaceName.endsWith('Overloads')
      )
        continue;
      for (const raw of body.split(';')) {
        const statement = raw.replace(/\s+/g, ' ').trim();
        if (statement === '') continue;
        const constant = /^const \w+ (\w+) = (0x[0-9A-Fa-f]+|-?\d+)$/.exec(
          statement,
        );
        if (constant) {
          if (!seen.has(constant[1])) {
            seen.add(constant[1]);
            constants.push({ name: constant[1], value: Number(constant[2]) });
          }
          continue;
        }
        if (statement.includes('attribute ')) continue;
        const operation = /^(?:\[[^\]]*\] )?(.+?) (\w+)\((.*)\)$/.exec(
          statement,
        );
        if (!operation)
          throw new Error(`cannot read IDL statement: ${statement}`);
        const [, returns, name, list] = operation;
        const parameters = list
          .split(',')
          .map((parameter) => parameter.trim())
          .filter(Boolean)
          .map((parameter) => {
            const clean = parameter
              .replace(/\[[^\]]*\] /g, '')
              .replace(/^optional /, '');
            const [declaration] = clean.split('=');
            const words = declaration.trim().split(' ');
            const parameterName = words.pop();
            return {
              name: parameterName,
              type: words.join(' '),
              optional: parameter.includes('optional '),
              default: clean.includes('=')
                ? clean.split('=')[1].trim()
                : undefined,
            };
          });
        operations.push({
          interfaceName,
          name,
          returns: returns.trim(),
          parameters,
        });
      }
    }
  }
  return { constants, operations };
}

function kindOf(type) {
  const nullable = type.endsWith('?');
  const bare = nullable ? type.slice(0, -1) : type;
  if (SCALARS[bare] && !nullable) return { kind: 'scalar', ...SCALARS[bare] };
  if (OBJECTS[bare]) return { kind: 'object', object: bare, nullable };
  if (bare === 'WebGLUniformLocation') return { kind: 'location', nullable };
  return null;
}

/** The operations generated: every parameter and the result of a kind we know. */
export function generatedOperations(operations) {
  const byName = new Map();
  for (const operation of operations) {
    // Overloads (bufferData, texImage2D, …) are written by hand.
    byName.set(operation.name, byName.has(operation.name) ? null : operation);
  }
  const result = [];
  for (const operation of operations) {
    if (
      byName.get(operation.name) !== operation ||
      HANDWRITTEN.has(operation.name)
    )
      continue;
    const parameters = operation.parameters.map((parameter) => ({
      ...parameter,
      ...kindOf(parameter.type),
    }));
    if (parameters.some((parameter) => parameter.kind === undefined)) continue;
    const returns = operation.returns;
    let result_;
    if (returns === 'undefined') result_ = { kind: 'void' };
    else if (SCALARS[returns])
      result_ = { kind: 'scalar', ...SCALARS[returns] };
    else if (OBJECTS[returns.replace(/\?$/, '')])
      result_ = { kind: 'object', object: returns.replace(/\?$/, '') };
    else continue;
    const creates = /^create/.test(operation.name) && result_.kind === 'object';
    const deletes =
      /^delete/.test(operation.name) &&
      parameters.length === 1 &&
      parameters[0].kind === 'object';
    const is =
      /^is[A-Z]/.test(operation.name) &&
      parameters.length === 1 &&
      parameters[0].kind === 'object';
    if (result_.kind === 'object' && !creates) continue;
    result.push({
      ...operation,
      parameters,
      result: result_,
      creates,
      deletes,
      is,
    });
  }
  return result;
}

function capitalize(name) {
  return name[0].toUpperCase() + name.slice(1);
}

function jsMethod(operation, op) {
  const required = operation.parameters.filter(
    (parameter) => !parameter.optional,
  ).length;
  const names = operation.parameters.map((parameter) => parameter.name);
  const lines = [];
  lines.push(`  ${operation.name}(${names.join(', ')}) {`);
  if (required > 0)
    lines.push(
      `    gl.require(this, '${operation.name}', arguments.length, ${required});`,
    );
  if (operation.deletes) {
    lines.push(
      `    gl.delete(this, ${names[0]}, '${operation.parameters[0].object}', ${op});`,
    );
    lines.push('  },');
    return lines.join('\n');
  }
  if (operation.is) {
    lines.push(
      `    const name = gl.nameIfLive(this, ${names[0]}, '${operation.parameters[0].object}');`,
    );
    lines.push(`    return name > 0 && gl.call(this, ${op}, name);`);
    lines.push('  },');
    return lines.join('\n');
  }
  const args = [];
  operation.parameters.forEach((parameter, index) => {
    const name = names[index];
    const value =
      parameter.default !== undefined && parameter.optional
        ? `(${name} === undefined ? ${parameter.default} : ${name})`
        : name;
    if (parameter.kind === 'scalar') args.push(`gl.${parameter.js}(${value})`);
    else if (parameter.kind === 'object') {
      lines.push(
        `    const ${name}Name = gl.name(this, ${name}, '${parameter.object}', ${parameter.nullable}, '${operation.name}');`,
      );
      lines.push(
        `    if (${name}Name < 0) return${operation.result.kind === 'void' ? '' : ' null'};`,
      );
      args.push(`${name}Name`);
    } else {
      lines.push(
        `    const ${name}At = gl.location(this, ${name}, '${operation.name}');`,
      );
      lines.push(`    if (${name}At === -2) return;`);
      args.push(`${name}At`);
    }
  });
  const call = `gl.call(this, ${op}${args.length ? ', ' + args.join(', ') : ''})`;
  if (operation.creates)
    lines.push(
      `    return gl.wrap(this, '${operation.result.object}', ${call});`,
    );
  else if (operation.result.kind === 'void') lines.push(`    ${call};`);
  else lines.push(`    return ${call};`);
  lines.push('  },');
  return lines.join('\n');
}

function cppCase(operation, op) {
  const glName = GL_NAMES[operation.name] ?? `gl${capitalize(operation.name)}`;
  const lines = [`        case ${op}: // ${operation.name}`, '        {'];
  if (READS.has(operation.name))
    lines.push('            context.prepareRead();');
  if (DRAWS.has(operation.name))
    lines.push('            context.prepareDraw();');
  if (operation.creates) {
    const object = OBJECTS[operation.result.object];
    if (object.single)
      lines.push(
        `            return JS_NewUint32(ctx, ${object.create.replace('a.', 'args.')});`,
      );
    else {
      lines.push('            GLuint name = 0;');
      lines.push(`            ${object.gen}(1, &name);`);
      if (object.owned) lines.push('            context.ownTexture(name);');
      lines.push('            return JS_NewUint32(ctx, name);');
    }
  } else if (operation.deletes) {
    const object = OBJECTS[operation.parameters[0].object];
    if (object.single) lines.push(`            ${object.del}(args.u32(0));`);
    else {
      lines.push('            const GLuint name = args.u32(0);');
      lines.push(`            ${object.del}(1, &name);`);
      if (object.owned) lines.push('            context.disownTexture(name);');
    }
    lines.push('            return JS_UNDEFINED;');
  } else if (operation.is) {
    lines.push(
      `            return JS_NewBool(ctx, ${OBJECTS[operation.parameters[0].object].is}(args.u32(0)) == GL_TRUE);`,
    );
  } else {
    const args = operation.parameters
      .map((parameter, index) => {
        if (
          parameter.type === 'GLintptr' &&
          POINTER_OFFSETS.has(operation.name)
        )
          return `offset(args.i64(${index}))`;
        if (parameter.kind === 'scalar')
          return `args.${parameter.cpp}(${index})`;
        if (parameter.kind === 'object') return `args.u32(${index})`;
        return `args.i32(${index})`;
      })
      .join(', ');
    const call = `${glName}(${args})`;
    if (operation.result.kind === 'void') {
      lines.push(`            ${call};`);
      if (DRAWS.has(operation.name)) lines.push('            context.drew();');
      lines.push('            return JS_UNDEFINED;');
    } else if (operation.result.cpp === 'boolean')
      lines.push(`            return JS_NewBool(ctx, ${call} == GL_TRUE);`);
    else if (operation.result.cpp === 'u32')
      lines.push(`            return JS_NewUint32(ctx, ${call});`);
    else if (operation.result.cpp === 'f32')
      lines.push(`            return JS_NewFloat64(ctx, ${call});`);
    else lines.push(`            return JS_NewInt64(ctx, ${call});`);
  }
  lines.push('        }');
  return lines.join('\n');
}

export function generate(sources) {
  const { constants, operations } = parseIdl(sources);
  const generated = generatedOperations(operations);
  const header =
    '// Generated by runtimes/juce-runtime/scripts/webgl-codegen.mjs from the\n// Khronos WebGL IDL (../idl). Do not edit.\n';
  const js = [
    header,
    '/** Every WebGL 1 and 2 constant, by name. */',
    'export const CONSTANTS = Object.freeze({',
    ...constants.map(
      ({ name, value }) =>
        `  ${name}: ${value < 0 ? value : `0x${value.toString(16).toUpperCase().padStart(4, '0')}`},`,
    ),
    '});',
    '',
    '/**',
    ' * The generated methods of WebGL2RenderingContext, given the helpers they',
    ' * convert arguments and call native code with (webgl.js).',
    ' */',
    'export function generatedMethods(gl) {',
    '  return {',
    generated.map((operation, op) => jsMethod(operation, op)).join('\n'),
    '  };',
    '}',
    '',
    `/** The number of generated operations: hand-written ones are numbered after them. */`,
    `export const GENERATED_OPERATIONS = ${generated.length};`,
    '',
  ].join('\n');
  const cpp = [
    header,
    '// The switch cases of the generated operations, for WebGLModule.cpp: `args`',
    '// reads the arguments, `context` is the WebGL context made current.',
    `constexpr int generatedOperations = ${generated.length};`,
    '',
    '// finish() and flush() are the same call.',
    '// NOLINTBEGIN(bugprone-branch-clone)',
    'JSValue callGenerated(JSContext* ctx, WebGLContext& context, int op, const Args& args)',
    '{',
    '    switch (op)',
    '    {',
    generated.map((operation, op) => cppCase(operation, op)).join('\n'),
    '        default:',
    '            throw std::invalid_argument("unknown WebGL operation");',
    '    }',
    '}',
    '// NOLINTEND(bugprone-branch-clone)',
    '',
  ].join('\n');
  const dts = [
    '// Generated by runtimes/juce-runtime/scripts/webgl-codegen.mjs from the',
    '// Khronos WebGL IDL. Do not edit.',
    '',
    '/** The global types of WebGL 2, part of renderGlobalsDts(). */',
    `export const WEBGL_GLOBALS = ${JSON.stringify(generateDts(constants, operations))};`,
    '',
  ].join('\n');
  return { js, cpp, dts, constants, generated };
}

/** IDL types as TypeScript types (of parameters; results use arrays). */
function tsType(type, result = false) {
  const nullable = type.endsWith('?');
  const bare = nullable ? type.slice(0, -1) : type;
  let ts;
  const sequence = /^sequence<(.+)>$/.exec(bare);
  if (sequence)
    ts = result
      ? `${tsType(sequence[1], true)}[]`
      : `Iterable<${tsType(sequence[1])}>`;
  else if (SCALARS[bare])
    ts = SCALARS[bare].js === 'bool' ? 'boolean' : 'number';
  else
    ts =
      {
        'unsigned long long': 'number',
        'unsigned long': 'number',
        long: 'number',
        GLuint64: 'number',
        DOMString: 'string',
        any: 'any',
        object: 'object',
        undefined: 'void',
        Float32List: 'Float32Array | Iterable<number>',
        Int32List: 'Int32Array | Iterable<number>',
        Uint32List: 'Uint32Array | Iterable<number>',
        AllowSharedBufferSource: 'ArrayBuffer | ArrayBufferView',
        ArrayBufferView: 'ArrayBufferView',
        TexImageSource: 'TexImageSource',
      }[bare] ?? bare;
  if (nullable) ts = ts.includes(' ') ? `(${ts}) | null` : `${ts} | null`;
  return ts;
}

/** Written by hand: attributes and what the IDL leaves to other specs. */
const DTS_HEAD = `// ── WebGL 2 ──────────────────────────────────────────────────────────────────
// Canvases' WebGL2RenderingContext (OpenGL ES 3.0 through ANGLE, on the GPU),
// generated from the Khronos IDL by runtimes/juce-runtime/scripts/webgl-codegen.mjs.

/** What texImage2D() and friends take besides arrays: a canvas node, or ImageData. */
type TexImageSource = import('soundor:ui').UiNode | ImageData;

interface WebGLContextAttributes {
  alpha?: boolean;
  depth?: boolean;
  stencil?: boolean;
  antialias?: boolean;
  premultipliedAlpha?: boolean;
  preserveDrawingBuffer?: boolean;
  powerPreference?: 'default' | 'high-performance' | 'low-power';
  failIfMajorPerformanceCaveat?: boolean;
  desynchronized?: boolean;
  xrCompatible?: boolean;
}

interface WebGLObject {}
interface WebGLBuffer extends WebGLObject {}
interface WebGLFramebuffer extends WebGLObject {}
interface WebGLProgram extends WebGLObject {}
interface WebGLRenderbuffer extends WebGLObject {}
interface WebGLShader extends WebGLObject {}
interface WebGLTexture extends WebGLObject {}
interface WebGLQuery extends WebGLObject {}
interface WebGLSampler extends WebGLObject {}
interface WebGLSync extends WebGLObject {}
interface WebGLTransformFeedback extends WebGLObject {}
interface WebGLVertexArrayObject extends WebGLObject {}
interface WebGLUniformLocation {}
interface WebGLActiveInfo {
  readonly size: number;
  readonly type: number;
  readonly name: string;
}
interface WebGLShaderPrecisionFormat {
  readonly rangeMin: number;
  readonly rangeMax: number;
  readonly precision: number;
}
declare var WebGLBuffer: { readonly prototype: WebGLBuffer };
declare var WebGLFramebuffer: { readonly prototype: WebGLFramebuffer };
declare var WebGLProgram: { readonly prototype: WebGLProgram };
declare var WebGLRenderbuffer: { readonly prototype: WebGLRenderbuffer };
declare var WebGLShader: { readonly prototype: WebGLShader };
declare var WebGLTexture: { readonly prototype: WebGLTexture };
declare var WebGLQuery: { readonly prototype: WebGLQuery };
declare var WebGLSampler: { readonly prototype: WebGLSampler };
declare var WebGLSync: { readonly prototype: WebGLSync };
declare var WebGLTransformFeedback: { readonly prototype: WebGLTransformFeedback };
declare var WebGLVertexArrayObject: { readonly prototype: WebGLVertexArrayObject };
declare var WebGLUniformLocation: { readonly prototype: WebGLUniformLocation };
declare var WebGLActiveInfo: { readonly prototype: WebGLActiveInfo };
declare var WebGLShaderPrecisionFormat: { readonly prototype: WebGLShaderPrecisionFormat };
`;

/** The TypeScript declarations of WebGL2RenderingContext. */
export function generateDts(constants, operations) {
  // WebGL 2 has WebGL 1's base, its own base and its own overloads.
  const included = new Set([
    'WebGLRenderingContextBase',
    'WebGL2RenderingContextBase',
    'WebGL2RenderingContextOverloads',
  ]);
  const signatures = [];
  const seen = new Set();
  for (const operation of operations) {
    if (!included.has(operation.interfaceName)) continue;
    const parameters = operation.parameters
      .map(
        (parameter) =>
          `${parameter.name}${parameter.optional ? '?' : ''}: ${tsType(parameter.type)}`,
      )
      .join(', ');
    const signature = `  ${operation.name}(${parameters}): ${tsType(operation.returns, true)};`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    signatures.push(signature);
  }
  const constantLines = constants.map(
    ({ name, value }) => `  readonly ${name}: ${value};`,
  );
  return [
    DTS_HEAD,
    'interface WebGL2RenderingContext {',
    "  readonly canvas: import('soundor:ui').UiNode;",
    '  readonly drawingBufferWidth: number;',
    '  readonly drawingBufferHeight: number;',
    '  readonly drawingBufferFormat: number;',
    "  drawingBufferColorSpace: 'srgb';",
    "  unpackColorSpace: 'srgb';",
    ...constantLines,
    ...signatures,
    '}',
    'declare var WebGL2RenderingContext: {',
    '  readonly prototype: WebGL2RenderingContext;',
    ...constantLines,
    '};',
    '',
  ].join('\n');
}

function main() {
  const sources = ['webgl.idl', 'webgl2.idl'].map((file) =>
    readFileSync(join(webgl, 'idl', file), 'utf8'),
  );
  const { js, cpp, dts } = generate(sources);
  const outputs = [
    [join(webgl, 'generated/webgl-generated.js'), js],
    [join(webgl, 'generated/WebGLGenerated.inc'), cpp],
    [join(coreSource, 'webgl-dts.ts'), dts],
  ];
  if (process.argv.includes('--check')) {
    const stale = outputs.filter(([file, contents]) => {
      try {
        return readFileSync(file, 'utf8') !== contents;
      } catch {
        return true;
      }
    });
    if (stale.length > 0) {
      console.error(
        `Out of date (run node scripts/webgl-codegen.mjs): ${stale.map(([file]) => file).join(', ')}`,
      );
      process.exit(1);
    }
    return;
  }
  for (const [file, contents] of outputs) writeFileSync(file, contents);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
