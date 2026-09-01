import { useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  ClipboardCheck,
  Cloud,
  ExternalLink,
  FilePenLine,
  LockKeyhole,
  ShieldCheck,
  Thermometer,
  Waves,
  X,
} from "lucide-react";
import "./ProgressiveDisclosure.css";
import "./ProgressiveDisclosureAgitation.css";
import "./ProgressiveDisclosurePalette.css";

type System = {
  id: string;
  name: string;
  scope: string;
  tanks: string;
  readiness: "Ready" | "Review";
  cooling: string;
  heating: string;
  sourceFreshness: string;
};

const systems: System[] = [
  {
    id: "LSS-001",
    name: "Main Tank LSS System",
    scope: "Kaohsiung Aquarium · Tropical Reef Hall",
    tanks: "2 linked exhibits · 3 linked tanks",
    readiness: "Ready",
    cooling: "24.8 kW",
    heating: "4.2 kW",
    sourceFreshness: "Source sync 8 min ago",
  },
  {
    id: "LSS-002",
    name: "Quarantine Life Support",
    scope: "Kaohsiung Aquarium · Quarantine Wing",
    tanks: "1 linked exhibit · 1 linked tank",
    readiness: "Review",
    cooling: "8.6 kW",
    heating: "1.5 kW",
    sourceFreshness: "Source sync 14 min ago",
  },
];

type AgitationClass = "calm" | "moderate" | "high";

const agitationOptions: Array<{
  value: AgitationClass;
  label: string;
  coefficient: string;
  note: string;
}> = [
  { value: "calm", label: "Calm", coefficient: "0.000012", note: "Low surface activity" },
  { value: "moderate", label: "Moderate", coefficient: "0.000018", note: "Typical reef surface activity" },
  { value: "high", label: "High", coefficient: "0.000026", note: "Strong agitation or wave action" },
];

function StatusPill({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "amber" | "slate" }) {
  return <span className={`pd-pill pd-pill-${tone}`}><span className="pd-pill-dot" />{children}</span>;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="pd-metric">
      <div className="pd-kicker">{label}</div>
      <div className="pd-metric-value">{value}</div>
      {note && <div className="pd-metric-note">{note}</div>}
    </div>
  );
}

function EditSheet({
  kind,
  value,
  onClose,
  onSave,
}: {
  kind: "wall" | "temperature";
  value: string;
  onClose: () => void;
  onSave: (value: string) => void;
}) {
  const wall = kind === "wall";
  const [draft, setDraft] = useState(value);
  return (
    <div className="pd-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="pd-sheet" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div className="pd-sheet-head">
          <div>
            <div className="pd-kicker pd-teal">{wall ? "Reviewed evidence" : "Designer override"}</div>
            <h2 id="edit-title">{wall ? "Edit wall value" : "Override water temperature"}</h2>
          </div>
          <button className="pd-icon-button" onClick={onClose} aria-label="Close edit dialog"><X size={18} /></button>
        </div>
        <p className="pd-sheet-copy">
          {wall
            ? "Replace the governed FRP basis with a reviewed project value. This becomes evidence in the saved calculation."
            : "Use a reviewed temperature only when the linked exhibit source is not representative of this calculation."}
        </p>
        <label className="pd-field">
          <span>{wall ? "Effective wall U-value" : "Effective water temperature"}</span>
          <div className="pd-input-with-unit">
            <input autoFocus type="number" step="0.01" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <b>{wall ? "W/m²·K" : "°C"}</b>
          </div>
        </label>
        <label className="pd-field">
          <span>Basis note <em>required for review</em></span>
          <textarea defaultValue={wall ? "Reviewed against project FRP wall schedule, revision C." : "Reviewed with operations team against seasonal source conditions."} rows={3} />
        </label>
        <div className="pd-sheet-actions">
          <button className="pd-button" onClick={onClose}>Cancel</button>
          <button className="pd-button pd-button-primary" onClick={() => onSave(draft)}><Check size={15} /> Save reviewed value</button>
        </div>
      </section>
    </div>
  );
}

