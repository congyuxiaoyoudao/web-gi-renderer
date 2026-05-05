import { useRef, useState, useEffect, useCallback } from 'react';
import { useControls, button } from 'leva';
import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

export type PrimitiveGeoType = 'box' | 'sphere' | 'cylinder' | 'cone' | 'torus';
export type GizmoMode = 'translate' | 'rotate' | 'scale';

export interface ScenePrimitive {
  id: string;
  type: PrimitiveGeoType;
  color: string;
}

export function usePrimitives() {
  const [primitives, setPrimitives] = useState<ScenePrimitive[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Use a ref to avoid stale closure in Leva button handlers
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const addPrimitive = useCallback((type: PrimitiveGeoType) => {
    const id = crypto.randomUUID();
    setPrimitives((prev) => [...prev, { id, type, color: '#aaaaaa' }]);
    setSelectedId(id);
  }, []);

  const { gizmoMode } = useControls('Primitives', {
    addBox: button(() => addPrimitive('box')),
    addSphere: button(() => addPrimitive('sphere')),
    addCylinder: button(() => addPrimitive('cylinder')),
    addCone: button(() => addPrimitive('cone')),
    addTorus: button(() => addPrimitive('torus')),
    deleteSelected: button(() => {
      setPrimitives((prev) => prev.filter((p) => p.id !== selectedIdRef.current));
      setSelectedId(null);
    }),
    gizmoMode: {
      value: 'translate',
      options: { Translate: 'translate', Rotate: 'rotate', Scale: 'scale' },
      label: 'Gizmo Mode',
    },
  });

  return { primitives, selectedId, setSelectedId, gizmoMode: gizmoMode as GizmoMode };
}

// Individual primitive with its own gizmo when selected
function PrimitiveItem({
  primitive,
  isSelected,
  onSelect,
  gizmoMode,
}: {
  primitive: ScenePrimitive;
  isSelected: boolean;
  onSelect: () => void;
  gizmoMode: GizmoMode;
}) {
  // useState ref pattern: triggers re-render so TransformControls can mount with a valid object
  const [group, setGroup] = useState<THREE.Group | null>(null);
  const tcRef = useRef<any>(null);
  const { controls } = useThree();

  // Disable OrbitControls while dragging gizmo to prevent conflicts
  useEffect(() => {
    const tc = tcRef.current;
    if (!tc || !isSelected || !group) return;

    const onDragging = (e: { value: boolean }) => {
      if (controls) (controls as any).enabled = !e.value;
    };

    tc.addEventListener('dragging-changed', onDragging);
    return () => {
      tc.removeEventListener('dragging-changed', onDragging);
      // Re-enable when gizmo unmounts
      if (controls) (controls as any).enabled = true;
    };
  }, [controls, isSelected, group]);

  return (
    <>
      <group
        ref={setGroup}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
      >
        <mesh castShadow receiveShadow>
          {primitive.type === 'box' && <boxGeometry args={[1, 1, 1]} />}
          {primitive.type === 'sphere' && <sphereGeometry args={[0.5, 32, 32]} />}
          {primitive.type === 'cylinder' && <cylinderGeometry args={[0.5, 0.5, 1, 32]} />}
          {primitive.type === 'cone' && <coneGeometry args={[0.5, 1, 32]} />}
          {primitive.type === 'torus' && <torusGeometry args={[0.4, 0.15, 16, 64]} />}
          <meshStandardMaterial
            color={primitive.color}
            roughness={0.5}
            metalness={0.2}
            emissive={isSelected ? '#1c1c1c' : '#000000'}
          />
        </mesh>
      </group>

      {/* Mount TransformControls only when this item is selected and ref is ready */}
      {isSelected && group && (
        <TransformControls ref={tcRef} object={group} mode={gizmoMode} />
      )}
    </>
  );
}

export function PrimitivesScene({
  primitives,
  selectedId,
  setSelectedId,
  gizmoMode,
}: {
  primitives: ScenePrimitive[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  gizmoMode: GizmoMode;
}) {
  return (
    <>
      {primitives.map((primitive) => (
        <PrimitiveItem
          key={primitive.id}
          primitive={primitive}
          isSelected={selectedId === primitive.id}
          onSelect={() => setSelectedId(primitive.id)}
          gizmoMode={gizmoMode}
        />
      ))}
    </>
  );
}
