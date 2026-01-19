import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer, RenderPass, BloomEffect, EffectPass } from "postprocessing";

export default function SmokeCanvas() {
  const mountRef = useRef(null);
  const mouse = useRef({ x: 0, y: 0, dx: 0, dy: 0 });

  useEffect(() => {
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    composer.addPass(new EffectPass(camera, new BloomEffect({ intensity: 1.8, mipmapBlur: true })));

    const resolution = 512;

    let rtA = new THREE.WebGLRenderTarget(resolution, resolution, { type: THREE.FloatType });
    let rtB = new THREE.WebGLRenderTarget(resolution, resolution, { type: THREE.FloatType });

    const plane = new THREE.PlaneGeometry(2, 2);

    const simMaterial = new THREE.ShaderMaterial({
      uniforms: {
        uTexture: { value: null },
        uMouse: { value: new THREE.Vector4() },
        uTime: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D uTexture;
        uniform vec4 uMouse;
        uniform float uTime;

        void main() {
          vec4 color = texture2D(uTexture, vUv);

          color *= 0.97;

          vec2 diff = vUv - uMouse.xy;
          float dist = length(diff);

          float force = exp(-dist * 40.0);

          vec3 smoke = vec3(
            0.5 + 0.5 * sin(uTime + diff.x * 10.0),
            0.5 + 0.5 * sin(uTime + diff.y * 10.0 + 2.0),
            0.5 + 0.5 * sin(uTime + 4.0)
          );

          color.rgb += smoke * force * length(uMouse.zw) * 3.0;

          gl_FragColor = color;
        }
      `,
    });

    const mesh = new THREE.Mesh(plane, simMaterial);
    scene.add(mesh);

    function animate(t) {
      simMaterial.uniforms.uTexture.value = rtA.texture;
      simMaterial.uniforms.uMouse.value.set(
        mouse.current.x,
        1 - mouse.current.y,
        mouse.current.dx,
        mouse.current.dy
      );
      simMaterial.uniforms.uTime.value = t * 0.001;

      renderer.setRenderTarget(rtB);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      [rtA, rtB] = [rtB, rtA];

      composer.render();

      mouse.current.dx *= 0.9;
      mouse.current.dy *= 0.9;

      requestAnimationFrame(animate);
    }

    animate(0);

    function handleMove(e) {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      mouse.current.dx = x - mouse.current.x;
      mouse.current.dy = y - mouse.current.y;
      mouse.current.x = x;
      mouse.current.y = y;
    }

    window.addEventListener("mousemove", handleMove);

    return () => {
      window.removeEventListener("mousemove", handleMove);
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} />;
}
