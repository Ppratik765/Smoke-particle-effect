import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from "postprocessing";

export default function FlameCanvas() {
  const mountRef = useRef();
  const mouse = useRef({ x: 0.5, y: 0.5, z: 1.0 });

  useEffect(() => {
    // ======================
    // Renderer
    // ======================
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      powerPreference: "high-performance",
      antialias: false,
      depth: false,
      stencil: false,
    });

    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mountRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // ======================
    // Render Targets
    // ======================
    const simRes = 256;
    const createRT = () =>
      new THREE.WebGLRenderTarget(simRes, simRes, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

    let targetA = createRT();
    let targetB = createRT();

    // ======================
    // Simulation Shader
    // R = heat
    // G = smoke
    // ======================
    const simMat = new THREE.ShaderMaterial({
      uniforms: {
        prev: { value: targetA.texture },
        mouse: { value: new THREE.Vector3() },
        resolution: { value: new THREE.Vector2(simRes, simRes) },
        aspect: { value: window.innerWidth / window.innerHeight },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = vec4(position,1.0); }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;

        uniform sampler2D prev;
        uniform vec3 mouse;
        uniform vec2 resolution;
        uniform float aspect;
        uniform float time;

        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }

        float noise(vec2 p) {
          vec2 i = floor(p);
          vec2 f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
            mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
            f.y
          );
        }

        void main() {
          vec2 px = 1.0 / resolution;

          vec4 prevData = texture2D(prev, vUv);
          float heat = prevData.r;
          float smoke = prevData.g;

          // --- Buoyancy + turbulence ---
          float n = noise(vUv * 6.0 + vec2(0.0, time * 0.25));
          vec2 warp = vec2(n - 0.5, abs(n - 0.5));
          vec2 advectUv = vUv - vec2(0.0, heat * 0.02) - warp * 0.003;

          heat = texture2D(prev, advectUv).r;
          smoke = texture2D(prev, advectUv).g;

          // --- Diffusion ---
          float avg =
            texture2D(prev, advectUv + vec2(px.x, 0.0)).r +
            texture2D(prev, advectUv - vec2(px.x, 0.0)).r +
            texture2D(prev, advectUv + vec2(0.0, px.y)).r +
            texture2D(prev, advectUv - vec2(0.0, px.y)).r;

          heat = mix(heat, avg * 0.25, 0.45);

          // --- Cooling ---
          heat *= 0.985;
          heat -= 0.002;

          // --- Heat -> Smoke conversion ---
          float cooled = max(0.0, 0.15 - heat);
          smoke += cooled * 0.04;
          smoke *= 0.995;

          // --- Injection ---
          vec2 d = vUv - mouse.xy;
          d.x *= aspect;
          float len = length(d);

          if (len < 0.06) {
            float strength = smoothstep(0.06, 0.0, len);
            float flicker = 0.9 + 0.2 * sin(time * 30.0 + len * 50.0);
            heat += strength * 0.8 * mouse.z * flicker;
          }

          gl_FragColor = vec4(max(heat,0.0), clamp(smoke,0.0,1.0), 0.0, 1.0);
        }
      `,
    });

    // ======================
    // Display Shader
    // ======================
    const displayMat = new THREE.ShaderMaterial({
      transparent: true,
      uniforms: {
        tex: { value: targetA.texture },
      },
      vertexShader: simMat.vertexShader,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tex;

        void main() {
          vec4 d = texture2D(tex, vUv);
          float heat = d.r;
          float smoke = d.g;

          if (heat < 0.003 && smoke < 0.01) discard;

          vec3 flame =
            heat < 0.2 ? mix(vec3(0.2,0.02,0.01), vec3(0.9,0.2,0.05), heat / 0.2) :
            heat < 0.6 ? mix(vec3(0.9,0.2,0.05), vec3(1.0,0.6,0.1), (heat - 0.2)/0.4) :
                         mix(vec3(1.0,0.6,0.1), vec3(1.0), clamp((heat - 0.6)/0.4,0.0,1.0));

          vec3 smokeCol = vec3(0.12) * smoke;

          float alpha = clamp(heat * 3.0 + smoke * 0.6, 0.0, 1.0);

          gl_FragColor = vec4(flame + smokeCol, alpha);
        }
      `,
    });

    const plane = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(plane, simMat);
    scene.add(mesh);

    // ======================
    // Post Processing
    // ======================
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(
      new EffectPass(
        camera,
        new BloomEffect({
          intensity: 2.2,
          luminanceThreshold: 0.15,
          radius: 0.7,
        })
      )
    );

    // ======================
    // Animation Loop
    // ======================
    function animate(t) {
      const time = t * 0.001;

      simMat.uniforms.time.value = time;
      simMat.uniforms.prev.value = targetA.texture;
      simMat.uniforms.mouse.value.set(
        mouse.current.x,
        1.0 - mouse.current.y,
        mouse.current.z
      );

      mesh.material = simMat;
      renderer.setRenderTarget(targetB);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      [targetA, targetB] = [targetB, targetA];

      mesh.material = displayMat;
      displayMat.uniforms.tex.value = targetA.texture;
      composer.render();

      requestAnimationFrame(animate);
    }

    animate(0);

    // ======================
    // Input + Cleanup
    // ======================
    function onResize() {
      renderer.setSize(window.innerWidth, window.innerHeight);
      composer.setSize(window.innerWidth, window.innerHeight);
      simMat.uniforms.aspect.value = window.innerWidth / window.innerHeight;
    }

    function onMove(e) {
      mouse.current.x = e.clientX / window.innerWidth;
      mouse.current.y = e.clientY / window.innerHeight;
    }

    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMove);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      if (renderer.domElement.parentNode)
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      renderer.dispose();
      targetA.dispose();
      targetB.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10,
        cursor: "crosshair",
      }}
    />
  );
}
