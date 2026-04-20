import * as THREE from 'three';

export interface ColmapCamera {
  id: number;
  img_name: string;
  width: number;
  height: number;
  position: [number, number, number];
  rotation: [[number, number, number], [number, number, number], [number, number, number]];
  fx: number;
  fy: number;
}

export interface ThreeCamera {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
  name: string;
}

export function parseColmapCameras(jsonString: string): ColmapCamera[] {
  const data = JSON.parse(jsonString);
  if (!Array.isArray(data)) {
    throw new Error('Invalid cameras.json: expected an array');
  }
  return data as ColmapCamera[];
}

export function colmapToThreeCamera(cam: ColmapCamera): ThreeCamera {
  // Convert position: flip Y and Z
  const position = new THREE.Vector3(
    cam.position[0],
    -cam.position[1],
    -cam.position[2]
  );

  // Convert rotation matrix: R_three = diag(1,-1,-1) * R_colmap * diag(1,-1,-1)
  const R = cam.rotation;
  const m = new THREE.Matrix4();
  m.set(
     R[0][0], -R[0][1], -R[0][2], 0,
    -R[1][0],  R[1][1],  R[1][2], 0,
    -R[2][0],  R[2][1],  R[2][2], 0,
     0,        0,        0,       1
  );

  const rotMatrix = new THREE.Matrix4().copy(m).invert();
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(rotMatrix);

  // Convert focal length to vertical FOV
  // fov = 2 * atan(height / (2 * fy))
  const fov = 2 * Math.atan(cam.height / (2 * cam.fy)) * (180 / Math.PI);

  return {
    position,
    quaternion,
    fov,
    name: cam.img_name
  };
}

export function parseAndConvert(jsonString: string): ThreeCamera[] {
  const colmapCameras = parseColmapCameras(jsonString);
  return colmapCameras.map(colmapToThreeCamera);
}
