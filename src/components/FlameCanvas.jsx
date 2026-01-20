import { useEffect, useRef } from "react";
import * as THREE from "three";

export default function FlameCanvas() {
  const mountRef = useRef();
  const mouse = useRef({ x: 0.5, y: 0.5, dx: 0, dy: 0 });

  useEffect(() => {
    const renderer = new THREE.WebGLRenderer();
    renderer.setSize(window.innerWidth, window.innerHeight);
    mountRef.current.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    const res = 512;

    const createRT = () =>
      new THREE.WebGLRenderTarget(res, res, {
        type: THREE.FloatType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
      });

    let flameA = createRT();
    let flameB = createRT();

    const plane = new THREE.PlaneGeometry(2, 2);

    const simMat = new THREE.ShaderMaterial({
      uniforms: {
        prev: { value: flameA.texture },
        mouse: { value: new THREE.Vector4() },
        time: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main(){vUv=uv;gl_Position=vec4(position,1.0);}
      `,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D prev;
        uniform vec4 mouse;
        uniform float time;

        float rand(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);}

        void main(){
          vec4 c = texture2D(prev, vUv);

          c *= 0.96;

          vec2 d = vUv - mouse.xy;
          float r = length(d);

          float inject = exp(-r*45.0);

          float heat = inject * 3.0;

          c.r += heat;
          c.g += heat*0.6;
          c.b += heat*0.1;

          c.a += inject;

          gl_FragColor = c;
        }
      `,
    });

    const displayMat = new THREE.ShaderMaterial({
      uniforms: {
        tex: { value: flameA.texture },
        time: { value: 0 },
      },
      vertexShader: simMat.vertexShader,
      fragmentShader: `
        varying vec2 vUv;
        uniform sampler2D tex;
        uniform float time;

        float flicker(vec2 uv){
          return sin(uv.y*30.0 + time*6.0) * 0.2;
        }

        void main(){
          vec4 c = texture2D(tex, vUv);

          float flame = smoothstep(0.3, 2.5, c.r + flicker(vUv));

          vec3 flameColor = mix(vec3(1.0,0.8,0.5), vec3(1.0,0.3,0.05), flame);

          vec3 smoke = vec3(c.a * 0.25);

          gl_FragColor = vec4(flameColor*flame + smoke, 1.0);
        }
      `,
    });

    const mesh = new THREE.Mesh(plane, simMat);
    scene.add(mesh);

    function animate(t) {
      simMat.uniforms.prev.value = flameA.texture;
      simMat.uniforms.mouse.value.set(
        mouse.current.x,
        1 - mouse.current.y,
        mouse.current.dx,
        mouse.current.dy
      );
      simMat.uniforms.time.value = t * 0.001;

      renderer.setRenderTarget(flameB);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);

      [flameA, flameB] = [flameB, flameA];

      mesh.material = displayMat;
      displayMat.uniforms.tex.value = flameA.texture;
      displayMat.uniforms.time.value = t * 0.001;

      renderer.render(scene, camera);

      mesh.material = simMat;

      mouse.current.dx *= 0.45;
      mouse.current.dy *= 0.45;

      requestAnimationFrame(animate);
    }

    animate(0);

    function onMove(e) {
      const x = e.clientX / window.innerWidth;
      const y = e.clientY / window.innerHeight;
      mouse.current.dx = x - mouse.current.x;
      mouse.current.dy = y - mouse.current.y;
      mouse.current.x = x;
      mouse.current.y = y;
    }

    window.addEventListener("mousemove", onMove);

    return () => {
      window.removeEventListener("mousemove", onMove);
      if (renderer.domElement.parentNode)
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      renderer.dispose();
    };
  }, []);

  return <div ref={mountRef} />;
}