function Calculation({ system, onClose }: { system: System; onClose: () => void }) {
  const [wallValue, setWallValue] = useState("2.50");
  const [wallBasis, setWallBasis] = useState("Governed FRP wall · AAT_FOUNDATIONS_GRP_V1.0");
  const [waterValue, setWaterValue] = useState("25.5");
  const [waterBasis, setWaterBasis] = useState("Derived from linked exhibit source range");
  const [sheet, setSheet] = useState<"wall" | "temperature" | null>(null);
  const [saved, setSaved] = useState(false);
  const [showSources, setShowSources] = useState(false);
  const [agitationClass, setAgitationClass] = useState<AgitationClass>("moderate");
  const selectedAgitation = agitationOptions.find((option) => option.value === agitationClass) ?? agitationOptions[1];

  const saveReviewed = (value: string) => {
    if (sheet === "wall") {
      setWallValue(value);
      setWallBasis("Reviewed project override · designer evidence");
    } else {
      setWaterValue(value);
      setWaterBasis("Reviewed project override · designer evidence");
    }
    setSheet(null);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2600);
  };

  return (
    <section className="pd-calculation pd-reveal" aria-label="Thermal calculation">
      <div className="pd-calculation-head">
        <div>
          <div className="pd-kicker pd-teal">Focused calculation</div>
          <h2>{system.id} <span>·</span> {system.name}</h2>
          <p>THERMAL_V1.2 · snapshot fingerprint <code>34b92a8e7d19…</code></p>
        </div>
        <button className="pd-close-link" onClick={onClose}><X size={16} /> Close calculation</button>
      </div>

      <div className="pd-trust-strip">
        <div><ClipboardCheck size={17} /><span><b>Ready for review</b><small>All linked sources are valid</small></span></div>
        <div><Cloud size={17} /><span><b>Saved 2 min ago</b><small>Draft controls are editable</small></span></div>
        <div><ShieldCheck size={17} /><span><b>Evidence preserved</b><small>Release snapshot stays immutable</small></span></div>
      </div>

      <div className="pd-section">
        <div className="pd-section-title"><div><span className="pd-step">01</span><h3>Linked source and geometry</h3></div><StatusPill>Fresh sources</StatusPill></div>
        <div className="pd-metric-grid">
          <Metric label="Effective volume" value="145.000 m³" />
          <Metric label="Free surface" value="68.20 m²" />
          <Metric label="Exposed wall" value="112.50 m²" />
          <Metric label="LSS circulation" value="180.00 m³/h" note="Reference only · not water exchange" />
        </div>
        <div className="pd-source-grid">
          <div className="pd-source-card">
            <div className="pd-card-label"><Waves size={15} /> Water-temperature sources</div>
            <div className="pd-source-row"><b>EXH-014</b><span>24.0–26.0 °C <StatusPill>Valid</StatusPill></span></div>
            <div className="pd-source-row"><b>EXH-015</b><span>25.0–27.0 °C <StatusPill>Valid</StatusPill></span></div>
            <button className="pd-expand" onClick={() => setShowSources(!showSources)}>{showSources ? "Hide source detail" : "Show source detail"} <ChevronDown size={14} className={showSources ? "pd-rotate" : ""} /></button>
            {showSources && <div className="pd-source-detail">Both ranges are current and linked from the exhibit register. Arithmetic midpoint is used when no reviewed override is present.</div>}
          </div>
          <div className="pd-source-card">
            <div className="pd-card-label"><LockKeyhole size={15} /> Tank geometry provenance</div>
            <div className="pd-provenance"><b>TNK-014, TNK-016</b><span>Dimensions and plan geometry · calculated</span></div>
            <div className="pd-provenance"><b>TNK-015</b><span>Custom tank · reviewed exposed wall area 42.50 m²</span></div>
          </div>
        </div>
      </div>

      <div className="pd-section">
        <div className="pd-section-title"><div><span className="pd-step">02</span><h3>Environment and effective values</h3></div><span className="pd-draft-label"><FilePenLine size={14} /> Draft controls</span></div>
        <div className="pd-env-grid">
          <Metric label="Ambient air" value="30 °C" />
          <Metric label="Relative humidity" value="65 %" />
          <Metric label="Surrounding surface" value="28 °C" />
          <Metric label="Atmospheric pressure" value="101.325 kPa" />
        </div>
        <div className="pd-effective-grid">
          <div className="pd-effective-card pd-water-card">
            <div className="pd-effective-icon"><Thermometer size={18} /></div>
            <div className="pd-effective-content"><div className="pd-kicker">Effective water temperature</div><strong>{waterValue} °C</strong><span>{waterBasis}</span></div>
            <button className="pd-text-action" onClick={() => setSheet("temperature")}>{waterBasis.includes("override") ? "Edit override" : "Override value"} <ArrowRight size={14} /></button>
          </div>
          <div className="pd-effective-card pd-wall-card">
            <div className="pd-effective-icon"><Waves size={18} /></div>
            <div className="pd-effective-content"><div className="pd-kicker">Effective wall value</div><strong>{wallValue} W/m²·K</strong><span>{wallBasis}</span></div>
            <button className="pd-text-action" onClick={() => setSheet("wall")}>Edit wall value <ArrowRight size={14} /></button>
          </div>
        </div>
        <div className="pd-correlation-grid">
          <div className="pd-correlation pd-agitation-card">
            <div className="pd-correlation-copy">
              <span className="pd-kicker">Surface agitation</span>
              <b>Choose the activity at the water surface</b>
              <small>{selectedAgitation.note} · used for evaporation</small>
            </div>
            <label className="pd-select-field">
              <span>Activity class</span>
              <div className="pd-select-wrap">
                <select value={agitationClass} onChange={(event) => setAgitationClass(event.target.value as AgitationClass)}>
                  {agitationOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </div>
            </label>
            <div className="pd-coefficient"><span>Effective coefficient</span><b>{selectedAgitation.coefficient}</b><small>kg/m²·s·kPa</small></div>
          </div>
          <div className="pd-correlation">
            <div className="pd-correlation-copy">
              <span className="pd-kicker">Active platform correlation</span>
              <b>Generated evaporation model · v1.1</b>
              <small>Read-only · version selected by Platform Admin</small>
            </div>
            <StatusPill tone="slate">Platform governed</StatusPill>
          </div>
        </div>
      </div>

      <div className="pd-section pd-results-section">
        <div className="pd-section-title"><div><span className="pd-step">03</span><h3>Operational gains and result</h3></div><span className="pd-saved">{saved ? "Saved just now" : "Autosaved draft"}</span></div>
        <div className="pd-input-row"><label className="pd-field"><span>Equipment heat gain</span><div className="pd-input-with-unit"><input defaultValue="2.4" /><b>kW</b></div></label><label className="pd-field"><span>Lighting power</span><div className="pd-input-with-unit"><input defaultValue="1.8" /><b>kW</b></div></label><label className="pd-field"><span>Capacity margin</span><div className="pd-input-with-unit"><input defaultValue="10" /><b>%</b></div></label></div>
        <div className="pd-result-grid"><div><span>Net envelope</span><b>-22.18 kW</b></div><div><span>Total load</span><b>-18.25 kW</b></div><div className="pd-result-cooling"><span>Cooling with margin</span><b>24.8 kW</b></div><div className="pd-result-heating"><span>Heating with recovery + margin</span><b>4.2 kW</b></div></div>
      </div>
      <div className="pd-calculation-footer"><span><ShieldCheck size={15} /> Changes remain Draft until review</span><button className="pd-button pd-button-primary" onClick={() => { setSaved(true); window.setTimeout(() => setSaved(false), 2600); }}><Check size={15} /> Save &amp; recalculate</button></div>
      {sheet && <EditSheet kind={sheet} value={sheet === "wall" ? wallValue : waterValue} onClose={() => setSheet(null)} onSave={saveReviewed} />}
    </section>
  );
}

