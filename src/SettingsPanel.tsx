import { useState, useCallback, useEffect } from 'react';
import { parseAndConvert, type ThreeCamera } from './colmapCamera';
import type { GizmoMode, PrimitiveGeoType, ScenePrimitive } from './Primitives';
import type { UploadedModelData } from './UploadedModel';

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
    name: 'Bicycle',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bicycle/point_cloud/iteration_7000/point_cloud.ply',
    envDir: 'assets/bicycle',
  },
  {
    name: 'Bonsai',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/bonsai/point_cloud/iteration_7000/point_cloud.ply',
    envDir: 'assets/bonsai',
  },
  {
    name: 'Stump',
    url: 'https://huggingface.co/datasets/dylanebert/3dgs/resolve/main/stump/point_cloud/iteration_7000/point_cloud.ply',
    envDir: 'assets/stump',
  },
];

// ─── UI Primitives ────────────────────────────────────────────────────────────

function Section({ title, children, defaultOpen = true }: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border-b border-[#21262d]">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-[7px] bg-[#161b22] hover:bg-[#1c2128] transition-colors text-left cursor-pointer"
      >
        <span className={`shrink-0 w-[3px] h-3 rounded-full transition-all duration-200 ${open ? 'bg-[#1f6feb]' : 'bg-[#30363d]'}`} />
        <span className="flex-1 text-[10px] font-semibold text-[#7d8590] tracking-widest uppercase">{title}</span>
        <span className={`text-[8px] text-[#484f58] transition-transform duration-200 ${open ? '' : '-rotate-90'}`}>▼</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

function Row({ label, children, dot }: {
  label: string;
  children: React.ReactNode;
  dot?: string;
}) {
  return (
    <div className="flex items-center px-3 py-[5px] hover:bg-[#1c2128] transition-colors gap-2 min-h-[28px]">
      <div className="flex items-center gap-1.5 w-[40%] shrink-0">
        {dot && <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ backgroundColor: dot }} />}
        <span className="text-[11px] text-[#868e96] truncate leading-none">{label}</span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function ButtonGroup({ options, value, onChange }: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex rounded-[4px] overflow-hidden border border-[#30363d] bg-[#0d1117]">
      {options.map(opt => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`flex-1 py-[3px] px-2 text-[11px] transition-all duration-200 cursor-pointer ${
            value === opt
              ? 'bg-[#1f6feb] text-white'
              : 'text-[#484f58] hover:text-[#c9cdd3] hover:bg-[#1c2128]'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={value}
      onClick={() => onChange(!value)}
      className={`relative w-9 h-[18px] rounded-full transition-colors duration-300 cursor-pointer outline-none ${
        value ? 'bg-[#40c057]' : 'bg-[#21262d] ring-1 ring-inset ring-[#30363d]'
      }`}
    >
      <span className={`absolute top-[2px] left-[2px] w-[14px] h-[14px] rounded-full bg-white shadow-md transition-transform duration-300 ${
        value ? 'translate-x-[18px]' : 'translate-x-0'
      }`} />
    </button>
  );
}

function RangeSlider({ value, min, max, step, onChange, fmt }: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  fmt?: (v: number) => string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-2 w-full min-w-0">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 min-w-0 cursor-pointer appearance-none h-[3px] rounded-sm outline-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#4dabf7] [&::-webkit-slider-thumb]:cursor-pointer [&::-moz-range-thumb]:w-3 [&::-moz-range-thumb]:h-3 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#4dabf7] [&::-moz-range-thumb]:cursor-pointer [&::-moz-range-thumb]:border-0"
        style={{ background: `linear-gradient(to right, #1f6feb ${pct}%, #30363d ${pct}%)` }}
      />
      <span className="text-[11px] text-[#c9cdd3] font-mono w-8 text-right shrink-0">
        {fmt ? fmt(value) : value.toFixed(1)}
      </span>
    </div>
  );
}

function NumberSpin({ value, onChange, step = 0.1 }: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      step={step}
      onChange={e => onChange(Number(e.target.value))}
      className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#7c6af6] rounded-[3px] px-2 py-[2px] text-[11px] text-[#e6edf3] font-mono outline-none transition-colors"
    />
  );
}

function ColorPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 cursor-pointer" style={{ position: 'relative' }}>
      <div className="w-8 h-[18px] rounded-[2px] border border-[#30363d] shrink-0" style={{ backgroundColor: value }} />
      <span className="text-[11px] font-mono text-[#868e96]">{value.toUpperCase()}</span>
      <input
        type="color"
        value={value}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
      />
    </label>
  );
}

function DropDown<T extends number | string>({ value, options, onChange }: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  return (
    <select
      value={String(value)}
      onChange={e => {
        const raw = e.target.value;
        onChange((typeof value === 'number' ? Number(raw) : raw) as T);
      }}
      className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#7c6af6] rounded-[3px] px-2 py-[3px] text-[11px] text-[#e6edf3] outline-none cursor-pointer transition-colors"
    >
      {options.map(o => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  );
}

function UploadBtn({ label, accept, onFile }: {
  label: string;
  accept: string;
  onFile: (f: File) => void;
}) {
  return (
    <label className="flex items-center gap-2 w-full px-2 py-[6px] border border-dashed border-[#30363d] hover:border-[#58a6ff] rounded-[4px] text-[11px] text-[#7d8590] hover:text-[#e6edf3] transition-colors cursor-pointer bg-[#0d1117]">
      <span className="text-[#58a6ff] text-[14px] leading-none">+</span>
      <span>{label}</span>
      <input type="file" accept={accept} className="hidden" onChange={e => {
        const f = e.target.files?.[0];
        if (f) onFile(f);
        e.target.value = '';
      }} />
    </label>
  );
}

function FileChip({ name }: { name: string }) {
  if (!name) return null;
  return (
    <div className="flex items-center gap-1.5 px-2 py-0.5">
      <span className="w-[5px] h-[5px] rounded-full bg-[#40c057] shrink-0" />
      <span className="text-[10px] text-[#5c5f66] truncate">{name}</span>
    </div>
  );
}

function PanelBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 w-full px-3 py-[6px] border border-[#30363d] hover:border-[#58a6ff] rounded-[4px] text-[11px] text-[#7d8590] hover:text-[#e6edf3] transition-colors cursor-pointer bg-[#0d1117] group"
    >
      <span className="text-[#58a6ff] text-[13px] leading-none group-hover:scale-110 transition-transform">↗</span>
      <span>{children}</span>
    </button>
  );
}

function SubLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-3 pt-2 pb-[3px]">
      <span className="text-[9px] font-semibold text-[#484f58] uppercase tracking-widest">{children}</span>
    </div>
  );
}

function MaterialPreview({ color, metallic, roughness }: { color: string; metallic: number; roughness: number }) {
  // Simulate specular highlight: strong when metallic high, tight when roughness low
  const specularAlpha = metallic * (1 - roughness * 0.75);
  const highlightPct = Math.round(10 + (1 - roughness) * 28);
  return (
    <div
      className="relative w-[56px] h-[56px] rounded-full border border-[#30363d] overflow-hidden shrink-0"
      style={{ backgroundColor: color }}
    >
      {/* Edge darkening to simulate sphere curvature */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at 50% 50%, transparent 30%, rgba(0,0,0,0.72) 100%)'
      }} />
      {/* Specular highlight — upper-left */}
      <div className="absolute inset-0" style={{
        background: `radial-gradient(circle at 33% 28%, rgba(255,255,255,${(specularAlpha * 0.9).toFixed(2)}) 0%, transparent ${highlightPct}%)`
      }} />
      {/* Subtle secondary shadow — lower-right */}
      <div className="absolute inset-0" style={{
        background: 'radial-gradient(circle at 68% 72%, rgba(0,0,0,0.28) 0%, transparent 45%)'
      }} />
    </div>
  );
}

