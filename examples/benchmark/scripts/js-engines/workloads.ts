// CPU work from src/scenarios/three.tsx; no renderer, canvas or Soundor API.
import {
  BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  BoxGeometry,
  MeshBasicMaterial,
  Scene,
} from 'three';

declare const print: (message: string) => void;
declare const benchOptions: {
  scenario: string;
  frames: number;
  warmup: number;
};

interface Workload {
  update(time: number): void;
  checksum(): number[];
}

function particles(): Workload {
  const count = 200_000;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  let state = 42;
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    seeds[i] = (state / 4294967296) * 100;
  }
  const attribute = new BufferAttribute(positions, 3);
  return {
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
    checksum: () => sums(positions).concat(attribute.version),
  };
}

function instanced(): Workload {
  const count = 50_000;
  const boxes = new InstancedMesh(
    new BoxGeometry(0.05, 0.05, 0.05),
    new MeshBasicMaterial(),
    count,
  );
  const matrix = new Matrix4();
  return {
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
    checksum: () =>
      sums(boxes.instanceMatrix.array).concat(boxes.instanceMatrix.version),
  };
}

function meshes(worldMatrices: boolean): Workload {
  const scene = new Scene();
  const group = new Group();
  const geometry = new BoxGeometry(0.3, 0.3, 0.3);
  const material = new MeshBasicMaterial();
  for (let i = 0; i < 2000; i++) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(
      ((i % 20) - 9.5) * 0.5,
      ((Math.floor(i / 20) % 10) - 4.5) * 0.5,
      -Math.floor(i / 200) * 0.6,
    );
    group.add(mesh);
  }
  scene.add(group);
  return {
    update(time) {
      group.rotation.y = Math.sin(time * 0.5) * 0.4;
      for (const child of group.children) child.rotation.x = time;
      if (worldMatrices) scene.updateMatrixWorld();
    },
    checksum() {
      const values: number[] = [];
      for (const child of group.children) {
        values.push(
          child.quaternion.x,
          child.quaternion.y,
          child.quaternion.z,
          child.quaternion.w,
        );
        if (worldMatrices) values.push(...child.matrixWorld.elements);
      }
      return sums(values).concat(group.quaternion.y);
    },
  };
}

// Read every output element outside the timed loop; the aggregates compare
// the complete buffers rather than just a few sampled points.
function sums(values: ArrayLike<number>): number[] {
  let sum = 0;
  let weighted = 0;
  let squared = 0;
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    sum += value;
    weighted += value * ((i % 97) + 1);
    squared += value * value;
  }
  return [sum, weighted, squared];
}

const factories: Record<string, () => Workload> = {
  particles,
  instanced,
  meshes: () => meshes(false),
  'scene-matrices': () => meshes(true),
};
const create = factories[benchOptions.scenario];
if (!create) throw new Error(`Unknown scenario: ${benchOptions.scenario}`);
const setupStart = Date.now();
const workload = create();
const setupMs = Date.now() - setupStart;
for (let frame = 0; frame < benchOptions.warmup; frame++)
  workload.update(frame / 60);
const start = Date.now();
for (let frame = 0; frame < benchOptions.frames; frame++)
  workload.update((frame + benchOptions.warmup) / 60);
const elapsedMs = Date.now() - start;
print(
  JSON.stringify({
    scenario: benchOptions.scenario,
    frames: benchOptions.frames,
    elapsedMs,
    setupMs,
    checksum: workload.checksum(),
  }),
);
