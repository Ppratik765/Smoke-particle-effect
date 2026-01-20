import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from "postprocessing";

export default function FlameCanvas() {
  const mountRef = useRef();
  // Store mouse state
  const mouse = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    // 1. Setup Renderer with Alpha (transparency)
    const renderer = new THREE.WebGLRenderer({ 
      alpha: true, 
      powerPreference: "high-performance",
      antialias: false,
      stencil: false,
      depth: false
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(0x000000, 0); // Transparent background
    mountRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Resolution for the simulation buffer (higher = sharper, lower = more fluid/blurry)
    const simRes = 256; 

    // 2. Setup Render Targets (Ping-Pong Buffering)
    const createRT = () =>
      new THREE.WebGLRenderTarget(simRes, simRes, {
        type: THREE.FloatType, // Needed for precise heat values > 1.0
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format: THREE.RedFormat, // We only need 1 channel (Heat) for physics
      });

    let targetA = createRT();
    let targetB = createRT();

    // 3. Simulation Shader (The Physics)
    const simMat = new THREE.ShaderMaterial({
      uniforms: {
        prev: { value: targetA.texture },
        mouse: { value: new THREE.Vector3(0, 0, 0) }, // x, y, isClicking
        resolution: { value: new THREE.Vector2(simRes, simRes) },
        aspect: { value: window.innerWidth / window.innerHeight },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D prev;
        uniform vec3 mouse;
        uniform vec2 resolution;
        uniform float aspect;

        void main() {
          vec2 uv = vUv;
          vec2 px = 1.0 / resolution;

          // 1. Diffusion (Spreading heat to neighbors)
          // This makes it behave like a liquid
          float center = texture2D(prev, uv).r;
          float top = texture2D(prev, uv + vec2(0.0, px.y)).r;
          float bottom = texture2D(prev, uv - vec2(0.0, px.y)).r;
          float left = texture2D(prev, uv - vec2(px.x, 0.0)).r;
          float right = texture2D(prev, uv + vec2(px.x, 0.0)).r;

          // Laplacian operator for diffusion
          float avg = (top + bottom + left + right + center) / 5.0;
          float diff = mix(center, avg, 0.8); // 0.8 = high viscosity spreading

          // 2. Cooling (Decay)
          diff *= 0.985; // Cools down slowly (0.99 is slower, 0.90 is fast)
          diff -= 0.002; // Absolute dropoff to ensure it eventually hits 0

          // 3. Mouse Injection
          vec2 m = mouse.xy;
          vec2 d = uv - m;
          d.x *= aspect; // Fix aspect ratio distortion
          float len = length(d);
          
          // Brush size and heat intensity
          if(len < 0.04) {
             float heat = smoothstep(0.04, 0.0, len);
             diff += heat * 0.5; // Add heat
          }

          gl_FragColor = vec4(max(diff, 0.0), 0.0, 0.0, 1.0);
        }
      `,
    });

    // 4. Display Shader (The Visuals)
    const displayMat = new THREE.ShaderMaterial({
      uniforms: {
        tex: { value: targetA.texture },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tex;
        uniform float time;

        // Simple pseudo-noise function
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                       mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }

        void main() {
          float heat = texture2D(tex, vUv).r;
          
          if (heat < 0.01) discard; // Optimization: don't draw empty space

          // Add dynamic noise to simulate churning lava crust
          float n = noise(vUv * 10.0 + vec2(time * 0.2, time * 0.1));
          float texHeat = heat + (n * 0.1) - 0.05;

          vec3 color = vec3(0.0);
          float alpha = 1.0;

          // Lava Color Gradient
          vec3 crust = vec3(0.1, 0.05, 0.05); // Dark Rock
          vec3 red = vec3(0.6, 0.0, 0.0);    // Cooling Magma
          vec3 orange = vec3(1.0, 0.3, 0.0); // Hot Lava
          vec3 yellow = vec3(1.0, 0.8, 0.2); // Very Hot
          vec3 white = vec3(1.0, 1.0, 1.0);  // Core Heat

          if (texHeat < 0.15) {
             // Fading out / Crust
             color = mix(vec3(0.0), crust, smoothstep(0.0, 0.15, texHeat));
             alpha = smoothstep(0.01, 0.1, texHeat); // Fade alpha at edges
          } else if (texHeat < 0.4) {
             color = mix(crust, red, (texHeat - 0.15) / 0.25);
          } else if (texHeat < 0.7) {
             color = mix(red, orange, (texHeat - 0.4) / 0.3);
          } else if (texHeat < 1.0) {
             color = mix(orange, yellow, (texHeat - 0.7) / 0.3);
          } else {
             color = mix(yellow, white, clamp((texHeat - 1.0) / 0.5, 0.0, 1.0));
          }

          gl_FragColor = vec4(color, alpha);
        }
      `,
      transparent: true,
    });

    const plane = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(plane, simMat); // Start with sim material
    scene.add(mesh);

    // 5. Post-Processing (Bloom)
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new BloomEffect({
        intensity: 2.0,   // Glow strength
        luminanceThreshold: 0.2, // Only bright parts glow
        radius: 0.6 // Glow spread
    })));

    // Animation Loop
    function animate(t) {
      const timeVal = t * 0.001;

      // --- Step 1: Simulation (Physics) ---
      mesh.material = simMat;
      simMat.uniforms.prev.value = targetA.texture;
      simMat.uniforms.mouse.value.set(mouse.current.x, 1.0 - mouse.current.y, 0);
      
      // Render physics to targetB
      renderer.setRenderTarget(targetB);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      // Swap buffers
      const temp = targetA;
      targetA = targetB;
      targetB = temp;

      // --- Step 2: Display (Visuals) ---
      mesh.material = displayMat;
      displayMat.uniforms.tex.value = targetA.texture;
      displayMat.uniforms.time.value = timeVal;

      // Render to screen with Bloom
      composer.render();

      requestAnimationFrame(animate);
    }

    animate(0);

    // Resize Handler
    function onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h);
        composer.setSize(w, h);
        simMat.uniforms.aspect.value = w / h;
    }

    // Mouse Handler
    function onMove(e) {
      mouse.current.x = e.clientX / window.innerWidth;
      mouse.current.y = e.clientY / window.innerHeight;
    }

    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMove);
    // Touch support
    window.addEventListener("touchmove", (e) => {
        const touch = e.touches[0];
        mouse.current.x = touch.clientX / window.innerWidth;
        mouse.current.y = touch.clientY / window.innerHeight;
    });

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMove);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
      targetA.dispose();
      targetB.dispose();
    };
  }, []);

  return <div ref={mountRef} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", pointerEvents: "none", zIndex: 10 }} />;
}