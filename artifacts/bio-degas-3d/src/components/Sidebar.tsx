import { calculateWaterMatchedOutletLength, PIPE_FACES, type PipeFace, useStore, useValidation, ProjectState } from '@/store/useStore';
import { Settings, Save, FolderOpen, RefreshCcw, AlertTriangle, AlertCircle, CheckCircle2, Download, Camera, Plus, Trash2, Eye, CircleDot } from 'lucide-react';
import { useState, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';

export function Sidebar() {
  const store = useStore();
  const validation = useValidation();
  const [activeTab, setActiveTab] = useState<'params' | 'saves'>('params');

  const handleParamChange = (key: keyof ProjectState, value: number) => {
    store.updateParams({ [key]: value });
  };

  return (
    <div className="w-80 h-full bg-card border-r border-border flex flex-col shadow-lg z-10 relative">
      <div className="p-4 border-b border-border bg-sidebar-primary text-sidebar-primary-foreground">
        <h1 className="text-xl font-bold tracking-tight">Bio/Degas 3D</h1>
        <p className="text-xs opacity-80 mt-1 font-mono">Reference Case Coordination</p>
      </div>

      <div className="flex border-b border-border text-sm">
        <button 
          className={`flex-1 py-2 font-medium ${activeTab === 'params' ? 'bg-accent text-accent-foreground border-b-2 border-primary' : 'text-muted-foreground hover:bg-muted'}`}
          onClick={() => setActiveTab('params')}
        >
          <div className="flex items-center justify-center gap-2"><Settings size={16} /> Parameters</div>
        </button>
        <button 
          className={`flex-1 py-2 font-medium ${activeTab === 'saves' ? 'bg-accent text-accent-foreground border-b-2 border-primary' : 'text-muted-foreground hover:bg-muted'}`}
          onClick={() => setActiveTab('saves')}
        >
          <div className="flex items-center justify-center gap-2"><FolderOpen size={16} /> Data & Saves</div>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {activeTab === 'params' ? (
          <>
            <Section title="External Envelope (mm)">
              <NumberInput label="Length" value={store.envelope.length} onChange={(v) => store.updateParams({ envelope: { ...store.envelope, length: v } })} />
              <NumberInput label="Width" value={store.envelope.width} onChange={(v) => store.updateParams({ envelope: { ...store.envelope, width: v } })} />
              <NumberInput label="Height" value={store.envelope.height} onChange={(v) => store.updateParams({ envelope: { ...store.envelope, height: v } })} />
            </Section>
            
            <Section title="Internal Constraints (mm)">
              <NumberInput label="Wall Thickness" value={store.wallThickness} onChange={(v) => handleParamChange('wallThickness', v)} />
              <NumberInput label="Access Min Length" value={store.accessMin} onChange={(v) => handleParamChange('accessMin', v)} />
              <NumberInput label="Water Level" value={store.waterLevel} onChange={(v) => handleParamChange('waterLevel', v)} />
            </Section>

            <Section title="Media Coordination">
              <NumberInput label="Required Crates" value={store.requiredCrates} onChange={(v) => handleParamChange('requiredCrates', v)} />
              <div className="grid grid-cols-2 gap-2 mt-2">
                <NumberInput label="Rows" value={store.rows} min={1} max={4} onChange={(v) => handleParamChange('rows', v)} />
                <NumberInput label="Nominal Stack" value={store.nominalStackHeight} min={1} max={6} onChange={(v) => handleParamChange('nominalStackHeight', v)} />
              </div>
              <label className="block text-sm font-medium text-muted-foreground">
                Stack count datum
                <select
                  value={store.stackFillDirection}
                  onChange={(event) => store.updateParams({ stackFillDirection: event.target.value as 'bottom' | 'top' })}
                  data-testid="select-stack-fill-direction"
                  className="mt-1 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="bottom">Bottom-up · floor supported</option>
                  <option value="top">Top-down · align to water level</option>
                </select>
              </label>
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                Top-down stacks use support bracing below the lowest crate where clear water space remains.
              </p>
            </Section>

            <Section title="Dispersion Trays">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Tray items</p>
                  <p className="text-xs text-muted-foreground">{store.trays.length} configured · max 4</p>
                </div>
                <button
                  type="button"
                  onClick={store.addTray}
                  disabled={store.trays.length >= 4}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-semibold text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Plus size={14} /> Add tray
                </button>
              </div>
              <div className="space-y-2">
                {store.trays.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                    No trays configured. Add a tray item to place dispersion equipment.
                  </div>
                ) : (
                  store.trays.map((tray, index) => (
                    <TrayItem
                      key={tray.id}
                      tray={tray}
                      index={index}
                      store={store}
                    />
                  ))
                )}
              </div>
              <div className="pt-1">
                <NumberInput label="Required gap (mm)" value={store.trayGap} min={0} onChange={(v) => handleParamChange('trayGap', v)} />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="explorationMode" 
                  checked={store.trayExplorationMode}
                  onChange={(e) => store.updateParams({ trayExplorationMode: e.target.checked })}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <label htmlFor="explorationMode" className="text-sm font-medium cursor-pointer">Allow free exploration (Disable snap)</label>
              </div>
            </Section>

            <Section title="Pipe Connections">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-foreground">Connection points</p>
                  <p className="text-xs text-muted-foreground">{store.pipeConnections.length} modelled</p>
                </div>
                <button
                  type="button"
                  onClick={store.addPipeConnection}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-500/20"
                >
                  <Plus size={14} /> Add point
                </button>
              </div>
              <div className="space-y-2">
                {store.pipeConnections.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-3 text-xs text-muted-foreground">
                    No pipe connections configured.
                  </div>
                ) : (
                  store.pipeConnections.map(connection => (
                    <PipeConnectionItem
                      key={connection.id}
                      connection={connection}
                      store={store}
                    />
                  ))
                )}
              </div>
            </Section>
          </>
        ) : (
          <SaveManager />
        )}
      </div>

      <div className="border-t border-border p-4 bg-muted/30">
        <StatusPanel validation={validation} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-bold text-foreground border-b border-border pb-1 uppercase tracking-wider">{title}</h3>
      <div className="space-y-2">
        {children}
      </div>
    </div>
  );
}