// ─── Settings Hook ────────────────────────────────────────────────────────────

export function useSettings() {
  const [sphereColor, setSphereColor] = useState('#ff0055');
  const [cameraPreset, setCameraPreset] = useState(0);
  const [sortMethod, setSortMethod] = useState<'CPU' | 'GPU'>('GPU');
  const [splatRadius, setSplatRadius] = useState(0.7);
  const [sceneIndex, setSceneIndex] = useState(2);
  const [debugDepth, setDebugDepth] = useState(false);
  const [shDegree, setShDegree] = useState(3);
  const [gaussianTransform, setGaussianTransform] = useState({
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
  });
  const [uploadedGaussianUrl, setUploadedGaussianUrl] = useState('');  
  const [uploadedGaussianName, setUploadedGaussianName] = useState('');
  const [cameraFrames, setCameraFrames] = useState<ThreeCamera[]>([]);
  const [cameraFrameIndex, setCameraFrameIndex] = useState(0);
  const [showDefaultScene, setShowDefaultScene] = useState(true);

  useEffect(() => () => { if (uploadedGaussianUrl) URL.revokeObjectURL(uploadedGaussianUrl); }, [uploadedGaussianUrl]);

  const loadGaussianPly = useCallback((file: File) => {
    const objectUrl = URL.createObjectURL(file);
    setUploadedGaussianUrl(prev => { if (prev) URL.revokeObjectURL(prev); return objectUrl; });
    setUploadedGaussianName(file.name);
  }, []);

  const loadCameraJson = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const frames = parseAndConvert(e.target?.result as string);
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

  const captureCanvasScreenshot = useCallback(() => {
    const canvas = document.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) return;
    canvas.toBlob(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `render-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, []);

  return {
    sphereColor, setSphereColor,
    cameraPreset, setCameraPreset,
    sortMethod, setSortMethod,
    splatRadius, setSplatRadius,
    sceneIndex, setSceneIndex,
    debugDepth, setDebugDepth,
    shDegree, setShDegree,
    gaussianTransform, setGaussianTransform,
    uploadedGaussianUrl, uploadedGaussianName,
    cameraFrames, cameraFrameIndex, setCameraFrameIndex,
    loadGaussianPly, loadCameraJson, clearCameraPath,
    captureCanvasScreenshot,
    showDefaultScene, setShowDefaultScene,
  };
}

// ─── Panel Component ──────────────────────────────────────────────────────────

type SettingsProps = ReturnType<typeof useSettings>;

type PrimitivesControlsProps = {
  addPrimitive: (type: PrimitiveGeoType) => void;
  deleteSelected: () => void;
  gizmoMode: GizmoMode;
  setGizmoMode: (mode: GizmoMode) => void;
  selectedPrimitive: ScenePrimitive | null;
  updatePrimitive: (id: string, patch: Partial<Pick<ScenePrimitive, 'color' | 'metallic' | 'roughness'>>) => void;
};

type ModelsControlsProps = {
  models: UploadedModelData[];
  selectedModel: UploadedModelData | null;
  setSelectedModelId: (id: string | null) => void;
  addModel: (file: File) => void;
  removeModel: (id: string) => void;
  updateModel: (id: string, patch: Partial<UploadedModelData>) => void;
};

export function SettingsPanel(props: SettingsProps & PrimitivesControlsProps & ModelsControlsProps) {
  const [collapsed, setCollapsed] = useState(false);
  const {
    sphereColor, setSphereColor,
    cameraPreset, setCameraPreset,
    sortMethod, setSortMethod,
    splatRadius, setSplatRadius,
    sceneIndex, setSceneIndex,
    debugDepth, setDebugDepth,
    shDegree, setShDegree,
    gaussianTransform, setGaussianTransform,
    showDefaultScene, setShowDefaultScene,
    uploadedGaussianName,
    loadGaussianPly,
    captureCanvasScreenshot,
    addPrimitive, deleteSelected, gizmoMode, setGizmoMode,
    selectedPrimitive, updatePrimitive,
    models, selectedModel, setSelectedModelId, addModel, removeModel, updateModel,
  } = props;

  const setPos = (axis: 'x' | 'y' | 'z', v: number) =>
    setGaussianTransform(p => ({ ...p, position: { ...p.position, [axis]: v } }));
  const setRot = (axis: 'x' | 'y' | 'z', v: number) =>
    setGaussianTransform(p => ({ ...p, rotation: { ...p.rotation, [axis]: v } }));

  return (
    <div className={`absolute right-0 top-0 h-full flex flex-col bg-[#0d1117] border-l border-[#21262d] z-20 font-sans select-none overflow-hidden transition-[width] duration-300 ease-in-out ${collapsed ? 'w-8' : 'w-[268px]'}`}>
      {/* Header */}
      <div className="shrink-0 h-9 flex items-center justify-between border-b border-[#21262d] bg-[#161b22] px-1.5">
        <span className={`text-[11px] font-semibold text-[#c9cdd3] tracking-wide ml-0.5 flex-1 overflow-hidden whitespace-nowrap transition-opacity duration-150 ${collapsed ? 'opacity-0' : 'opacity-100'}`}>
          Details
        </span>
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-6 h-6 shrink-0 flex items-center justify-center text-[#5c5f66] hover:text-[#c9cdd3] text-base rounded hover:bg-[#1c2128] transition-colors cursor-pointer"
          title={collapsed ? 'Expand panel' : 'Collapse panel'}
        >
          {collapsed ? '‹' : '›'}
        </button>
      </div>

      {/* Scrollable body */}
      <div className={`flex-1 overflow-y-auto [scrollbar-gutter:stable] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-[#30363d] [&::-webkit-scrollbar-thumb]:rounded-sm transition-opacity duration-150 ${collapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>

        <Section title="Render">
          <Row label="Sort Method">
            <ButtonGroup options={['CPU', 'GPU']} value={sortMethod} onChange={v => setSortMethod(v as 'CPU' | 'GPU')} />
          </Row>
          <Row label="SH Degree">
            <RangeSlider value={shDegree} min={0} max={3} step={1} onChange={setShDegree} fmt={v => String(v)} />
          </Row>
          <Row label="Splat Radius">
            <RangeSlider value={splatRadius} min={0.1} max={1} step={0.1} onChange={setSplatRadius} />
          </Row>
          <Row label="Debug Depth" dot={debugDepth ? '#40c057' : '#373a40'}>
            <Toggle value={debugDepth} onChange={setDebugDepth} />
          </Row>
        </Section>

        <Section title="Scene">
          <Row label="Gaussian">
            <DropDown
              value={sceneIndex}
              options={GAUSSIAN_SCENES.map((s, i) => ({ label: s.name, value: i }))}
              onChange={v => setSceneIndex(v)}
            />
          </Row>
          <Row label="Camera">
            <DropDown
              value={cameraPreset}
              options={CAMERA_PRESETS.map((p, i) => ({ label: p.name, value: i }))}
              onChange={v => setCameraPreset(v)}
            />
          </Row>
          <Row label="Default Scene">
            <ButtonGroup
              options={['on', 'off']}
              value={showDefaultScene ? 'on' : 'off'}
              onChange={v => setShowDefaultScene(v === 'on')}
            />
          </Row>
        </Section>

        <Section title="Gaussian Transform" defaultOpen={false}>
          <div className="flex items-center px-3 py-[5px] hover:bg-[#1c2128] transition-colors gap-2 min-h-[28px]">
            <span className="text-[11px] text-[#868e96] shrink-0 w-[64px]">Position</span>
            <div className="flex-1 flex gap-1 min-w-0">
              {(['x', 'y', 'z'] as const).map(ax => (
                <div key={ax} className="flex-1 flex items-center gap-0.5 min-w-0">
                  <span className="text-[9px] text-[#484f58] font-mono shrink-0">{ax.toUpperCase()}</span>
                  <NumberSpin value={gaussianTransform.position[ax]} onChange={v => setPos(ax, v)} step={0.1} />
                </div>
              ))}
            </div>
          </div>
          <div className="flex items-center px-3 py-[5px] hover:bg-[#1c2128] transition-colors gap-2 min-h-[28px]">
            <span className="text-[11px] text-[#868e96] shrink-0 w-[64px]">Rotation °</span>
            <div className="flex-1 flex gap-1 min-w-0">
              {(['x', 'y', 'z'] as const).map(ax => (
                <div key={ax} className="flex-1 flex items-center gap-0.5 min-w-0">
                  <span className="text-[9px] text-[#484f58] font-mono shrink-0">{ax.toUpperCase()}</span>
                  <NumberSpin value={gaussianTransform.rotation[ax]} onChange={v => setRot(ax, v)} step={1} />
                </div>
              ))}
            </div>
          </div>
          <div className="h-2" />
        </Section>

        <Section title="Primitives" defaultOpen={false}>
          <SubLabel>Add Object</SubLabel>
          <div className="px-3 py-2 grid grid-cols-3 gap-1">
            {(['box', 'sphere', 'cylinder', 'cone', 'torus'] as const).map(type => (
              <button
                key={type}
                onClick={() => addPrimitive(type)}
                className="py-[5px] px-1 bg-[#0d1117] border border-[#30363d] hover:border-[#58a6ff] rounded-[3px] text-[10px] text-[#7d8590] hover:text-[#e6edf3] transition-colors cursor-pointer capitalize"
              >
                {type}
              </button>
            ))}
            <button
              onClick={deleteSelected}
              className="col-span-3 py-[5px] px-2 bg-[#0d1117] border border-[#c92a2a]/40 hover:border-[#c92a2a] rounded-[3px] text-[10px] text-[#c92a2a]/70 hover:text-[#ff6b6b] transition-colors cursor-pointer"
            >
              Delete Selected
            </button>
          </div>
          <SubLabel>Gizmo Mode</SubLabel>
          <div className="px-3 pb-3">
            <ButtonGroup
              options={['translate', 'rotate', 'scale']}
              value={gizmoMode}
              onChange={v => setGizmoMode(v as GizmoMode)}
            />
          </div>
        </Section>

        {selectedPrimitive && (
          <Section title="Material">
            {/* Preview + meta */}
            <div className="px-3 pt-3 pb-2 flex items-center gap-3">
              <MaterialPreview
                color={selectedPrimitive.color}
                metallic={selectedPrimitive.metallic}
                roughness={selectedPrimitive.roughness}
              />
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-medium text-[#c9cdd3] capitalize">{selectedPrimitive.type}</span>
                <span className="text-[10px] text-[#484f58]">Standard Material</span>
                <div className="flex gap-1 mt-0.5">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-[2px] bg-[#161b22] border border-[#30363d] text-[#7d8590] font-mono">
                    M {selectedPrimitive.metallic.toFixed(2)}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-[2px] bg-[#161b22] border border-[#30363d] text-[#7d8590] font-mono">
                    R {selectedPrimitive.roughness.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mx-3 mb-2 h-px bg-[#21262d]" />
            <Row label="Base Color">
              <ColorPicker
                value={selectedPrimitive.color}
                onChange={c => updatePrimitive(selectedPrimitive.id, { color: c })}
              />
            </Row>
            <Row label="Metallic">
              <RangeSlider
                value={selectedPrimitive.metallic}
                min={0} max={1} step={0.01}
                onChange={v => updatePrimitive(selectedPrimitive.id, { metallic: v })}
              />
            </Row>
            <Row label="Roughness">
              <RangeSlider
                value={selectedPrimitive.roughness}
                min={0} max={1} step={0.01}
                onChange={v => updatePrimitive(selectedPrimitive.id, { roughness: v })}
              />
            </Row>
            <div className="h-2" />
          </Section>
        )}

        {selectedModel && (
          <Section title="Model Material">
            <div className="px-3 pt-3 pb-2 flex items-center gap-3">
              <MaterialPreview color="#888888" metallic={selectedModel.metallic} roughness={selectedModel.roughness} />
              <div className="flex flex-col gap-1 min-w-0">
                <span className="text-[11px] font-medium text-[#c9cdd3] truncate">{selectedModel.name}</span>
                <span className="text-[10px] text-[#484f58]">Material Override</span>
                <div className="flex gap-1 mt-0.5">
                  <span className="text-[9px] px-1.5 py-0.5 rounded-[2px] bg-[#161b22] border border-[#30363d] text-[#7d8590] font-mono">
                    M {selectedModel.metallic.toFixed(2)}
                  </span>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-[2px] bg-[#161b22] border border-[#30363d] text-[#7d8590] font-mono">
                    R {selectedModel.roughness.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
            <div className="mx-3 mb-2 h-px bg-[#21262d]" />
            <Row label="Metallic">
              <RangeSlider value={selectedModel.metallic} min={0} max={1} step={0.01}
                onChange={v => updateModel(selectedModel.id, { metallic: v })} />
            </Row>
            <Row label="Roughness">
              <RangeSlider value={selectedModel.roughness} min={0} max={1} step={0.01}
                onChange={v => updateModel(selectedModel.id, { roughness: v })} />
            </Row>
            <div className="h-2" />
          </Section>
        )}

        <Section title="Upload">
          <div className="px-3 py-2 space-y-1.5">
            <UploadBtn label="Gaussian PLY" accept=".ply" onFile={loadGaussianPly} />
            <FileChip name={uploadedGaussianName} />
          </div>
          <div className="px-3 py-2 space-y-1.5 border-t border-[#25262b]">
            <UploadBtn label="Add GLB Model" accept=".glb,.gltf" onFile={addModel} />
          </div>
          {models.length > 0 && (
            <div className="px-3 pb-2 flex flex-col gap-0.5">
              {models.map(m => (
                <div
                  key={m.id}
                  onClick={() => setSelectedModelId(selectedModel?.id === m.id ? null : m.id)}
                  className={`flex items-center gap-2 px-2 py-1 rounded-[3px] cursor-pointer transition-colors ${
                    selectedModel?.id === m.id
                      ? 'bg-[#1f6feb]/20 border border-[#1f6feb]/40'
                      : 'border border-transparent hover:bg-[#1c2128]'
                  }`}
                >
                  <span className={`w-[5px] h-[5px] rounded-full shrink-0 ${
                    selectedModel?.id === m.id ? 'bg-[#58a6ff]' : 'bg-[#484f58]'
                  }`} />
                  <span className="text-[10px] text-[#c9cdd3] truncate flex-1 font-mono">{m.name}</span>
                  <button
                    onClick={e => { e.stopPropagation(); removeModel(m.id); }}
                    className="text-[#484f58] hover:text-[#ff6b6b] text-[14px] font-bold cursor-pointer leading-none shrink-0"
                  >×</button>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Tools">
          <div className="px-3 py-2">
            <PanelBtn onClick={captureCanvasScreenshot}>Capture Screenshot</PanelBtn>
          </div>
        </Section>

      </div>
    </div>
  );
}
