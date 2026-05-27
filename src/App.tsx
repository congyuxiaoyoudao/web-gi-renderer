import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, ContactShadows, OrbitControls, Float, Backdrop, Lightformer } from '@react-three/drei';
import { WebGPURenderer } from 'three/webgpu';
import { Suspense, useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { CAMERA_PRESETS, useSettings, GAUSSIAN_SCENES, SettingsPanel } from '@/src/SettingsPanel';
import { WebGPUSplat } from './WebGPUSplat';
import { UploadedModel } from './UploadedModel';
import { usePrimitives, PrimitivesScene, type ScenePrimitive, type GizmoMode } from './Primitives';
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

interface BenchmarkRef {
  recording: boolean;
  fpsSamples: number[];
  memorySamples: number[];
  peakMemory: number;
  startTime: number;
  duration: number;
}

function Scene({ sphereColor, splatRadius, sortMethod, onCameraReady, gaussianUrl, debugDepth, shDegree, gaussianTransform, modelUrl, primitives, selectedId, setSelectedId, gizmoMode, benchmarkRef, onBenchmarkDone, envDir }: { sphereColor: string; splatRadius: number; sortMethod: string; onCameraReady?: (cam: THREE.PerspectiveCamera) => void; gaussianUrl: string; debugDepth: boolean; shDegree: number; gaussianTransform: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }; modelUrl: string; primitives: ScenePrimitive[]; selectedId: string | null; setSelectedId: (id: string | null) => void; gizmoMode: GizmoMode; benchmarkRef: React.RefObject<BenchmarkRef>; onBenchmarkDone: React.RefObject<(() => void) | null>; envDir: string }) {
  const { scene } = useThree();
  const perfRef = useRef({ frames: 0, prevTime: performance.now() });

  // Pre-compute the environment euler from the gaussian transform.
  // Gaussian model matrix = Translation × Rotation(euler) × Scale(1,-1,-1).
  // Scale(1,-1,-1) ≡ RotationX(180°), so add that flip plus the empirical +90° correction.
  const envEuler = useMemo(() => {
    const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
      gaussianTransform.rotation.x * Math.PI / 180,
      gaussianTransform.rotation.y * Math.PI / 180,
      gaussianTransform.rotation.z * Math.PI / 180
    ));
    rotMatrix.multiply(new THREE.Matrix4().makeRotationX(Math.PI * 2.5));
    return new THREE.Euler().setFromRotationMatrix(rotMatrix);
  }, [gaussianTransform.rotation.x, gaussianTransform.rotation.y, gaussianTransform.rotation.z]);

  useFrame(() => {
    perfRef.current.frames++;
    const time = performance.now();
    if (time >= perfRef.current.prevTime + 1000) {
      const fps = Math.round((perfRef.current.frames * 1000) / (time - perfRef.current.prevTime));
      perfRef.current.frames = 0;
      perfRef.current.prevTime = time;
      
      const memory = (performance as any).memory;
      const memMB = memory ? memory.usedJSHeapSize / 1048576 : 0;
      const memoryUsage = memory ? `${Math.round(memMB)} MB / ${Math.round(memory.totalJSHeapSize / 1048576)} MB` : 'N/A';
      
      const fpsEl = document.getElementById('perf-fps');
      if (fpsEl) fpsEl.innerText = `${fps} FPS`;
      
      const memEl = document.getElementById('perf-memory');
      if (memEl) memEl.innerText = memoryUsage;

      const sortEl = document.getElementById('perf-sort-method');
      if (sortEl) sortEl.innerText = sortMethod;

      // Feed benchmark samples
      const bm = benchmarkRef.current;
      if (bm.recording) {
        bm.fpsSamples.push(fps);
        bm.memorySamples.push(memMB);
        bm.peakMemory = Math.max(bm.peakMemory, memMB);
        if (time - bm.startTime >= bm.duration * 1000) {
          bm.recording = false;
          onBenchmarkDone.current?.();
        }
      }
    }
    // Sync environment rotation every frame — drei's <Environment> re-renders
    // can reset scene.backgroundRotation, so we enforce it here unconditionally.
    scene.environmentRotation.copy(envEuler);
    scene.backgroundRotation.copy(envEuler);
  });

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
          `${envDir}/px.jpg`,
          `${envDir}/nx.jpg`,
          `${envDir}/py.jpg`,
          `${envDir}/ny.jpg`,
          `${envDir}/pz.jpg`,
          `${envDir}/nz.jpg`,
        ]}
        background blur={0.8}
      />
      <WebGPUSplat url={gaussianUrl} splatRadius={splatRadius} sortMethod={sortMethod} debugDepth={debugDepth} shDegree={shDegree} gaussianTransform={gaussianTransform} />

      {modelUrl && (
        <Suspense fallback={null}>
          <UploadedModel url={modelUrl} />
        </Suspense>
      )}

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

      <mesh position={[0, -1.5, 0]} rotation={[-Math.PI / 2, 0, 0]} scale={[50, 50, 1]} receiveShadow onClick={() => setSelectedId(null)}>
        <planeGeometry />
        <meshStandardMaterial color="#151515" roughness={0.8} metalness={0.2} />
      </mesh>

      <OrbitControls makeDefault enableZoom={true} minPolarAngle={0} maxPolarAngle={Math.PI / 2 + 0.1} />

      <PrimitivesScene primitives={primitives} selectedId={selectedId} setSelectedId={setSelectedId} gizmoMode={gizmoMode} />
    </>
  );
}

