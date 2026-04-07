import { Canvas, useFrame } from '@react-three/fiber';
import { Environment, ContactShadows, OrbitControls, Float, Backdrop, Lightformer } from '@react-three/drei';
import { Leva } from 'leva';
import { WebGPURenderer } from 'three/webgpu';
import { Suspense, useRef, useState, useEffect } from 'react';
import * as THREE from 'three';
import { CAMERA_PRESETS, useSettings, GAUSSIAN_SCENES } from '@/src/SettingsPanel';
import { WebGPUSplat } from './WebGPUSplat';
import Loader from './Loader';

function MovingSpots({ positions = [2, 0, 2, 0, 2, 0, 2, 0] }) {
  const group = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (group.current) {
      group.current.position.z = (Math.sin(state.clock.elapsedTime) * 2) - 1;
      group.current.position.y = (Math.cos(state.clock.elapsedTime) * 2) + 2;
    }
  });
  return (
    <group ref={group}>
      {positions.map((x, i) => (
        <Lightformer key={i} form="circle" intensity={4} rotation={[Math.PI / 2, 0, 0]} position={[x, 4, i * 4]} scale={[3, 1, 1]} />
      ))}
    </group>
  );
}

function Scene({ sphereColor, splatRadius, onCameraReady, gaussianUrl }: { sphereColor: string; splatRadius: number; onCameraReady?: (cam: THREE.PerspectiveCamera) => void; gaussianUrl: string }) {
  const camera = useFrame((state) => {
    if (onCameraReady && state.camera) {
      onCameraReady(state.camera as THREE.PerspectiveCamera);
    }
    return state.camera;
  });

  return (
    <>
      <color attach="background" args={['#111111']} />

      {/* <Environment files="https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/potsdamer_platz_1k.hdr" background blur={0.0} /> */}
      <Environment
        files={[
          'assets/px.jpg',
          'assets/nx.jpg',
          'assets/py.jpg',
          'assets/ny.jpg',
          'assets/pz.jpg',
          'assets/nz.jpg',
        ]}
        background blur={0.8}
      />
      <WebGPUSplat url={gaussianUrl} splatRadius={splatRadius} />

      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={2} castShadow color="#ffffff" />
      <directionalLight position={[-10, 10, -10]} intensity={1} castShadow color="#ff0055" />

      <Float speed={2} rotationIntensity={1.5} floatIntensity={2}>
        <mesh position={[0, 1, 0]} castShadow receiveShadow>
          <torusKnotGeometry args={[1, 0.3, 256, 64]} />
          <meshPhysicalMaterial
            color="#ffffff"
            metalness={0.1}
            roughness={0.05}
            transmission={1}
            ior={1.5}
            thickness={2}
            clearcoat={1}
            clearcoatRoughness={0.1}
            iridescence={1}
            iridescenceIOR={1.3}
            iridescenceThicknessRange={[100, 400]}
            attenuationColor="#ffffff"
            attenuationDistance={2}
          />
        </mesh>
      </Float>

      <Float speed={1.5} rotationIntensity={2} floatIntensity={1.5}>
        <mesh position={[-2.5, 0, -2]} castShadow receiveShadow>
          <sphereGeometry args={[0.8, 64, 64]} />
          <meshPhysicalMaterial
            color={sphereColor}
            metalness={0.9}
            roughness={0.1}
            clearcoat={1}
          />
        </mesh>
      </Float>

      <Float speed={2.5} rotationIntensity={1} floatIntensity={2.5}>
        <mesh position={[2.5, 0.5, -1]} castShadow receiveShadow>
          <boxGeometry args={[1.2, 1.2, 1.2]} />
          <meshPhysicalMaterial 
            color="#0055ff"
            metalness={0.1}
            roughness={0.2}
            transmission={0.9}
            ior={1.4}
            thickness={1}
            attenuationColor="#0055ff"
            attenuationDistance={2}
          />
        </mesh>
      </Float>

      <mesh position={[0, -1.5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[50, 50, 1]} receiveShadow>
        <planeGeometry />
        <meshStandardMaterial color="#151515" roughness={0.8} metalness={0.2} />
      </mesh>

      <OrbitControls makeDefault autoRotate autoRotateSpeed={0.5} enableZoom={true} minPolarAngle={0} maxPolarAngle={Math.PI / 2 + 0.1} />
    </>
  );
}

export default function App() {
  const { sphereColor, cameraPreset, splatRadius, sceneIndex } = useSettings();
  const [camera, setCamera] = useState<THREE.PerspectiveCamera | null>(null);
  const [loading, setLoading] = useState(true);
  const gaussianScene = GAUSSIAN_SCENES[sceneIndex];

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!camera) return;
    const preset = CAMERA_PRESETS[cameraPreset];
    camera.position.set(preset.position[0], preset.position[1], preset.position[2]);
    camera.lookAt(0, 1, 0);
    camera.updateProjectionMatrix();
  }, [cameraPreset, camera]);

  return (
    <div className="w-full h-screen bg-zinc-950">
      <Loader loading={loading} />
      <div className="absolute top-6 left-6 z-10 text-white font-sans pointer-events-none">
        <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-500">WebGPU PBR & GI</h1>
        <p className="text-zinc-400 text-sm mt-2 max-w-md">
          Real-time physically based rendering with global illumination (IBL) powered by React Three Fiber and Three.js WebGPU Renderer.
        </p>
      </div>
      <Canvas
        shadows
        camera={{ position: [0, 2, 8], fov: 45 }}
        gl={(props) => {
          const renderer = new WebGPURenderer({ canvas: props.canvas as HTMLCanvasElement, antialias: true, alpha: true });
          const originalRender = renderer.render.bind(renderer);
          const originalRenderAsync = renderer.renderAsync.bind(renderer);
          let initPromise = renderer.init();
          let initialized = false;
          initPromise.then(() => { initialized = true; });

          renderer.render = (scene, camera) => {
            if (initialized) {
              originalRender(scene, camera);
            }
          };
          renderer.renderAsync = async (scene, camera) => {
            if (!initialized) {
              await initPromise;
            }
            return originalRenderAsync(scene, camera);
          };
          return renderer as any;
        }}
      >
        <Suspense fallback={null}>
          <Scene sphereColor={sphereColor} splatRadius={splatRadius} onCameraReady={setCamera} gaussianUrl={gaussianScene.url} />
        </Suspense>
      </Canvas>
      <Leva />
    </div>
  );
}
