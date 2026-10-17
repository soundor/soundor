import type { UiNode } from 'soundor:ui';

export interface FieldState {
  times: readonly number[];
  levels: readonly number[];
  feedback: number;
  motion: number;
  hold: boolean;
  bypass: boolean;
  playing: boolean;
}

const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main() { uv = position * .5 + .5; gl_Position = vec4(position, 0., 1.); }`;

// A parameter map, not an audio analyser. Each colored ridge belongs to one tap.
const fragment = `#version 300 es
precision highp float;
in vec2 uv;
out vec4 color;
uniform vec2 size;
uniform vec3 taps, levels;
uniform float clock, feedback, motion, held, bypass;
float line(float d, float width) { return 1. - smoothstep(width, width * 2., abs(d)); }
void main() {
  vec2 p = vec2(uv.x * 752., (1. - uv.y) * 244.);
  vec3 c = vec3(.055, .064, .085);
  c += vec3(.035, .026, .065) * exp(-length((p - vec2(340., 60.)) / vec2(380., 190.)));
  float grid = max(line(mod(p.x - 46. + 82.5, 82.5), .35), line(mod(p.y - 18. + 40., 40.), .35));
  c += grid * .027;
  float baseline = 202.;
  c += vec3(.075) * line(p.y - baseline, .45);
  vec3 palette[3] = vec3[3](vec3(.753,.647,1.),vec3(.737,.914,.467),vec3(.953,.647,.557));
  for (int i = 0; i < 3; i++) {
    float center = 46. + taps[i] / 3. * 660.;
    float amplitude = levels[i] * 133.;
    float envelope = exp(-pow((p.x - center) / (60. + feedback * 55.), 2.));
    float oscillation = .68 + .32 * cos((p.x - center) * .085 + sin(clock * .7 + float(i)) * motion * 2.);
    float ridge = baseline - envelope * amplitude * oscillation;
    vec3 ink = palette[i];
    float stroke = line(p.y - ridge, .6);
    float glow = exp(-abs(p.y - ridge) / 5.) * .13 * envelope;
    float fill = step(ridge, p.y) * step(p.y, baseline) * envelope * .042;
    c += ink * (stroke * .6 * max(.06, envelope) + glow + fill);
    // Fainter returns make feedback legible without inventing a live waveform.
    for (int j = 1; j < 4; j++) {
      float returnX = center + float(j) * 76.;
      float e = exp(-pow((p.x - returnX) / 24., 2.));
      float y = baseline - e * amplitude * pow(feedback, float(j)) * .55;
      c += ink * line(p.y - y, .45) * pow(feedback, float(j)) * e * .15;
    }
  }
  c += vec3(.1,.07,.16) * held;
  float grain = fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453);
  c += (grain - .5) * .014;
  c *= 1. - bypass * .55;
  color = vec4(c, 1.);
}`;

export interface FieldRenderer {
  draw(state: FieldState, seconds: number): void;
  dispose(): void;
}

export function createFieldRenderer(
  canvas: UiNode,
  force2d = false,
): FieldRenderer {
  const gl = force2d
    ? null
    : canvas.getContext('webgl2', { alpha: false, antialias: false });
  if (!gl) return fallback(canvas);
  const shaders: WebGLShader[] = [];
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const vao = gl.createVertexArray();
  const dispose = () => {
    shaders.forEach((shader) => gl.deleteShader(shader));
    gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
  };
  try {
    if (!program || !buffer || !vao)
      throw new Error('Could not allocate the echo display');
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment],
    ] as const) {
      const shader = gl.createShader(type);
      if (!shader) throw new Error('Could not allocate an echo shader');
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(shader) ?? 'Echo shader failed');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? 'Echo program failed');
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const uniform = Object.fromEntries(
      [
        'size',
        'taps',
        'levels',
        'clock',
        'feedback',
        'motion',
        'held',
        'bypass',
      ].map((name) => [name, gl.getUniformLocation(program, name)]),
    );
    return {
      draw(state, seconds) {
        gl.viewport(0, 0, canvas.width, canvas.height);
        gl.useProgram(program);
        gl.bindVertexArray(vao);
        gl.uniform2f(uniform.size!, canvas.width, canvas.height);
        gl.uniform3f(
          uniform.taps!,
          state.times[0]!,
          state.times[1]!,
          state.times[2]!,
        );
        gl.uniform3f(
          uniform.levels!,
          state.levels[0]!,
          state.levels[1]!,
          state.levels[2]!,
        );
        gl.uniform1f(uniform.clock!, state.playing ? seconds : 0);
        gl.uniform1f(uniform.feedback!, state.feedback);
        gl.uniform1f(uniform.motion!, state.motion);
        gl.uniform1f(uniform.held!, Number(state.hold));
        gl.uniform1f(uniform.bypass!, Number(state.bypass));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    // A separate canvas can take a 2D context after this WebGL one fails.
    throw error;
  }
}

function fallback(canvas: UiNode): FieldRenderer {
  const ctx = canvas.getContext('2d');
  return {
    draw(state, seconds) {
      if (!ctx) return;
      ctx.setTransform(canvas.width / 752, 0, 0, canvas.height / 244, 0, 0);
      ctx.fillStyle = '#10121a';
      ctx.fillRect(0, 0, 752, 244);
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#232630';
      for (let x = 46; x < 752; x += 82.5) {
        ctx.beginPath();
        ctx.moveTo(x, 38);
        ctx.lineTo(x, 202);
        ctx.stroke();
      }
      for (let y = 42; y <= 202; y += 40) {
        ctx.beginPath();
        ctx.moveTo(24, y);
        ctx.lineTo(728, y);
        ctx.stroke();
      }
      ['#c0a5ff', '#bce977', '#f3a58e'].forEach((color, i) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let x = 24; x <= 728; x += 2) {
          const center = 46 + (state.times[i]! / 3) * 660;
          const envelope = Math.exp(
            -(((x - center) / (60 + state.feedback * 55)) ** 2),
          );
          const y =
            202 -
            envelope *
              state.levels[i]! *
              133 *
              (0.68 +
                0.32 *
                  Math.cos(
                    (x - center) * 0.085 +
                      Math.sin((state.playing ? seconds : 0) * 0.7 + i) *
                        state.motion *
                        2,
                  ));
          if (x === 24) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });
    },
    dispose() {},
  };
}