export default function App() {
  const settings = useSettings();
  const { sphereColor, cameraPreset, sortMethod, splatRadius, sceneIndex, debugDepth, shDegree, gaussianTransform,
    uploadedGaussianUrl, uploadedModelUrl, cameraFrames, cameraFrameIndex, setCameraFrameIndex, loadCameraJson, clearCameraPath } = settings;
  const { primitives, selectedId, setSelectedId, gizmoMode, setGizmoMode, addPrimitive, deleteSelected } = usePrimitives();
  const [camera, setCamera] = useState<THREE.PerspectiveCamera | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [gpuDevice, setGpuDevice] = useState<GPUDevice | null | undefined>(undefined); // undefined = still initializing
  const gaussianScene = GAUSSIAN_SCENES[sceneIndex];
  const isNoneGaussianMode = gaussianScene.url === '';
  const isCustomGaussianMode = gaussianScene.url === '__custom__';
  const gaussianUrl = isCustomGaussianMode ? uploadedGaussianUrl : (isNoneGaussianMode ? '' : gaussianScene.url);

  // Benchmark
  const BENCHMARK_DURATION = 10; // seconds
  const benchmarkRef = useRef<BenchmarkRef>({ recording: false, fpsSamples: [], memorySamples: [], peakMemory: 0, startTime: 0, duration: BENCHMARK_DURATION });
  const onBenchmarkDone = useRef<(() => void) | null>(null);
  const [isBenchmarking, setIsBenchmarking] = useState(false);
  const [benchmarkResult, setBenchmarkResult] = useState<{ avgFps: number; avgMemory: number; peakMemory: number } | null>(null);

  onBenchmarkDone.current = () => {
    const { fpsSamples, memorySamples, peakMemory } = benchmarkRef.current;
    const avg = (arr: number[]) => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    setBenchmarkResult({
      avgFps: Math.round(avg(fpsSamples)),
      avgMemory: Math.round(avg(memorySamples)),
      peakMemory: Math.round(peakMemory),
    });
    setIsBenchmarking(false);
  };

  const startBenchmark = () => {
    benchmarkRef.current = { recording: true, fpsSamples: [], memorySamples: [], peakMemory: 0, startTime: performance.now(), duration: BENCHMARK_DURATION };
    setBenchmarkResult(null);
    setIsBenchmarking(true);
  };

  // Request device with adapter's actual max limits to avoid the 128MB default storage binding limit.
  useEffect(() => {
    (async () => {
      try {
        const adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) return;
        const device = await adapter.requestDevice({
          requiredLimits: {
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxBufferSize: adapter.limits.maxBufferSize,
          }
        });
        setGpuDevice(device);
      } catch (e) {
        console.warn('Failed to create high-limit GPU device, falling back to default:', e);
        setGpuDevice(null); // null = failed, render Canvas with default device
      }
    })();
  }, []);

  // Keep loader visible until both the timer fires AND the GPU device is ready
  const gpuReady = gpuDevice !== undefined;

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!camera) return;
    // Camera frames override presets
    if (cameraFrames.length > 0) {
      const frame = cameraFrames[cameraFrameIndex];
      if (frame) {
        camera.position.copy(frame.position);
        camera.quaternion.copy(frame.quaternion);
        camera.fov = frame.fov;
        camera.updateProjectionMatrix();
      }
      return;
    }
    const preset = CAMERA_PRESETS[cameraPreset];
    camera.position.set(preset.position[0], preset.position[1], preset.position[2]);
    camera.lookAt(0, 1, 0);
    camera.updateProjectionMatrix();
  }, [cameraPreset, camera, cameraFrames, cameraFrameIndex]);

  // Camera path playback with smooth interpolation
  const playProgressRef = useRef(0);

  useEffect(() => {
    if (!playing || !camera || cameraFrames.length < 2) return;

    playProgressRef.current = cameraFrameIndex;
    let lastTime = performance.now();
    let animId: number;

    const speed = 3; // frames per second

    const animate = () => {
      const now = performance.now();
      const dt = (now - lastTime) / 1000;
      lastTime = now;

      playProgressRef.current += dt * speed;

      if (playProgressRef.current >= cameraFrames.length - 1) {
        playProgressRef.current = cameraFrames.length - 1;
        setCameraFrameIndex(cameraFrames.length - 1);
        setPlaying(false);
        return;
      }

      const t = playProgressRef.current;
      const i = Math.floor(t);
      const frac = t - i;
      const j = Math.min(i + 1, cameraFrames.length - 1);

      const frameA = cameraFrames[i];
      const frameB = cameraFrames[j];

      // Spherical linear interpolation for rotation, linear for position/fov
      camera.position.lerpVectors(frameA.position, frameB.position, frac);
      camera.quaternion.slerpQuaternions(frameA.quaternion, frameB.quaternion, frac);
      camera.fov = frameA.fov + (frameB.fov - frameA.fov) * frac;
      camera.updateProjectionMatrix();

      setCameraFrameIndex(i);
      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [playing, camera, cameraFrames, setCameraFrameIndex]);

  return (
    <div className="w-full h-screen bg-zinc-950">
      <Loader loading={loading || !gpuReady} />
      <div className="absolute top-6 left-6 z-10 text-white font-sans pointer-events-none">
        <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-500">WebGPU PBR & GI</h1>
        <p className="text-zinc-400 text-sm mt-2 max-w-md">
          Real-time physically based rendering with global illumination (IBL) powered by React Three Fiber and Three.js WebGPU Renderer.
        </p>
      </div>
      <div className="absolute bottom-6 left-6 z-10 text-white font-sans">
        <h2 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-zinc-500 pointer-events-none" id="perf-fps">
          0 FPS
        </h2>
        <p className="text-zinc-400 text-sm mt-2 max-w-md pointer-events-none">
          Memory: <span id="perf-memory">N/A</span>
        </p>
        <p className="text-zinc-400 text-sm mt-2 max-w-md pointer-events-none">
          Sort Method: <span id="perf-sort-method">{sortMethod}</span>
        </p>
        <button
          onClick={startBenchmark}
          disabled={isBenchmarking}
          className={`mt-3 px-3 py-1.5 text-xs font-semibold rounded-md border transition-colors ${
            isBenchmarking
              ? 'border-yellow-500/50 text-yellow-400 cursor-default'
              : 'border-zinc-600 text-zinc-300 hover:border-zinc-400 hover:text-white cursor-pointer'
          }`}
        >
          {isBenchmarking ? `Benchmarking… (${BENCHMARK_DURATION}s)` : `Benchmark ${BENCHMARK_DURATION}s`}
        </button>
        {benchmarkResult && (
          <div className="mt-2 text-xs text-zinc-400 space-y-0.5 pointer-events-none">
            <p>Avg FPS: <span className="text-white font-mono">{benchmarkResult.avgFps}</span></p>
            <p>Avg Mem: <span className="text-white font-mono">{benchmarkResult.avgMemory} MB</span></p>
            <p>Peak Mem: <span className="text-white font-mono">{benchmarkResult.peakMemory} MB</span></p>
          </div>
        )}
      </div>
      {gpuReady && (
      <Canvas
        shadows
        camera={{ position: [0, 2, 8], fov: 45 }}
        gl={(props) => {
          const renderer = new WebGPURenderer({
            canvas: props.canvas as HTMLCanvasElement,
            antialias: true,
            alpha: true,
            ...(gpuDevice ? { device: gpuDevice } : {})
          } as any);
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
          <Scene
            sphereColor={sphereColor}
            splatRadius={splatRadius}
            sortMethod={sortMethod}
            onCameraReady={setCamera}
            gaussianUrl={gaussianUrl}
            debugDepth={debugDepth}
            shDegree={shDegree}
            gaussianTransform={gaussianTransform}
            modelUrl={uploadedModelUrl}
            primitives={primitives}
            selectedId={selectedId}
            setSelectedId={setSelectedId}
            gizmoMode={gizmoMode}
            benchmarkRef={benchmarkRef}
            onBenchmarkDone={onBenchmarkDone}
            envDir={gaussianScene.envDir}
          />
        </Suspense>
      </Canvas>
      )}
      <SettingsPanel {...settings} addPrimitive={addPrimitive} deleteSelected={deleteSelected} gizmoMode={gizmoMode} setGizmoMode={setGizmoMode} />
      {/* Camera Path Toolbar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
        <div className="flex items-center gap-0 bg-zinc-900/95 backdrop-blur-sm rounded-lg text-white font-sans overflow-hidden border border-zinc-700/50">
          <button
            onClick={clearCameraPath}
            title="Clear camera path"
            className="px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer border-r border-zinc-700/50"
          >
            =
          </button>
          <label
            title="Load cameras.json"
            className="px-3 py-2 text-sm text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors cursor-pointer border-r border-zinc-700/50"
          >
            +
            <input
              type="file"
              accept=".json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) loadCameraJson(file);
                e.target.value = '';
              }}
            />
          </label>
          <div className="flex items-center gap-2 px-3 py-2 border-r border-zinc-700/50">
            <span className="text-xs text-zinc-500">▷</span>
            {cameraFrames.length > 0 ? (
              <input
                type="range"
                min={0}
                max={cameraFrames.length - 1}
                value={cameraFrameIndex}
                onChange={(e) => setCameraFrameIndex(Number(e.target.value))}
                className="w-24"
              />
            ) : (
              <span className="text-xs text-zinc-500 w-24 text-center">—</span>
            )}
          </div>
          <div className="px-3 py-2 border-r border-zinc-700/50 min-w-[60px] text-center">
            <span className="text-xs text-zinc-300 font-mono">
              🎞 {cameraFrames.length > 0 ? `${cameraFrameIndex + 1}.0` : '0.0'}
            </span>
          </div>
          <button
            onClick={() => cameraFrames.length > 0 && setPlaying(!playing)}
            className={`px-4 py-2 text-xs font-semibold tracking-wider transition-colors cursor-pointer ${
              cameraFrames.length > 0
                ? playing
                  ? 'text-yellow-400 hover:bg-zinc-800'
                  : 'text-white hover:bg-zinc-800'
                : 'text-zinc-600 cursor-default'
            }`}
          >
            {playing ? 'PAUSE' : 'PLAY'}
          </button>
        </div>
      </div>
    </div>
  );
}
