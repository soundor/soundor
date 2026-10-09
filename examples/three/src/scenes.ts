// The benchmark's scenes: plain Three.js, the same in both runtimes. Each
// stresses one thing a real plugin UI might: draw calls, per-frame buffer
// uploads, lighting and shadows, many vertices, render targets.

import * as THREE from 'three';

export interface BenchScene {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  /** Moves things for the frame at `time` (seconds). */
  update(time: number): void;
  /** Draws a frame; most scenes just render, post-processing renders twice. */
  render?(renderer: THREE.WebGLRenderer): void;
  dispose(): void;
}

export interface SceneEntry {
  readonly id: string;
  readonly label: string;
  /** What the scene measures. */
  readonly stresses: string;
  create(renderer: THREE.WebGLRenderer): BenchScene;
}

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

export const SCENES: readonly SceneEntry[] = [
  {
    id: 'meshes',
    label: 'Meshes',
    stresses: '2,000 draw calls',
    create: meshes,
  },
  {
    id: 'instanced',
    label: 'Instanced',
    stresses: '50,000 instances updated per frame',
    create: instanced,
  },
  {
    id: 'lit',
    label: 'Lit',
    stresses: 'physical materials, 2 shadow maps, environment',
    create: lit,
  },
  {
    id: 'particles',
    label: 'Particles',
    stresses: '200,000 points updated per frame',
    create: particles,
  },
  {
    id: 'post',
    label: 'Post',
    stresses: 'MSAA half-float target + full-screen pass',
    create: postprocessed,
  },
];
