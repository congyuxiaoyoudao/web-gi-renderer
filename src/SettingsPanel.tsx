import { useControls } from 'leva';

export const CAMERA_PRESETS = [
  { name: 'Front View', position: [0, 2, 8] },
  { name: 'Top Down', position: [0, 8, 0] },
  { name: 'Side View', position: [8, 2, 0] },
];

export const GAUSSIAN_SCENES = [
  { name: 'Food', url: 'assets/food.ply' },
  {
    name: 'Bicycle (HuggingFace)',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bicycle/point_cloud/iteration_7000/point_cloud.ply'
  },
  {
    name: 'Bonsai (HuggingFace)',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/point_cloud/iteration_7000/point_cloud.ply'
  },
  {
    name: 'Stump (HuggingFace)',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/stump/point_cloud/iteration_7000/point_cloud.ply'
  },
];

export function useSettings() {
  const { sphereColor, cameraPreset, splatRadius, sceneIndex, debugDepth } = useControls({
    sphereColor: {
      value: '#ff0055',
      label: 'Sphere Color',
    },
    cameraPreset: {
      value: 0,
      options: CAMERA_PRESETS.reduce((acc, preset, index) => {
        acc[preset.name] = index;
        return acc;
      }, {} as Record<string, number>),
      label: 'Camera Position',
    },
    splatRadius: {
      value: 0.7,
      min: 0.1,
      max: 1,
      step: 0.1,
      label: 'Splat Radius',
    },
    sceneIndex: {
      value: 0,
      options: GAUSSIAN_SCENES.reduce((acc, scene, index) => {
        acc[scene.name] = index;
        return acc;
      }, {} as Record<string, number>),
      label: 'Gaussian Scene',
    },
    debugDepth: {
      value: false,
      label: 'Debug Depth',
    },
  });

  return { sphereColor, cameraPreset, splatRadius, sceneIndex, debugDepth };
}
