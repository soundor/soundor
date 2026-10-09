#include "../web/WebTestSupport.h"
#include "GpuTestSupport.h"
#include "gpu/OffscreenCompositor.h"

#include <soundor/platform/Resources.h>
#include <soundor/render/Compositor.h>

#include <chrono>
#include <string>

using namespace soundor;
using test::WebFixture;

// Three.js's WebGLRenderer, from the unmodified npm package (SOUNDOR_THREE_DIR,
// pinned in SoundorDependencies.cmake), on Soundor's WebGL 2.

namespace
{
    RuntimeHost::Options withThree(std::shared_ptr<gpu::Device> device)
    {
        RuntimeHost::Options options;
        options.gpuDevice = std::move(device);
        options.allowSoftwareGpu = true;
        options.resources = std::make_shared<platform::DirectoryResources>(SOUNDOR_THREE_DIR);
        return options;
    }

    // A 64×64 canvas `c` filling the view, `THREE`, a WebGLRenderer
    // `renderer` on it, its context `gl`, a scene and a camera looking at the
    // origin, and:
    //   check(name, fn): runs fn, then records any WebGL error it left
    //   problems: what went wrong (also what Three logged as errors)
    //   px(x, y): the RGBA at (x, y) of the canvas, OpenGL's way up
    struct ThreeFixture : WebFixture
    {
        explicit ThreeFixture(std::shared_ptr<gpu::Device> device) : WebFixture(withThree(std::move(device)))
        {
            host.surface().setSize({ 64, 64 });
            run(R"(
                import * as THREE from '/three.module.js';
                import { root, createCanvas } from 'soundor:ui';
                const g = globalThis;
                g.THREE = THREE;
                g.c = createCanvas({ width: 64, height: 64 });
                root.appendChild(g.c);
                g.c.width = 64;
                g.c.height = 64;
                g.renderer = new THREE.WebGLRenderer({ canvas: g.c, antialias: false });
                // As every app does: Three sizes its own targets (transmission)
                // from it.
                g.renderer.setSize(64, 64, false);
                g.gl = g.renderer.getContext();
                g.scene = new THREE.Scene();
                g.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 50);
                g.camera.position.set(0, 0, 3);
                g.camera.lookAt(0, 0, 0);
                g.problems = [];
                g.check = (name, fn) => {
                    try {
                        fn();
                        const error = g.gl.getError();
                        if (error !== 0) g.problems.push(`${name}: WebGL error ${error}`);
                    } catch (error) {
                        g.problems.push(`${name}: ${error}`);
                    }
                };
                g.px = (x, y) => {
                    const out = new Uint8Array(4);
                    g.gl.readPixels(x, y, 1, 1, g.gl.RGBA, g.gl.UNSIGNED_BYTE, out);
                    return Array.from(out).join(',');
                };
            )");
        }

        std::string string(const std::string& expression) { return eval(expression).asString(); }

        // Nothing went wrong, and Three logged no error or warning.
        void expectClean()
        {
            CHECK_MESSAGE(string("problems.join('; ')").empty(), string("problems.join('; ')"));
            for (const auto& [level, message] : logs)
                CHECK_MESSAGE((level != js::LogLevel::Error && level != js::LogLevel::Warn), message);
        }
    };
} // namespace

