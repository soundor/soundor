// Three.js scenarios: plain Three.js, the same in both runtimes.
//
// webgl-stress: each stresses one thing a real plugin UI might, on purpose
// the expensive way: draw calls, per-frame buffer uploads written by
// JavaScript, lighting and shadows, many vertices moved by JavaScript, render
// targets.
// webgl: the same visuals as two of them, drawn the way a plugin should: the
// vertex shader moves everything from a time uniform, and JavaScript only
// sets that uniform.

import { Canvas } from '@soundor/react';
import { useEffect, useRef } from 'react';
import type { UiNode } from 'soundor:ui';
import * as THREE from 'three';

import {
  STAGE_HEIGHT,
  STAGE_WIDTH,
  type Group,
  type Scenario,
  type StageProps,
} from './types';

export interface BenchScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Moves things for the frame at `time` (seconds). */
  update(time: number): void;
  /** Draws a frame; most scenes just render, post-processing renders twice. */
  render?(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
}

type CreateScene = (renderer: THREE.WebGLRenderer) => BenchScene;

function camera(z: number): THREE.PerspectiveCamera {
  const result = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  result.position.set(0, 0, z);
  return result;
}

function disposeAll(scene: THREE.Scene): void {
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as
      | THREE.Material
      | THREE.Material[]
      | undefined;
    if (Array.isArray(material)) material.forEach((each) => each.dispose());
    else material?.dispose();
  });
}

/** 2,000 separate meshes: one draw call each. */
function meshes(): BenchScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x15171c);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2));
  const geometry = new THREE.BoxGeometry(0.3, 0.3, 0.3);
  const group = new THREE.Group();
  for (let i = 0; i < 2000; i++) {
    const material = new THREE.MeshLambertMaterial({
      color: new THREE.Color().setHSL(i / 2000, 0.6, 0.55),
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(
      ((i % 20) - 9.5) * 0.5,
      ((Math.floor(i / 20) % 10) - 4.5) * 0.5,
      -Math.floor(i / 200) * 0.6,
    );
    group.add(mesh);
  }
  scene.add(group);
  const view = camera(9);
  return {
    scene,
    camera: view,
    update(time) {
      group.rotation.y = Math.sin(time * 0.5) * 0.4;
      for (const child of group.children) child.rotation.x = time;
    },
    dispose: () => disposeAll(scene),
  };
}

/** 50,000 instances whose matrices change every frame: buffer uploads. */
function instanced(): BenchScene {
  const count = 50_000;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);
  scene.add(
    new THREE.DirectionalLight(0xffffff, 2),
    new THREE.AmbientLight(0x404050),
  );
  const boxes = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.05, 0.05, 0.05),
    new THREE.MeshStandardMaterial({ roughness: 0.5 }),
    count,
  );
  const color = new THREE.Color();
  for (let i = 0; i < count; i++)
    boxes.setColorAt(i, color.setHSL(i / count, 0.7, 0.5));
  scene.add(boxes);
  const matrix = new THREE.Matrix4();
  return {
    scene,
    camera: camera(5),
    update(time) {
      for (let i = 0; i < count; i++) {
        const a = i * 0.0013 + time * 0.3;
        const r = 0.5 + (i / count) * 2;
        matrix.makeRotationY(a);
        matrix.setPosition(
          Math.cos(a * 3) * r,
          Math.sin(i * 0.37 + time) * 1.2,
          Math.sin(a * 3) * r,
        );
        boxes.setMatrixAt(i, matrix);
      }
      boxes.instanceMatrix.needsUpdate = true;
    },
    dispose: () => disposeAll(scene),
  };
}

/** Physical materials, shadows from two lights and an environment. */
function lit(renderer: THREE.WebGLRenderer): BenchScene {
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const sky = new THREE.Scene();
  sky.background = new THREE.Color(0x5577aa);
  const environment = pmrem.fromScene(sky);
  pmrem.dispose();
  scene.environment = environment.texture;
  scene.background = new THREE.Color(0x202530);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(3, 6, 4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  const spot = new THREE.SpotLight(0xffaa66, 40, 20, 0.6, 0.4);
  spot.position.set(-4, 5, 2);
  spot.castShadow = true;
  scene.add(sun, spot);
  const knots: THREE.Mesh[] = [];
  for (let i = 0; i < 9; i++) {
    const knot = new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.4, 0.13, 160, 24),
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color().setHSL(i / 9, 0.6, 0.5),
        roughness: 0.25,
        metalness: i % 2,
        clearcoat: 1,
      }),
    );
    knot.position.set(((i % 3) - 1) * 1.4, 0, (Math.floor(i / 3) - 1) * 1.4);
    knot.castShadow = true;
    knot.receiveShadow = true;
    knots.push(knot);
    scene.add(knot);
  }
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.7;
  floor.receiveShadow = true;
  scene.add(floor);
  const view = camera(5);
  view.position.set(0, 2.5, 5);
  view.lookAt(0, 0, 0);
  return {
    scene,
    camera: view,
    update(time) {
      knots.forEach((knot, i) => (knot.rotation.y = time + i));
    },
    dispose() {
      environment.dispose();
      disposeAll(scene);
    },
  };
}

