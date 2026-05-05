import { useEffect, useRef } from 'react';
import { useLoader } from '@react-three/fiber';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as THREE from 'three';

interface UploadedModelProps {
  url: string;
}

export function UploadedModel({ url }: UploadedModelProps) {
  const gltf = useLoader(GLTFLoader, url);
  const mixerRef = useRef<THREE.AnimationMixer | null>(null);

  useEffect(() => {
    if (!gltf || gltf.animations.length === 0) return;

    const mixer = new THREE.AnimationMixer(gltf.scene);
    gltf.animations.forEach((clip) => mixer.clipAction(clip).play());
    mixerRef.current = mixer;

    return () => {
      mixerRef.current?.stopAllAction();
      mixerRef.current = null;
    };
  }, [gltf]);

  return <primitive object={gltf.scene} />;
}