TEST_SUITE("Three.js")
{
    TEST_CASE("renders a scene: its background, and a mesh where the camera sees it")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ThreeFixture f(device);
        f.run(R"(
            check('render', () => {
                scene.background = new THREE.Color(0x0000ff);
                scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff0000 })));
                renderer.render(scene, camera);
            });
            globalThis.result = [px(32, 32), px(2, 2)].join(' ');
        )");
        CHECK(f.string("result") == "255,0,0,255 0,0,255,255");
        CHECK(f.string("THREE.REVISION") == "186");
        f.expectClean();
    }

    TEST_CASE("lights, shadows, physical materials, tone mapping and a PMREM environment")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ThreeFixture f(device);
        f.run(R"(
            check('lit scene', () => {
                renderer.shadowMap.enabled = true;
                renderer.toneMapping = THREE.ACESFilmicToneMapping;
                const light = new THREE.DirectionalLight(0xffffff, 3);
                light.position.set(3, 5, 2);
                light.castShadow = true;
                scene.add(light, new THREE.AmbientLight(0x404040), new THREE.HemisphereLight());
                const spot = new THREE.SpotLight(0xffffff, 10);
                spot.castShadow = true;
                scene.add(spot, new THREE.PointLight(0xffffff, 5));
                const knot = new THREE.Mesh(new THREE.TorusKnotGeometry(0.6, 0.2, 64, 8),
                    new THREE.MeshStandardMaterial({ color: 0xff8844, roughness: 0.4, metalness: 0.3 }));
                knot.castShadow = true;
                scene.add(knot);
                const floor = new THREE.Mesh(new THREE.PlaneGeometry(6, 6),
                    new THREE.MeshPhysicalMaterial({ color: 0x888888, clearcoat: 1, sheen: 1, iridescence: 1 }));
                floor.rotation.x = -Math.PI / 2;
                floor.position.y = -1;
                floor.receiveShadow = true;
                scene.add(floor);
                renderer.render(scene, camera);
            });
            check('environment', () => {
                const pmrem = new THREE.PMREMGenerator(renderer);
                const sky = new THREE.Scene();
                sky.background = new THREE.Color(0x336699);
                scene.environment = pmrem.fromScene(sky).texture;
                renderer.render(scene, camera);
                pmrem.dispose();
            });
            globalThis.result = px(32, 32);
        )");
        CHECK(f.string("result") != "0,0,0,0");
        f.expectClean();
    }

    TEST_CASE("render targets: multisampled, half float, float read back, cube, depth")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ThreeFixture f(device);
        f.run(R"(
            scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial()));
            check('multisampled', () => {
                const target = new THREE.WebGLRenderTarget(64, 64, { samples: 4, type: THREE.HalfFloatType });
                renderer.setRenderTarget(target);
                renderer.render(scene, camera);
                renderer.setRenderTarget(null);
            });
            check('float', () => {
                const target = new THREE.WebGLRenderTarget(8, 8, { type: THREE.FloatType });
                renderer.setRenderTarget(target);
                renderer.setClearColor(new THREE.Color(0.25, 0.5, 1.0), 1);
                renderer.clear();
                renderer.setRenderTarget(null);
                const value = new Float32Array(4);
                renderer.readRenderTargetPixels(target, 4, 4, 1, 1, value);
                globalThis.cleared = Array.from(value).map((v) => v.toFixed(2)).join(',');
            });
            check('cube', () => {
                const target = new THREE.WebGLCubeRenderTarget(16, { type: THREE.HalfFloatType });
                new THREE.CubeCamera(0.1, 10, target).update(renderer, scene);
            });
            check('depth', () => {
                const target = new THREE.WebGLRenderTarget(32, 32);
                target.depthTexture = new THREE.DepthTexture(32, 32);
                renderer.setRenderTarget(target);
                renderer.render(scene, camera);
                renderer.setRenderTarget(null);
                renderer.copyFramebufferToTexture(new THREE.FramebufferTexture(16, 16), new THREE.Vector2(0, 0));
            });
        )");
        // The clear color, in linear space as given.
        CHECK_MESSAGE(f.string("cleared").starts_with("0.25,0.50,1.00,1.00"), f.string("cleared"));
        f.expectClean();
    }

    TEST_CASE("geometry: instancing, morph targets, skinning, points, lines, sprites, transmission")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ThreeFixture f(device);
        f.run(R"(
            scene.add(new THREE.DirectionalLight());
            check('instancing', () => {
                const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshLambertMaterial(), 100);
                const matrix = new THREE.Matrix4();
                for (let i = 0; i < 100; i++) {
                    matrix.setPosition((i % 10) * 0.2 - 1, 1, Math.floor(i / 10) * 0.2 - 1);
                    boxes.setMatrixAt(i, matrix);
                    boxes.setColorAt(i, new THREE.Color(i / 100, 0.5, 0.5));
                }
                scene.add(boxes);
                renderer.render(scene, camera);
            });
            check('morph targets', () => {
                const geometry = new THREE.BoxGeometry(0.5, 0.5, 0.5, 2, 2, 2);
                geometry.morphAttributes.position = [geometry.attributes.position.clone()];
                const morph = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
                morph.morphTargetInfluences = [0.5];
                scene.add(morph);
                renderer.render(scene, camera);
            });
            check('skinning', () => {
                const bones = [new THREE.Bone(), new THREE.Bone()];
                bones[0].add(bones[1]);
                const geometry = new THREE.CylinderGeometry(0.1, 0.1, 1, 8, 4);
                const count = geometry.attributes.position.count;
                geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(count * 4).fill(0).map((_, i) => (i % 4 === 1 ? 1 : 0)), 4));
                geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(count * 4).fill(0).map((_, i) => (i % 4 < 2 ? 0.5 : 0)), 4));
                const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshStandardMaterial());
                mesh.add(bones[0]);
                mesh.bind(new THREE.Skeleton(bones));
                scene.add(mesh);
                renderer.render(scene, camera);
            });
            check('points, lines, sprites', () => {
                const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 1, 1)]);
                scene.add(new THREE.Points(geometry, new THREE.PointsMaterial({ size: 4 })));
                const line = new THREE.Line(geometry, new THREE.LineDashedMaterial());
                line.computeLineDistances();
                scene.add(line, new THREE.Sprite(new THREE.SpriteMaterial()));
                renderer.render(scene, camera);
            });
            check('transmission', () => {
                scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.3), new THREE.MeshPhysicalMaterial({ transmission: 1, thickness: 0.5 })));
                renderer.render(scene, camera);
            });
        )");
        f.expectClean();
    }

    TEST_CASE("textures: a canvas node, data, array and 3D textures")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ThreeFixture f(device);
        f.run(R"(
            import { createCanvas } from 'soundor:ui';
            check('textures', () => {
                const source = createCanvas({ width: 16, height: 16 });
                source.width = 16;
                source.height = 16;
                const ctx = source.getContext('2d');
                ctx.fillStyle = '#00ff00';
                ctx.fillRect(0, 0, 16, 16);
                const quad = new THREE.Mesh(new THREE.PlaneGeometry(4, 4),
                    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(source) }));
                scene.add(quad);
                const data = new THREE.DataTexture(new Uint8Array(4 * 4 * 4).fill(200), 4, 4);
                data.needsUpdate = true;
                const layers = new THREE.DataArrayTexture(new Uint8Array(4 * 4 * 4 * 2).fill(100), 4, 4, 2);
                layers.needsUpdate = true;
                const volume = new THREE.Data3DTexture(new Uint8Array(4 * 4 * 4 * 4).fill(50), 4, 4, 4);
                volume.needsUpdate = true;
                renderer.initTexture(data);
                renderer.initTexture(layers);
                renderer.initTexture(volume);
                renderer.render(scene, camera);
            });
            globalThis.result = px(32, 32);
        )");
        CHECK(f.string("result") == "0,255,0,255");
        f.expectClean();
    }

    TEST_CASE("shader materials: GLSL 3 with a uniform block, clipping planes, a logarithmic depth buffer")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ThreeFixture f(device);
        f.run(R"(
            import { createCanvas } from 'soundor:ui';
            check('uniform block', () => {
                const group = new THREE.UniformsGroup();
                group.setName('Data');
                group.add(new THREE.Uniform(new THREE.Vector4(1, 0, 1, 1)));
                const material = new THREE.ShaderMaterial({
                    glslVersion: THREE.GLSL3,
                    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
                    fragmentShader: 'layout(std140) uniform Data { vec4 tint; }; out vec4 color; void main() { color = tint; }',
                });
                material.uniformsGroups = [group];
                scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), material));
                renderer.render(scene, camera);
            });
            globalThis.result = px(32, 32);
            check('clipping', () => {
                renderer.localClippingEnabled = true;
                scene.add(new THREE.Mesh(new THREE.SphereGeometry(0.2),
                    new THREE.MeshStandardMaterial({ clippingPlanes: [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)] })));
                renderer.render(scene, camera);
            });
            check('logarithmic depth', () => {
                const other = createCanvas({ width: 8, height: 8 });
                const logarithmic = new THREE.WebGLRenderer({ canvas: other, logarithmicDepthBuffer: true });
                logarithmic.render(scene, camera);
                logarithmic.dispose();
            });
        )");
        CHECK(f.string("result") == "255,0,255,255");
        f.expectClean();
    }

    TEST_CASE("the renderer's API: sizes, the animation loop, asynchronous compiling and reading")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ThreeFixture f(device);
        f.run(R"(
            scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
            check('sizes', () => {
                renderer.setPixelRatio(2);
                // Also sets the canvas's style, as on the Web.
                renderer.setSize(32, 16);
                globalThis.sized = [c.width, c.height, c.style.width, c.style.height].join(',');
                renderer.render(scene, camera);
            });
            globalThis.frames = 0;
            renderer.setAnimationLoop(() => {
                renderer.render(scene, camera);
                if (++globalThis.frames === 3) renderer.setAnimationLoop(null);
            });
            renderer.compileAsync(scene, camera).then(() => { globalThis.compiled = true; },
                                                      (error) => { problems.push(`compileAsync: ${error}`); });
            const target = new THREE.WebGLRenderTarget(8, 8);
            renderer.setRenderTarget(target);
            renderer.setClearColor(0xff0000, 1);
            renderer.clear();
            renderer.setRenderTarget(null);
            renderer.readRenderTargetPixelsAsync(target, 0, 0, 1, 1, new Uint8Array(4))
                .then((pixel) => { globalThis.read = Array.from(pixel).join(','); },
                      (error) => { problems.push(`readRenderTargetPixelsAsync: ${error}`); });
        )");
        CHECK(f.string("sized") == "64,32,32,16");
        CHECK(f.tickUntil("frames === 3 && globalThis.compiled === true && globalThis.read !== undefined",
                          std::chrono::seconds(10)));
        CHECK(f.string("read") == "255,0,0,255");
        f.run("check('dispose', () => renderer.dispose());");
        f.expectClean();
    }

    TEST_CASE("an animated scene is composited without copies")
    {
        const auto device = test::testDevice();
        if (device == nullptr)
            return;
        ThreeFixture f(device);
        gpu::OffscreenCompositor compositor(device);
        f.run(R"(
            const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshNormalMaterial());
            scene.add(cube);
            renderer.setAnimationLoop((time) => {
                cube.rotation.y = time / 1000;
                renderer.render(scene, camera);
            });
        )");
        int readbacks = 0;
        int rasterized = 0;
        for (int i = 0; i < 5; ++i)
        {
            f.host.tick();
            const render::Frame& frame = f.host.frame(compositor.capabilities());
            readbacks += frame.statistics.gpuReadbacks;
            if (i > 0)
                rasterized += frame.statistics.layersRasterized;
            compositor.composite(frame);
        }
        CHECK(readbacks == 0);
        CHECK(rasterized == 0);
        f.run("renderer.setAnimationLoop(null);");
        f.expectClean();
    }
}