/** 200,000 points moved on the CPU every frame. */
function particles(): BenchScene {
  const count = 200_000;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = Math.random() * 100;
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3).setUsage(
    THREE.DynamicDrawUsage,
  );
  geometry.setAttribute('position', attribute);
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({
      size: 0.02,
      color: 0x88ccff,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    }),
  );
  scene.add(points);
  return {
    scene,
    camera: camera(4),
    update(time) {
      for (let i = 0; i < count; i++) {
        const s = seeds[i]!;
        const r = 0.3 + (s % 1.7);
        positions[i * 3] = Math.cos(s + time * 0.4) * r;
        positions[i * 3 + 1] = Math.sin(s * 1.3 + time * 0.7) * 0.8;
        positions[i * 3 + 2] = Math.sin(s + time * 0.4) * r;
      }
      attribute.needsUpdate = true;
    },
    dispose: () => disposeAll(scene),
  };
}

/** A multisampled half-float render target, then a full-screen pass. */
function postprocessed(renderer: THREE.WebGLRenderer): BenchScene {
  const inner = meshes();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, {
    samples: 4,
    type: THREE.HalfFloatType,
  });
  const pass = new THREE.ShaderMaterial({
    uniforms: { image: { value: target.texture }, time: { value: 0 } },
    vertexShader:
      'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `
      uniform sampler2D image;
      uniform float time;
      varying vec2 vUv;
      void main() {
        vec2 offset = (vUv - 0.5) * 0.004;
        vec3 color = vec3(texture2D(image, vUv + offset).r, texture2D(image, vUv).g, texture2D(image, vUv - offset).b);
        float vignette = smoothstep(0.9, 0.3, length(vUv - 0.5));
        gl_FragColor = vec4(color * vignette * (0.9 + 0.1 * sin(time)), 1.0);
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), pass);
  const screen = new THREE.Scene();
  screen.add(quad);
  const flat = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  return {
    scene: inner.scene,
    camera: inner.camera,
    update(time) {
      inner.update(time);
      pass.uniforms.time!.value = time;
    },
    render(r) {
      const drawing = r.getDrawingBufferSize(new THREE.Vector2());
      if (drawing.x !== target.width || drawing.y !== target.height)
        target.setSize(drawing.x, drawing.y);
      r.setRenderTarget(target);
      r.render(inner.scene, inner.camera);
      r.setRenderTarget(null);
      r.render(screen, flat);
    },
    dispose() {
      inner.dispose();
      target.dispose();
      disposeAll(screen);
    },
  };
}

/** The particles of particles(), moved by the vertex shader. */
function gpuParticles(renderer: THREE.WebGLRenderer): BenchScene {
  const count = 200_000;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05060a);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) seeds[i] = Math.random() * 100;
  const geometry = new THREE.BufferGeometry();
  // Three draws as many points as the position attribute has; the shader
  // ignores the values.
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(count * 3), 3),
  );
  geometry.setAttribute('seed', new THREE.BufferAttribute(seeds, 1));
  const material = new THREE.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      // PointsMaterial's size attenuation: half the drawing buffer's height.
      scale: {
        value: renderer.getDrawingBufferSize(new THREE.Vector2()).y / 2,
      },
    },
    vertexShader: `
      attribute float seed;
      uniform float time;
      uniform float scale;
      void main() {
        float r = 0.3 + mod(seed, 1.7);
        vec3 p = vec3(cos(seed + time * 0.4) * r, sin(seed * 1.3 + time * 0.7) * 0.8, sin(seed + time * 0.4) * r);
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = 0.02 * scale / -view.z;
        gl_Position = projectionMatrix * view;
      }`,
    fragmentShader: `
      void main() { gl_FragColor = vec4(0.53, 0.8, 1.0, 0.7); }`,
    transparent: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  return {
    scene,
    camera: camera(4),
    update(time) {
      material.uniforms.time!.value = time;
    },
    dispose: () => disposeAll(scene),
  };
}