export function ProgressiveDisclosure() {
  const [selectedId, setSelectedId] = useState<string | null>("LSS-001");
  const selected = systems.find((system) => system.id === selectedId);
  const openAdmin = () => window.setTimeout(() => undefined, 0);
  return (
    <main className="pd-page">
      <div className="pd-shell">
        <header className="pd-header">
          <div className="pd-brand-mark"><Waves size={20} /></div>
          <div className="pd-heading"><div className="pd-eyebrow">Design Book <span>/</span> Thermal</div><h1>Thermal calculations</h1><p>Review one life-support system at a time. Governed platform values stay out of the designer workspace.</p></div>
          <button className="pd-admin-button" onClick={openAdmin}><LockKeyhole size={15} /> Platform Admin <ExternalLink size={13} /></button>
        </header>
        <div className="pd-context"><span><b>Kaohsiung Aquarium</b> · Life-support engineering book</span><span className="pd-context-status"><Cloud size={14} /> All source systems synced</span></div>
        <section className="pd-list-card">
          <div className="pd-list-head"><div><div className="pd-kicker pd-teal">Thermal systems</div><h2>Choose a system to calculate</h2><p>Start with the linked scope and readiness state. Calculation details stay closed until you need them.</p></div><div className="pd-count">2 systems</div></div>
          <div className="pd-system-list">
            {systems.map((system) => <button key={system.id} className={`pd-system-row ${selectedId === system.id ? "pd-system-selected" : ""}`} onClick={() => setSelectedId(system.id)}>
              <div className="pd-system-id">{system.id}</div><div className="pd-system-main"><strong>{system.name}</strong><span>{system.scope}</span><small>{system.tanks} · {system.sourceFreshness}</small></div><div className="pd-system-readiness"><StatusPill tone={system.readiness === "Ready" ? "green" : "amber"}>{system.readiness}</StatusPill><div><span>Cooling</span><b>{system.cooling}</b></div><div><span>Heating</span><b>{system.heating}</b></div></div><span className="pd-open-label">{selectedId === system.id ? "Opened" : "Open calculation"} <ArrowRight size={16} /></span>
            </button>)}
          </div>
          <div className="pd-list-foot"><ShieldCheck size={15} /> Wall defaults and correlation versions are managed, versioned, and approved in Platform Admin.</div>
        </section>
        {selected ? <Calculation system={selected} onClose={() => setSelectedId(null)} /> : <div className="pd-empty-hint"><span className="pd-empty-icon"><ArrowRight size={17} /></span><span><b>Calculation details appear here</b><small>Select “Open calculation” on a system to inspect sources, effective values, and results.</small></span></div>}
      </div>
    </main>
  );
}

export default ProgressiveDisclosure;