import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer, RenderPass, EffectPass, BloomEffect } from "postprocessing";

export default function FlameCanvas() {
  const mountRef = useRef();
  // mouse.z = 1.0 (Pen Down / Drawing), 0.0 (Pen Up / Not Drawing)
  const mouse = useRef({ x: 0.5, y: 0.5, z: 1.0 });

  useEffect(() => {
    // 1. Setup Renderer
    const renderer = new THREE.WebGLRenderer({ 
      alpha: true, 
      powerPreference: "high-performance",
      antialias: false,
      stencil: false,
      depth: false
    });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    mountRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // 2. Render Targets
    // UPGRADE: Increased to 512 for sharper, less blocky details
    const simRes = 512; 
    const createRT = () =>
      new THREE.WebGLRenderTarget(simRes, simRes, {
        type: THREE.HalfFloatType,
        format: THREE.RGBAFormat,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

    let targetA = createRT();
    let targetB = createRT();

    // 3. Simulation Shader (Physics)
    const simMat = new THREE.ShaderMaterial({
      uniforms: {
        prev: { value: targetA.texture },
        mouse: { value: new THREE.Vector3(0, 0, 0) },
        resolution: { value: new THREE.Vector2(simRes, simRes) },
        aspect: { value: window.innerWidth / window.innerHeight },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D prev;
        uniform vec3 mouse;
        uniform vec2 resolution;
        uniform float aspect;

        void main() {
          vec2 uv = vUv;
          vec2 px = 1.0 / resolution;

          float center = texture2D(prev, uv).r;
          float top = texture2D(prev, uv + vec2(0.0, px.y)).r;
          float bottom = texture2D(prev, uv - vec2(0.0, px.y)).r;
          float left = texture2D(prev, uv - vec2(px.x, 0.0)).r;
          float right = texture2D(prev, uv + vec2(px.x, 0.0)).r;

          float avg = (top + bottom + left + right + center) / 5.0;
          float diff = mix(center, avg, 0.6); // Viscosity

          diff *= 0.99; // Cooling
          diff -= 0.002;

          vec2 m = mouse.xy;
          vec2 d = uv - m;
          d.x *= aspect;
          float len = length(d);
          
          if(len < 0.06) {
             float heat = smoothstep(0.06, 0.0, len);
             diff += heat * 0.8 * mouse.z; 
          }

          gl_FragColor = vec4(max(diff, 0.0), 0.0, 0.0, 1.0);
        }
      `,
    });

    // 4. Display Shader (The 3D Lava Look)
    const displayMat = new THREE.ShaderMaterial({
      uniforms: {
        tex: { value: targetA.texture },
        time: { value: 0 },
        resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        uniform sampler2D tex;
        uniform float time;
        uniform vec2 resolution;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                       mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
        }
        float fbm(vec2 p) {
            float v = 0.0;
            v += 0.5 * noise(p); p *= 2.0;
            v += 0.25 * noise(p); p *= 2.0;
            return v;
        }

        void main() {
          // Flow Distortion
          vec2 flow = vec2(fbm(vUv * 5.0 + time * 0.5), fbm(vUv * 5.0 - time * 0.5)) - 0.5;
          vec2 uv = vUv + flow * 0.015; 
          
          float heat = texture2D(tex, uv).r;
          
          // UPGRADE: Soft Edge (Anti-Voxel)
          // Instead of 'discard', we fade the alpha out smoothly
          float alpha = smoothstep(0.01, 0.08, heat);
          if (alpha < 0.01) discard; // Still discard fully empty pixels for performance

          // UPGRADE: Smoother Normals
          // We sample 2.0 pixels away instead of 1.0. This blurs the shape slightly, 
          // removing the jagged "minecraft" look from the reflection.
          vec2 px = (1.0 / resolution.xy) * 2.5; 
          
          float hL = texture2D(tex, uv - vec2(px.x, 0.0)).r;
          float hR = texture2D(tex, uv + vec2(px.x, 0.0)).r;
          float hD = texture2D(tex, uv - vec2(0.0, px.y)).r;
          float hU = texture2D(tex, uv + vec2(0.0, px.y)).r;
          
          vec3 normal = normalize(vec3( (hL - hR) * 3.0, (hD - hU) * 3.0, 0.05 )); // Lower Z = Steeper slopes

          // Lighting Setup
          vec3 lightDir = normalize(vec3(0.5, 0.5, 1.0));
          vec3 viewDir = vec3(0.0, 0.0, 1.0); // Viewer is always looking straight down

          // 1. Diffuse (Base Shape)
          float diff = max(dot(normal, lightDir), 0.0);
          
          // 2. Specular (Wet Shine)
          vec3 reflectDir = reflect(-lightDir, normal);
          float spec = pow(max(dot(viewDir, reflectDir), 0.0), 20.0); // Broader highlight

          // 3. Fresnel (Rim Light - The "3D Volume" Trick)
          // This creates a glow on the steep edges, making it look like a thick liquid bubble.
          float fresnel = pow(1.0 - max(dot(normal, viewDir), 0.0), 3.0);

          // Color Ramp
          float crustNoise = fbm(uv * 10.0 + time * 0.2);
          float noisyHeat = heat - (crustNoise * 0.15); 

          vec3 rock = vec3(0.02, 0.0, 0.0);       
          vec3 magma = vec3(0.8, 0.1, 0.0);       
          vec3 lava = vec3(1.0, 0.4, 0.0);        
          vec3 bright = vec3(1.0, 0.9, 0.5);      

          vec3 col;
          if (noisyHeat < 0.15) {
              col = mix(rock, magma, smoothstep(0.0, 0.15, noisyHeat));
          } else if (noisyHeat < 0.4) {
              col = mix(magma, lava, (noisyHeat - 0.15) / 0.25);
          } else {
              col = mix(lava, bright, (noisyHeat - 0.4) / 0.6);
          }

          // Composite Lighting
          // Add specular white
          col += vec3(1.0, 0.9, 0.8) * spec * 0.6; 
          // Add Fresnel Rim (Orange/Red Glow)
          col += vec3(1.0, 0.3, 0.0) * fresnel * 0.8; 
          // Apply Shadows
          col *= (0.6 + diff * 0.4);

          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
    });

    const plane = new THREE.PlaneGeometry(2, 2);
    const mesh = new THREE.Mesh(plane, simMat);
    scene.add(mesh);

    // 5. Post-Processing
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new BloomEffect({
        intensity: 3.0,
        luminanceThreshold: 0.1, 
        radius: 0.9
    })));

    function animate(t) {
      const timeVal = t * 0.001;

      // Simulation
      mesh.material = simMat;
      simMat.uniforms.prev.value = targetA.texture;
      simMat.uniforms.mouse.value.set(mouse.current.x, 1.0 - mouse.current.y, mouse.current.z);
      
      renderer.setRenderTarget(targetB);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      const temp = targetA;
      targetA = targetB;
      targetB = temp;

      // Display
      mesh.material = displayMat;
      displayMat.uniforms.tex.value = targetA.texture;
      displayMat.uniforms.time.value = timeVal;
      displayMat.uniforms.resolution.value.set(window.innerWidth, window.innerHeight);

      composer.render();
      requestAnimationFrame(animate);
    }

    animate(0);

    // --- INPUT HANDLING ---
    function onResize() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        renderer.setSize(w, h);
        composer.setSize(w, h);
        simMat.uniforms.aspect.value = w / h;
    }

    function onMouseMove(e) {
      mouse.current.x = e.clientX / window.innerWidth;
      mouse.current.y = e.clientY / window.innerHeight;
    }

    function onMouseDown(e) {
      if (e.button === 0) mouse.current.z = 1.0;
      if (e.button === 2) mouse.current.z = 0.0;
    }

    function onContextMenu(e) {
      e.preventDefault();
    }

    function updateTouch(e) {
        if(e.touches.length > 0) {
            const touch = e.touches[0];
            mouse.current.x = touch.clientX / window.innerWidth;
            mouse.current.y = touch.clientY / window.innerHeight;
        }
    }

    function onTouchStart(e) {
        if (e.cancelable) e.preventDefault(); 
        mouse.current.z = 1.0; 
        updateTouch(e);
    }

    function onTouchMove(e) {
        if (e.cancelable) e.preventDefault();
        updateTouch(e);
    }

    function onTouchEnd(e) {
        mouse.current.z = 0.0;
    }

    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("contextmenu", onContextMenu);
    window.addEventListener("touchstart", onTouchStart, { passive: false });
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onTouchEnd);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);

      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
      targetA.dispose();
      targetB.dispose();
    };
  }, []);

  return <div ref={mountRef} style={{ position: "fixed", top: 0, left: 0, width: "100%", height: "100%", zIndex: 10, cursor: 'crosshair' }} />;
}