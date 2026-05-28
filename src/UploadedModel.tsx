import { useRef, useState, useEffect, useCallback, Suspense } from 'react';
import { useLoader, useThree, useFrame } from '@react-three/fiber';
import { TransformControls } from '@react-three/drei';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';
import type { GizmoMode } from './Primitives';

interface UploadedModelProps {
  url: string;
  metallic?: number;
  roughness?: number;
  position?: { x: number; y: number; z: number };
  rotation?: { x: number; y: number; z: number };
  scale?: number;
}

export interface UploadedModelData {
  id: string;
  url: string;
  name: string;
  metallic: number;
  roughness: number;
  transform: {
    position: { x: number; y: number; z: number };
    rotation: { x: number; y: number; z: number };
    scale: number;
  };
}

export function useModels() {
  const [models, setModels] = useState<UploadedModelData[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  const addModel = useCallback((file: File) => {
    const id = crypto.randomUUID();
    const url = URL.createObjectURL(file);
    setModels(prev => [...prev, {
      id, url, name: file.name,
      metallic: 0.0, roughness: 0.5,
      transform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: 1 },
    }]);
    setSelectedModelId(id);
  }, []);

  const removeModel = useCallback((id: string) => {
    setModels(prev => {
      const m = prev.find(m => m.id === id);
      if (m) URL.revokeObjectURL(m.url);
      return prev.filter(m => m.id !== id);
    });
    setSelectedModelId(prev => prev === id ? null : prev);
  }, []);

  const updateModel = useCallback((id: string, patch: Partial<UploadedModelData>) => {
    setModels(prev => prev.map(m => m.id === id ? { ...m, ...patch } : m));
  }, []);

  const selectedModel = models.find(m => m.id === selectedModelId) ?? null;
  return { models, selectedModelId, setSelectedModelId, selectedModel, addModel, removeModel, updateModel };
}

// Individual model instance with click-to-select and TransformControls gizmo
function UploadedModelItem({
  model, isSelected, onSelect, gizmoMode, onTransformChange,
}: {
  model: UploadedModelData;
  isSelected: boolean;
  onSelect: () => void;
  gizmoMode: GizmoMode;
  onTransformChange: (t: UploadedModelData['transform']) => void;
}) {
  const gltf = useLoader(GLTFLoader, model.url);
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const tcRef = useRef<any>(null);
  const isDraggingRef = useRef(false);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);
  const { controls } = useThree();

  // Stable ref so gizmo listener doesn't need to re-attach on every render
  const onTransformChangeRef = useRef(onTransformChange);
  onTransformChangeRef.current = onTransformChange;

  // Animations
  useEffect(() => {
    if (!gltf || gltf.animations.length === 0) return;
    const mixer = new THREE.AnimationMixer(gltf.scene);
    gltf.animations.forEach(clip => mixer.clipAction(clip).play());
    mixerRef.current = mixer;
    return () => { mixer.stopAllAction(); mixerRef.current = null; };
  }, [gltf]);

  useFrame((_, delta) => { mixerRef.current?.update(delta); });

  // Material overrides
  useEffect(() => {
    if (!gltf) return;
    gltf.scene.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(mat => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.metalness = model.metallic;
          mat.roughness = model.roughness;
          mat.needsUpdate = true;
        }
      });
    });
  }, [gltf, model.metallic, model.roughness]);

  // Apply transform from state (for UI input changes); skip while gizmo is dragging
  useEffect(() => {
    if (!group || isDraggingRef.current) return;
    const DEG = Math.PI / 180;
    group.position.set(model.transform.position.x, model.transform.position.y, model.transform.position.z);
    group.rotation.set(
      model.transform.rotation.x * DEG,
      model.transform.rotation.y * DEG,
      model.transform.rotation.z * DEG,
    );
    group.scale.setScalar(model.transform.scale);
  }, [group, model.transform]);

  // Gizmo: disable OrbitControls while dragging; sync THREE object changes back to state
  useEffect(() => {
    const tc = tcRef.current;
    if (!tc || !isSelected || !group) return;

    const onDragging = (e: { value: boolean }) => {
      isDraggingRef.current = e.value;
      if (controls) (controls as any).enabled = !e.value;
    };

    const onObjectChange = () => {
      if (!group) return;
      const DEG = 180 / Math.PI;
      onTransformChangeRef.current({
        position: { x: +group.position.x.toFixed(3), y: +group.position.y.toFixed(3), z: +group.position.z.toFixed(3) },
        rotation: {
          x: +(group.rotation.x * DEG).toFixed(1),
          y: +(group.rotation.y * DEG).toFixed(1),
          z: +(group.rotation.z * DEG).toFixed(1),
        },
        scale: +group.scale.x.toFixed(3),
      });
    };

    tc.addEventListener('dragging-changed', onDragging);
    tc.addEventListener('objectChange', onObjectChange);
    return () => {
      tc.removeEventListener('dragging-changed', onDragging);
      tc.removeEventListener('objectChange', onObjectChange);
      if (controls) (controls as any).enabled = true;
    };
  }, [controls, isSelected, group]);

  return (
    <>
      <group ref={setGroup} onClick={e => { e.stopPropagation(); onSelect(); }}>
        <primitive object={gltf.scene} />
      </group>
      {isSelected && group && (
        <TransformControls ref={tcRef} object={group} mode={gizmoMode} />
      )}
    </>
  );
}

export function ModelsScene({
  models, selectedModelId, setSelectedModelId, gizmoMode, updateModel,
}: {
  models: UploadedModelData[];
  selectedModelId: string | null;
  setSelectedModelId: (id: string | null) => void;
  gizmoMode: GizmoMode;
  updateModel: (id: string, patch: Partial<UploadedModelData>) => void;
}) {
  return (
    <>
      {models.map(model => (
        <Suspense key={model.id} fallback={null}>
          <UploadedModelItem
            model={model}
            isSelected={model.id === selectedModelId}
            onSelect={() => setSelectedModelId(model.id)}
            gizmoMode={gizmoMode}
            onTransformChange={t => updateModel(model.id, { transform: t })}
          />
        </Suspense>
      ))}
    </>
  );
}
