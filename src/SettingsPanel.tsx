import { useControls, button, folder } from 'leva';
import { useState, useCallback, useEffect } from 'react';
import { parseAndConvert, type ThreeCamera } from './colmapCamera';

export const CAMERA_PRESETS = [
  { name: 'Front View', position: [0, 2, 8] },
  { name: 'Top Down', position: [0, 8, 0] },
  { name: 'Side View', position: [8, 2, 0] },
];

export const GAUSSIAN_SCENES = [
  { name: 'None', url: '', envDir: 'assets/bicycle' },
  { name: 'Custom', url: '__custom__', envDir: 'assets/bicycle' },
  { name: 'Food', url: 'assets/food.ply', envDir: 'assets/bicycle' },
  {
    name: 'Bicycle (HuggingFace)',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bicycle/point_cloud/iteration_7000/point_cloud.ply',
    envDir: 'assets/bicycle',
  },
  {
    name: 'Bonsai (HuggingFace)',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/point_cloud/iteration_7000/point_cloud.ply',
    envDir: 'assets/bonsai',
  },
  {
    name: 'Stump (HuggingFace)',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/stump/point_cloud/iteration_7000/point_cloud.ply',
    envDir: 'assets/stump',
  },
];


export function useSettings() {
  const captureCanvasScreenshot = useCallback(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      console.warn('No canvas found for screenshot capture');
      return;
    }

    canvas.toBlob((blob) => {
      if (!blob) {
        console.warn('Failed to capture canvas screenshot');
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      link.href = url;
      link.download = `canvas-color-${timestamp}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, []);

  const { sphereColor, cameraPreset, sortMethod, splatRadius, sceneIndex, debugDepth, shDegree } = useControls({
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
    sortMethod: {
      value: 'GPU',
      options: ['CPU', 'GPU'],
      label: 'Sort Method',
    },
    splatRadius: {
      value: 0.7,
      min: 0.1,
      max: 1,
      step: 0.1,
      label: 'Splat Radius',
    },
    sceneIndex: {
      value: 2,
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
    shDegree: {
      value: 3,
      min: 0,
      max: 3,
      step: 1,
      label: 'SH Degree',
    },
  });

  const [uploadedGaussianUrl, setUploadedGaussianUrl] = useState('');
  const [uploadedGaussianName, setUploadedGaussianName] = useState('');

  const loadGaussianPly = useCallback((file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setUploadedGaussianUrl((previousUrl) => {
      if (previousUrl) {
        URL.revokeObjectURL(previousUrl);
      }
      return objectUrl;
    });
    setUploadedGaussianName(file.name);
  }, []);

  useEffect(() => {
    return () => {
      if (uploadedGaussianUrl) {
        URL.revokeObjectURL(uploadedGaussianUrl);
      }
    };
  }, [uploadedGaussianUrl]);

  const [, setUploadControls] = useControls(() => ({
    gaussianUpload: folder({
      uploadGaussianPly: button(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.ply';
        input.onchange = () => {
          const file = input.files?.[0];
          if (file) loadGaussianPly(file);
        };
        input.click();
      }),
      customGaussianFile: {
        value: 'No file loaded',
        editable: false,
        label: 'Custom PLY',
      },
    }, {
      order: 999,
    }),
  }), [loadGaussianPly]);

  useEffect(() => {
    setUploadControls({ customGaussianFile: uploadedGaussianName || 'No file loaded' });
  }, [uploadedGaussianName, setUploadControls]);

  const [uploadedModelUrl, setUploadedModelUrl] = useState('');
  const [uploadedModelName, setUploadedModelName] = useState('');

  const loadModel = useCallback((file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setUploadedModelUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return objectUrl; });
    setUploadedModelName(file.name);
  }, []);

  useEffect(() => {
    return () => { if (uploadedModelUrl) URL.revokeObjectURL(uploadedModelUrl); };
  }, [uploadedModelUrl]);

  const [, setModelControls] = useControls(() => ({
    modelUpload: folder({
      uploadModel: button(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.glb';
        input.onchange = () => { const f = input.files?.[0]; if (f) loadModel(f); };
        input.click();
      }),
      uploadedModelFile: { value: 'No model loaded', editable: false, label: 'Model' },
    }, { order: 1000 }),
  }), [loadModel]);

  useEffect(() => {
    setModelControls({ uploadedModelFile: uploadedModelName || 'No model loaded' });
  }, [uploadedModelName, setModelControls]);

  useControls(() => ({
    capture: folder({
      captureCanvasColor: button(() => {
        captureCanvasScreenshot();
      }),
    }, { order: 1001 }),
  }), [captureCanvasScreenshot]);

  const gaussianTransform = useControls('Gaussian Transform', {
    position: {
      value: { x: 0, y: 0, z: 0 },
      step: 0.1,
      label: 'Position',
    },
    rotation: {
      value: { x: 0, y: 0, z: 0 },
      min: -180,
      max: 180,
      step: 1,
      label: 'Rotation (°)',
    },
  });

  // Camera path state (managed outside Leva)
  const [cameraFrames, setCameraFrames] = useState<ThreeCamera[]>([]);
  const [cameraFrameIndex, setCameraFrameIndex] = useState(0);

  const loadCameraJson = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        const frames = parseAndConvert(text);
        setCameraFrames(frames);
        setCameraFrameIndex(0);
      } catch (err) {
        console.error('Failed to parse cameras.json:', err);
      }
    };
    reader.readAsText(file);
  }, []);

  const clearCameraPath = useCallback(() => {
    setCameraFrames([]);
    setCameraFrameIndex(0);
  }, []);

  return {
    sphereColor, cameraPreset, sortMethod, splatRadius, sceneIndex, debugDepth, shDegree, gaussianTransform,
    uploadedGaussianUrl,
    uploadedModelUrl,
    cameraFrames, cameraFrameIndex, setCameraFrameIndex, loadCameraJson, clearCameraPath
  };
}
