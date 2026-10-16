// Raw WebGL 2, no Three.js: the calls Three makes for each of Meshes' 2,000
// objects (a matrix, a color, a draw), and nothing else. The frame's
// JavaScript time minus the native calls' time (soundor_run_ui) is what the
// WebGL wrappers cost per call.

import { Canvas } from '@soundor/react';
import { useEffect, useRef } from 'react';
import type { UiNode } from 'soundor:ui';

import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Scenario,
  type StageProps,
} from './types';

const OBJECTS = 2000;

const VERTEX = `#version 300 es
in vec2 position;
uniform mat4 transform;
void main() { gl_Position = transform * vec4(position, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision mediump float;
uniform vec4 color;
out vec4 fragment;
void main() { fragment = color; }`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
  }
  return shader;
}

function WebGLCallsStage({ scenario, register }: StageProps) {
  const canvas = useRef<UiNode>(null);
  const scale = Math.max(1, Math.round(devicePixelRatio));

  useEffect(() => {
    const gl = canvas.current?.getContext('webgl2');
    if (!gl) return;
    const program = gl.createProgram()!;
    const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
    const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    const transform = gl.getUniformLocation(program, 'transform');
    const color = gl.getUniformLocation(program, 'color');
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const size = 0.012;
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([
        -size,
        -size,
        size,
        -size,
        size,
        size,
        -size,
        -size,
        size,
        size,
        -size,
        size,
      ]),
      gl.STATIC_DRAW,
    );
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const matrix = new Float32Array(16);
    matrix[0] = matrix[5] = matrix[10] = matrix[15] = 1;

    register((time) => {
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0.08, 0.09, 0.11, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindVertexArray(vao);
      for (let i = 0; i < OBJECTS; i++) {
        const column = i % 50;
        const row = Math.floor(i / 50);
        matrix[12] = (column / 49) * 1.8 - 0.9 + Math.sin(time + i) * 0.01;
        matrix[13] = (row / 39) * 1.8 - 0.9;
        gl.uniformMatrix4fv(transform, false, matrix);
        gl.uniform4f(color, column / 50, row / 40, 0.6, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 6);
      }
      return { drawCalls: OBJECTS };
    });
    return () => {
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
      gl.deleteShader(vertex);
      gl.deleteShader(fragment);
    };
  }, [register]);

  return (
    <Canvas
      ref={canvas}
      width={STAGE_WIDTH * scale}
      height={STAGE_HEIGHT * scale}
      style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, borderRadius: 8 }}
      accessibilityLabel={`The ${scenario.label} scenario`}
    />
  );
}

export const WEBGL_SCENARIOS: readonly Scenario[] = [
  {
    id: 'webgl-calls',
    group: 'webgl',
    label: 'WebGL calls',
    stresses: `${OBJECTS * 3} WebGL calls per frame, no Three.js`,
    Stage: WebGLCallsStage,
  },
];