/** The instances of instanced(), placed by the vertex shader. */
function gpuInstanced(): BenchScene {
  const count = 50_000;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101820);
  const box = new THREE.BoxGeometry(0.05, 0.05, 0.05);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.index = box.index;
  geometry.setAttribute('position', box.getAttribute('position'));
  geometry.setAttribute('normal', box.getAttribute('normal'));
  const instances = new Float32Array(count);
  const tints = new Float32Array(count * 3);
  const color = new THREE.Color();
  for (let i = 0; i < count; i++) {
    instances[i] = i;
    color.setHSL(i / count, 0.7, 0.5).toArray(tints, i * 3);
  }
  geometry.setAttribute(
    'instance',
    new THREE.InstancedBufferAttribute(instances, 1),
  );
  geometry.setAttribute('tint', new THREE.InstancedBufferAttribute(tints, 3));
  geometry.instanceCount = count;
  const material = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, count: { value: count } },
    vertexShader: `
      attribute float instance;
      attribute vec3 tint;
      uniform float time;
      uniform float count;
      varying vec3 vColor;
      varying vec3 vNormal;
      void main() {
        float a = instance * 0.0013 + time * 0.3;
        float r = 0.5 + (instance / count) * 2.0;
        float c = cos(a);
        float s = sin(a);
        mat3 rotation = mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c);
        vec3 offset = vec3(cos(a * 3.0) * r, sin(instance * 0.37 + time) * 1.2, sin(a * 3.0) * r);
        vNormal = normalize(normalMatrix * (rotation * normal));
        vColor = tint;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(rotation * position + offset, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vColor;
      varying vec3 vNormal;
      void main() {
        float light = 0.35 + 0.65 * max(dot(normalize(vNormal), normalize(vec3(0.3, 0.8, 0.5))), 0.0);
        gl_FragColor = vec4(vColor * light, 1.0);
      }`,
  });
  const boxes = new THREE.Mesh(geometry, material);
  boxes.frustumCulled = false;
  scene.add(boxes);
  return {
    scene,
    camera: camera(5),
    update(time) {
      material.uniforms.time!.value = time;
    },
    dispose() {
      box.dispose();
      disposeAll(scene);
    },
  };
}

const SCENES = new Map<string, CreateScene>([
  ['meshes', meshes],
  ['instanced', instanced],
  ['lit', lit],
  ['particles', particles],
  ['post', postprocessed],
  ['gpu-particles', gpuParticles],
  ['gpu-instanced', gpuInstanced],
]);

/**
 * One WebGLRenderer on one canvas for every Three.js scenario (they share
 * the stage key): switching scenarios swaps the scene, not the context.
 */
function ThreeStage({ scenario, register }: StageProps) {
  const canvas = useRef<UiNode>(null);
  const renderer = useRef<THREE.WebGLRenderer | null>(null);
  const scale = Math.max(1, Math.round(devicePixelRatio));

  useEffect(() => {
    const node = canvas.current;
    if (node === null || node.getContext('webgl2') === null) return;
    // A Soundor canvas node stands where Three expects an HTML canvas.
    const created = new THREE.WebGLRenderer({
      canvas: node as unknown as HTMLCanvasElement,
      antialias: true,
    });
    created.setPixelRatio(scale);
    created.setSize(STAGE_WIDTH, STAGE_HEIGHT, false);
    created.shadowMap.enabled = true;
    // Counted per frame (post-processing renders twice), not per render().
    created.info.autoReset = false;
    renderer.current = created;
    return () => {
      created.dispose();
      renderer.current = null;
    };
  }, [scale]);

  useEffect(() => {
    const three = renderer.current;
    const create = SCENES.get(scenario.id);
    if (three === null || create === undefined) return;
    const scene = create(three);
    scene.camera.aspect = STAGE_WIDTH / STAGE_HEIGHT;
    scene.camera.updateProjectionMatrix();
    register((time) => {
      three.info.reset();
      const begin = performance.now();
      scene.update(time);
      const update = performance.now() - begin;
      if (scene.render) scene.render(three);
      else three.render(scene.scene, scene.camera);
      return {
        update,
        drawCalls: three.info.render.calls,
        triangles: three.info.render.triangles,
      };
    });
    return () => scene.dispose();
  }, [scenario, register, scale]);

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

function three(
  id: string,
  group: Group,
  label: string,
  stresses: string,
): Scenario {
  return { id, group, label, stresses, Stage: ThreeStage, stageKey: 'three' };
}

export const THREE_SCENARIOS: readonly Scenario[] = [
  three('meshes', 'webgl-stress', 'Meshes', '2,000 draw calls'),
  three(
    'instanced',
    'webgl-stress',
    'Instanced',
    '50,000 instance matrices written by JS per frame',
  ),
  three(
    'lit',
    'webgl-stress',
    'Lit',
    'physical materials, 2 shadow maps, environment',
  ),
  three(
    'particles',
    'webgl-stress',
    'Particles',
    '200,000 points moved by JS per frame',
  ),
  three(
    'post',
    'webgl-stress',
    'Post',
    'MSAA half-float target + full-screen pass',
  ),
  three(
    'gpu-particles',
    'webgl',
    'GPU particles',
    'Particles, moved by the vertex shader',
  ),
  three(
    'gpu-instanced',
    'webgl',
    'GPU instanced',
    'Instanced, placed by the vertex shader',
  ),
];
