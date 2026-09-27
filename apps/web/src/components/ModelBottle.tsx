import { useEffect, useRef } from 'react';
import {
  ACESFilmicToneMapping,
  Box3,
  PerspectiveCamera,
  PMREMGenerator,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { prefersReducedMotion } from '../gl/scene';

/**
 * Modelo 3D real de um frasco (GLB/GLTF), para quando `model3DUrl` existir.
 * Este arquivo (e o three.js inteiro) só é baixado quando um perfume com modelo entra em foco.
 * Luz de estúdio neutra (RoomEnvironment) para vidro e metal lerem bem sobre o preto; giro com arrasto,
 * zoom contido, giro lento sozinho enquanto ninguém mexe (desligado com movimento reduzido).
 */
export default function ModelBottle({ url, onError }: { url: string; onError: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const failed = useRef(onError);
  failed.current = onError;

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.setClearColor(0x000000, 0);
    el.appendChild(renderer.domElement);

    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const camera = new PerspectiveCamera(30, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.autoRotate = !prefersReducedMotion();
    controls.autoRotateSpeed = 0.6;
    controls.minPolarAngle = Math.PI * 0.3;
    controls.maxPolarAngle = Math.PI * 0.62;

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = el;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();

    let model: Object3D | null = null;
    new GLTFLoader().load(
      url,
      (gltf) => {
        if (disposed) return;
        model = gltf.scene;
        const box = new Box3().setFromObject(model);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        model.position.sub(center);
        scene.add(model);
        const radius = Math.max(size.x, size.y, size.z) * 0.5;
        const distance = radius / Math.sin((camera.fov * Math.PI) / 360);
        camera.position.set(0, radius * 0.15, distance * 1.05);
        controls.minDistance = distance * 0.8;
        controls.maxDistance = distance * 1.4;
        controls.update();
      },
      undefined,
      () => !disposed && failed.current(),
    );

    let raf = 0;
    const loop = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      pmrem.dispose();
      scene.traverse((o) => {
        const mesh = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void } | { dispose(): void }[] };
        mesh.geometry?.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
        mats.forEach((m) => m.dispose());
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url]);

  return <div ref={host} className="bottle__model" aria-label="Modelo 3D do frasco. Arraste para girar." />;
}
