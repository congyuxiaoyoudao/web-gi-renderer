import { useControls } from 'leva';

export const CAMERA_PRESETS = [
  { name: 'Front View', position: [0, 2, 8] },
  { name: 'Top Down', position: [0, 8, 0] },
  { name: 'Side View', position: [8, 2, 0] },
];

export function useSettings() {
  const { sphereColor, cameraPreset } = useControls({
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
  });

  return { sphereColor, cameraPreset };
}