function NumberInput({ label, value, onChange, min, max }: { label: string, value: number, onChange: (v: number) => void, min?: number, max?: number }) {
  return (
    <div className="flex items-center justify-between">
      <label className="text-sm font-medium text-muted-foreground">{label}</label>
      <input 
        type="number" 
        value={value} 
        onChange={(e) => onChange(Number(e.target.value))} 
        min={min}
        max={max}
        className="w-24 px-2 py-1 text-right text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent font-mono"
      />
    </div>
  );
}

function TrayItem({
  tray,
  index,
  store,
}: {
  tray: ProjectState['trays'][number];
  index: number;
  store: ProjectState;
}) {
  const internalLength = store.envelope.length - store.wallThickness * 2;
  const previousTray = store.trays[index - 1];
  const gap = previousTray
    ? tray.x - (previousTray.x + previousTray.length)
    : null;
  const outOfBounds = tray.x < store.accessMin || tray.x + tray.length > internalLength;
  const overlaps = gap !== null && gap < 0;
  const status = outOfBounds ? 'OUT OF BOUNDS' : overlaps ? 'OVERLAPS' : 'VALID';
  const statusClass = status === 'VALID'
    ? 'text-emerald-700 bg-emerald-50 border-emerald-200'
    : 'text-red-700 bg-red-50 border-red-200';

  return (
    <div className={`rounded-md border p-2.5 ${store.selectedId === tray.id ? 'border-primary bg-primary/5' : 'border-border bg-muted/20'}`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => store.setSelectedId(tray.id)}
          className="flex min-w-0 items-start gap-2 text-left"
        >
          <Eye size={15} className="mt-0.5 shrink-0 text-[#9333ea]" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold uppercase tracking-wide text-foreground">Tray {index + 1}</span>
            <span className="block font-mono text-[10px] text-muted-foreground">{tray.length} × {tray.width} × {tray.height} mm</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => store.removeTray(tray.id)}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title={`Remove tray ${index + 1}`}
          aria-label={`Remove tray ${index + 1}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label htmlFor={`tray-position-${tray.id}`} className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">X</label>
        <input
          id={`tray-position-${tray.id}`}
          type="number"
          value={Math.round(tray.x)}
          onChange={(event) => store.updateTrayPosition(tray.id, Number(event.target.value))}
          className="min-w-0 flex-1 rounded border border-input bg-background px-2 py-1 text-right font-mono text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <span className="text-[10px] text-muted-foreground">mm</span>
        <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold ${statusClass}`}>{status}</span>
      </div>
      {gap !== null && (
        <p className={`mt-1 text-[10px] ${Math.abs(gap - store.trayGap) <= 1 ? 'text-muted-foreground' : 'text-amber-700'}`}>
          Gap to previous: {Math.round(gap)} mm
        </p>
      )}
      <p className="mt-1 text-[10px] text-muted-foreground">Top datum: flush with tank top</p>
      <details className="mt-2 rounded border border-border bg-background/60 px-2 py-1.5">
        <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-wide text-foreground">
          Construction details
        </summary>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <CompactTrayInput label="Length" value={tray.length} onChange={(length) => store.updateTray(tray.id, { length })} />
          <CompactTrayInput label="Width" value={tray.width} onChange={(width) => store.updateTray(tray.id, { width })} />
          <CompactTrayInput label="Height" value={tray.height} onChange={(height) => store.updateTray(tray.id, { height })} />
          <CompactTrayInput label="Frame width" value={tray.frameWidth ?? 80} onChange={(frameWidth) => store.updateTray(tray.id, { frameWidth })} />
          <CompactTrayInput label="Side channel" value={tray.sideChannelWidth ?? 360} onChange={(sideChannelWidth) => store.updateTray(tray.id, { sideChannelWidth })} />
          <CompactTrayInput label="Divider height" value={tray.dividerHeight ?? 420} onChange={(dividerHeight) => store.updateTray(tray.id, { dividerHeight })} />
          <CompactTrayInput label="Panel thickness" value={tray.panelThickness ?? 40} onChange={(panelThickness) => store.updateTray(tray.id, { panelThickness })} />
          <CompactTrayInput label="Hole Ø" value={tray.perforationDiameter ?? 35} onChange={(perforationDiameter) => store.updateTray(tray.id, { perforationDiameter })} />
          <CompactTrayInput label="Hole rows" value={tray.perforationRows ?? 5} unit="" min={1} onChange={(perforationRows) => store.updateTray(tray.id, { perforationRows: Math.round(perforationRows) })} />
          <CompactTrayInput label="Hole columns" value={tray.perforationColumns ?? 12} unit="" min={1} onChange={(perforationColumns) => store.updateTray(tray.id, { perforationColumns: Math.round(perforationColumns) })} />
        </div>
        <p className="mt-2 text-[9px] leading-relaxed text-muted-foreground">
          Estimated defaults from the supplied tray reference. Replace with fabrication dimensions when available.
        </p>
      </details>
    </div>
  );
}

function CompactTrayInput({
  label,
  value,
  onChange,
  min = 1,
  unit = 'mm',
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  unit?: string;
}) {
  return (
    <label className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <div className="mt-1 flex items-center rounded border border-input bg-background">
        <input
          type="number"
          value={value}
          min={min}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent px-1.5 py-1 text-right font-mono text-[10px] text-foreground focus:outline-none"
        />
        {unit && <span className="pr-1 text-[8px] font-normal normal-case text-muted-foreground">{unit}</span>}
      </div>
    </label>
  );
}

function PipeConnectionItem({
  connection,
  store,
}: {
  connection: ProjectState['pipeConnections'][number];
  store: ProjectState;
}) {
  const internalLength = store.envelope.length - store.wallThickness * 2;
  const internalWidth = store.envelope.width - store.wallThickness * 2;
  const internalHeight = store.envelope.height - store.wallThickness;
  const limits = connection.face === 'access' || connection.face === 'rear'
    ? { x: internalWidth, y: internalHeight }
    : connection.face === 'left' || connection.face === 'right'
      ? { x: internalLength, y: internalHeight }
      : { x: internalLength, y: internalWidth };
  const valid = connection.diameter > 0
    && connection.x >= 0
    && connection.x <= limits.x
    && connection.y >= 0
    && connection.y <= limits.y;
  const waterMatchedLength = calculateWaterMatchedOutletLength(
    connection,
    store.envelope,
    store.wallThickness,
    store.waterLevel,
  );

  return (
    <div className={`rounded-md border p-2.5 ${store.selectedId === connection.id ? 'border-amber-500 bg-amber-500/5' : 'border-border bg-muted/20'}`}>
      <div className="flex items-start justify-between gap-2">
        <button
          type="button"
          onClick={() => store.setSelectedId(connection.id)}
          className="flex min-w-0 items-start gap-2 text-left"
        >
          <CircleDot size={15} className="mt-0.5 shrink-0 text-amber-600" />
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold uppercase tracking-wide text-foreground">{connection.name}</span>
            <span className="block text-[10px] text-muted-foreground">Coring Ø{connection.coringDiameter ?? connection.diameter + 70} · Pipe Ø{connection.diameter}</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => store.removePipeConnection(connection.id)}
          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          title={`Remove ${connection.name}`}
          aria-label={`Remove ${connection.name}`}
        >
          <Trash2 size={14} />
        </button>
      </div>
      <div className="mt-2 space-y-2">
        <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Selected face
          <select
            value={connection.face}
            onChange={(event) => store.updatePipeConnection(connection.id, { face: event.target.value as PipeFace })}
            className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {PIPE_FACES.map(face => (
              <option key={face.value} value={face.value}>{face.label}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <CompactPipeInput
            label="Coring Ø"
            value={connection.coringDiameter ?? connection.diameter + 70}
            min={1}
            onChange={(coringDiameter) => store.updatePipeConnection(connection.id, { coringDiameter })}
          />
          <CompactPipeInput
            label="Pipe Ø"
            value={connection.diameter}
            min={1}
            onChange={(diameter) => store.updatePipeConnection(connection.id, { diameter })}
          />
          <CompactPipeInput
            label="Stub length"
            value={connection.pipeLength}
            min={1}
            onChange={(pipeLength) => store.updatePipeConnection(connection.id, { pipeLength })}
          />
          <CompactPipeInput
            label="Pipe 2 length"
            value={connection.matchWaterLevel && waterMatchedLength !== null
              ? Math.round(waterMatchedLength)
              : connection.outletPipeLength ?? 800}
            min={1}
            disabled={connection.matchWaterLevel}
            onChange={(outletPipeLength) => store.updatePipeConnection(connection.id, { outletPipeLength })}
          />
          <CompactPipeInput
            label="Elbow rotation"
            value={connection.elbowRotation ?? 0}
            min={-180}
            max={180}
            unit="deg"
            onChange={(elbowRotation) => store.updatePipeConnection(connection.id, { elbowRotation })}
          />
          <CompactPipeInput
            label="Face X"
            value={connection.x}
            min={0}
            max={limits.x}
            onChange={(x) => store.updatePipeConnection(connection.id, { x })}
          />
          <CompactPipeInput
            label="Face Y"
            value={connection.y}
            min={0}
            max={limits.y}
            onChange={(y) => store.updatePipeConnection(connection.id, { y })}
          />
        </div>
        <label className="flex items-start gap-2 rounded border border-sky-500/20 bg-sky-500/5 px-2 py-2 text-[10px] text-foreground">
          <input
            type="checkbox"
            checked={connection.matchWaterLevel ?? false}
            onChange={(event) => store.updatePipeConnection(connection.id, { matchWaterLevel: event.target.checked })}
            className="mt-0.5 rounded border-border text-sky-600 focus:ring-sky-500"
          />
          <span>
            <span className="block font-semibold">Match Pipe 2 endpoint to water level</span>
            <span className="text-muted-foreground">
              {connection.matchWaterLevel
                ? waterMatchedLength !== null
                  ? `Auto length: ${Math.round(waterMatchedLength)} mm`
                  : 'Rotate the elbow so Pipe 2 intersects the water plane.'
                : 'Use the manual Pipe 2 length.'}
            </span>
          </span>
        </label>
        <div className="flex items-center justify-between text-[10px]">
          <button
            type="button"
            onClick={() => store.setSelectedId(connection.id)}
            className="inline-flex items-center gap-1 font-semibold text-primary hover:underline"
          >
            <Eye size={12} /> Inspect geometry
          </button>
          <span className={`rounded border px-1.5 py-0.5 font-bold ${valid ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
            {valid ? 'ON FACE' : 'OUT OF FACE'}
          </span>
        </div>
      </div>
    </div>
  );
}

function CompactPipeInput({
  label,
  value,
  onChange,
  min,
  max,
  unit = 'mm',
  disabled = false,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  unit?: string;
  disabled?: boolean;
}) {
  return (
    <label className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {label}
      <div className="mt-1 flex items-center rounded border border-input bg-background">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
          className="min-w-0 flex-1 bg-transparent px-2 py-1 text-right font-mono text-xs text-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-55"
        />
        <span className="pr-1.5 text-[9px] font-normal normal-case text-muted-foreground">{unit}</span>
      </div>
    </label>
  );
}

function StatusPanel({ validation }: { validation: ReturnType<typeof useValidation> }) {
  const { isValid, errors, warnings } = validation;
  
  if (isValid && warnings.length === 0) {
    return (
      <div className="flex items-start gap-3 text-success">
        <CheckCircle2 className="mt-0.5 shrink-0" size={18} />
        <div>
          <p className="text-sm font-bold">Coordination Valid</p>
          <p className="text-xs opacity-90">All constraints met.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!isValid && (
        <div className="flex items-start gap-3 text-destructive">
          <AlertCircle className="mt-0.5 shrink-0" size={18} />
          <div>
            <p className="text-sm font-bold">Errors ({errors.length})</p>
            <ul className="text-xs mt-1 space-y-1 opacity-90 list-disc pl-3">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </div>
        </div>
      )}
      
      {warnings.length > 0 && (
        <div className="flex items-start gap-3 text-amber-600 dark:text-amber-500">
          <AlertTriangle className="mt-0.5 shrink-0" size={18} />
          <div>
            <p className="text-sm font-bold">Warnings ({warnings.length})</p>
            <ul className="text-xs mt-1 space-y-1 opacity-90 list-disc pl-3">
              {warnings.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function SaveManager() {
  const store = useStore();
  const [saves, setSaves] = useState<Array<{ id: string, name: string, date: string }>>([]);
  const [saveName, setSaveName] = useState("");

  useEffect(() => {
    loadSaveList();
  }, []);

  const loadSaveList = () => {
    const list = JSON.parse(localStorage.getItem('biodegas_saves') || '[]');
    setSaves(list);
  };

  const handleSave = () => {
    if (!saveName.trim()) return;
    const list = JSON.parse(localStorage.getItem('biodegas_saves') || '[]');
    const id = uuidv4();
    const newSave = { id, name: saveName, date: new Date().toISOString() };
    
    // Extract store data to save
    const { envelope, wallThickness, accessMin, crate, nominalStackHeight, maxStackHeight, stackFillDirection, rows, trayCount, trayGap, waterLevel, requiredCrates, stacks, trays, pipeConnections } = store;
    const data = { envelope, wallThickness, accessMin, crate, nominalStackHeight, maxStackHeight, stackFillDirection, rows, trayCount, trayGap, waterLevel, requiredCrates, stacks, trays, pipeConnections };
    
    localStorage.setItem(`biodegas_save_${id}`, JSON.stringify(data));
    localStorage.setItem('biodegas_saves', JSON.stringify([...list, newSave]));
    
    setSaveName("");
    loadSaveList();
  };

  const handleLoad = (id: string) => {
    const data = JSON.parse(localStorage.getItem(`biodegas_save_${id}`) || '{}');
    if (Object.keys(data).length > 0) {
      store.loadSave(data);
    }
  };

  const handleDelete = (id: string) => {
    const list = saves.filter(s => s.id !== id);
    localStorage.setItem('biodegas_saves', JSON.stringify(list));
    localStorage.removeItem(`biodegas_save_${id}`);
    loadSaveList();
  };

  const exportJSON = () => {
    const { envelope, wallThickness, accessMin, crate, nominalStackHeight, maxStackHeight, stackFillDirection, rows, trayCount, trayGap, waterLevel, requiredCrates, stacks, trays, pipeConnections } = store;
    const data = { envelope, wallThickness, accessMin, crate, nominalStackHeight, maxStackHeight, stackFillDirection, rows, trayCount, trayGap, waterLevel, requiredCrates, stacks, trays, pipeConnections };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `biodegas-coordination-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportSnapshot = async () => {
    const container = document.getElementById('coordination-canvas');
    const canvas = container instanceof HTMLCanvasElement
      ? container
      : container?.querySelector('canvas');
    const fileName = `biodegas-snapshot-${new Date().toISOString().split('T')[0]}`;

    if (canvas && typeof canvas.toDataURL === 'function') {
      const a = document.createElement("a");
      a.href = canvas.toDataURL('image/png');
      a.download = `${fileName}.png`;
      a.click();
      return;
    }

    const svg = container?.querySelector('svg');
    if (!svg) return;

    const serialized = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);
    const image = new Image();

    image.onload = () => {
      const viewBox = svg.viewBox.baseVal;
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = viewBox.width || 960;
      exportCanvas.height = viewBox.height || 560;
      const context = exportCanvas.getContext('2d');
      if (!context) {
        URL.revokeObjectURL(svgUrl);
        return;
      }
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
      context.drawImage(image, 0, 0, exportCanvas.width, exportCanvas.height);
      const a = document.createElement("a");
      a.href = exportCanvas.toDataURL('image/png');
      a.download = `${fileName}.png`;
      a.click();
      URL.revokeObjectURL(svgUrl);
    };
    image.onerror = () => URL.revokeObjectURL(svgUrl);
    image.src = svgUrl;
  };

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <h3 className="text-sm font-bold border-b border-border pb-1">ACTIONS</h3>
        <button 
          onClick={store.resetReference}
          className="w-full flex items-center justify-center gap-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 py-2 rounded-md text-sm font-medium transition-colors"
        >
          <RefreshCcw size={16} /> Reset to 58-Crate Reference
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button 
            onClick={exportJSON}
            className="flex items-center justify-center gap-2 bg-accent text-accent-foreground border border-border hover:bg-accent/80 py-2 rounded-md text-sm font-medium transition-colors"
          >
            <Download size={14} /> JSON
          </button>
          <button 
            onClick={exportSnapshot}
            className="flex items-center justify-center gap-2 bg-accent text-accent-foreground border border-border hover:bg-accent/80 py-2 rounded-md text-sm font-medium transition-colors"
          >
            <Camera size={14} /> PNG
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold border-b border-border pb-1">SAVE LOCAL DESIGN</h3>
        <div className="flex gap-2">
          <input 
            type="text" 
            placeholder="Save name..." 
            value={saveName}
            onChange={e => setSaveName(e.target.value)}
            className="flex-1 px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            onKeyDown={e => e.key === 'Enter' && handleSave()}
          />
          <button 
            onClick={handleSave}
            disabled={!saveName.trim()}
            className="bg-primary text-primary-foreground p-2 rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            <Save size={18} />
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-bold border-b border-border pb-1">SAVED DESIGNS</h3>
        {saves.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No local saves found.</p>
        ) : (
          <div className="space-y-2">
            {saves.map(save => (
              <div key={save.id} className="flex items-center justify-between bg-muted/50 p-2 rounded-md border border-border">
                <div className="min-w-0 overflow-hidden">
                  <p className="text-sm font-medium truncate" title={save.name}>{save.name}</p>
                  <p className="text-[10px] text-muted-foreground">{new Date(save.date).toLocaleDateString()}</p>
                </div>
                <div className="flex gap-1 shrink-0 ml-2">
                  <button onClick={() => handleLoad(save.id)} className="p-1.5 bg-background border border-border rounded hover:bg-accent text-foreground" title="Load">
                    <FolderOpen size={14} />
                  </button>
                  <button onClick={() => handleDelete(save.id)} className="p-1.5 bg-background border border-destructive/30 rounded hover:bg-destructive text-destructive hover:text-destructive-foreground transition-colors" title="Delete">
                    <AlertTriangle size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
