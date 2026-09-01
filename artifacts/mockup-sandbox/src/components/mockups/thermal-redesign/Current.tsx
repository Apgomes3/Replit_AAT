import { useState } from "react";
import { Calculator, Layers, ShieldCheck, X } from "lucide-react";
import "./_group.css";

const defaults = [
  ["Reinforced concrete", "Concrete · 300 mm · 1.700 W/m·K", "AAT_FOUNDATIONS_WALL_V1.0"],
  ["Fiberglass", "GRP laminate · 25 mm · 0.300 W/m·K", "AAT_FOUNDATIONS_GRP_V1.0"],
  ["Stainless steel", "316L stainless steel · 6 mm · 16.000 W/m·K", "AAT_FOUNDATIONS_SS_V1.0"],
  ["Insulated panel", "Sandwich panel · 100 mm · 0.026 W/m·K", "AAT_FOUNDATIONS_PANEL_V1.0"],
];

function Field({ label, value, disabled = false }: { label: string; value: string; disabled?: boolean }) {
  return <label><span>{label}</span><input defaultValue={value} disabled={disabled} /></label>;
}

export function Current() {
  const [open, setOpen] = useState(true);
  const [customArea, setCustomArea] = useState("42.50");
  return (
    <main className="thermal-current">
      <div className="thermal-shell">
        <section className="thermal-card">
          <div className="thermal-row" style={{ padding: "12px 16px" }}>
            <div>
              <div className="thermal-title thermal-title-icon"><Layers size={16} color="#2563eb" /> Thermal wall construction defaults</div>
              <div className="thermal-subtle">4 current approved constructions. Governed values are versioned; captured calculation snapshots remain unchanged.</div>
            </div>
            <button className="thermal-button">Manage wall defaults</button>
          </div>
          <div className="thermal-defaults">{defaults.map(([title, data, version]) => <div className="thermal-default" key={title}><strong>{title}</strong><div>{data}</div><div>{version}</div></div>)}</div>
        </section>
        <div className="thermal-info">Positive contribution values add heat to water; negative values remove heat. LSS circulation is shown only as reference and is never counted as water exchange.</div>
        <section className="thermal-card">
          <div className="thermal-row" style={{ padding: "12px 16px" }}>
            <div><div className="thermal-title">Approved evaporation correlation library</div><div className="thermal-subtle">3 current approved version(s). Saved calculations retain an exact snapshot when a version is superseded.</div></div>
            <button className="thermal-button">Manage library</button>
          </div>
        </section>
        <section className="thermal-card">
          <div className="thermal-table-wrap"><table><thead><tr><th>LSS system</th><th>Linked scope</th><th>Readiness</th><th className="right">Cooling</th><th className="right">Heating</th><th /></tr></thead>
            <tbody><tr><td><div className="thermal-title">Tropical Reef Life Support</div><div className="thermal-code">LSS-001</div></td><td style={{ color: "#57534e" }}>2 exhibit(s)<br />3 tank(s)</td><td><span className="thermal-badge">Ready</span></td><td className="right thermal-mono">24.8 kW</td><td className="right thermal-mono">4.2 kW</td><td className="right"><button className="thermal-link" onClick={() => setOpen(true)}>Open calculation</button></td></tr>
            <tr><td><div className="thermal-title">Quarantine Life Support</div><div className="thermal-code">LSS-002</div></td><td style={{ color: "#57534e" }}>1 exhibit(s)<br />1 tank(s)</td><td><span className="thermal-badge">Ready</span></td><td className="right thermal-mono">8.6 kW</td><td className="right thermal-mono">1.5 kW</td><td className="right"><button className="thermal-link" onClick={() => setOpen(true)}>Open calculation</button></td></tr></tbody>
          </table></div>
        </section>
        {open && <section className="thermal-card thermal-detail">
          <div className="thermal-row top">
            <div><div style={{ color: "#2563eb", fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: ".06em" }}>Thermal calculation</div><h2 style={{ margin: "2px 0 0", fontSize: 18 }}>LSS-001 · Tropical Reef Life Support</h2><div className="thermal-subtle">Calculation THERMAL_V1.2 · source fingerprint 34b92a8e7d19…</div></div>
            <button className="thermal-icon-button" onClick={() => setOpen(false)} aria-label="Close thermal calculation"><X size={16} /></button>
          </div>
          <section className="thermal-section"><h3>Current linked source</h3>
            <div className="thermal-grid">{[["Effective volume","145.000 m³"],["Free surface","68.20 m²"],["Exposed wall","112.50 m²"],["LSS circulation (reference)","180.00 m³/h"]].map(([k,v]) => <div className="thermal-metric" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div>
            <div className="thermal-pair"><div className="thermal-box"><div className="thermal-box-title">Exhibits and water-temperature sources</div><div className="thermal-source-line"><span>EXH-014</span><span className="thermal-mono">24.0–26.0 °C <b style={{ color:"#047857", fontFamily:"inherit", fontSize:12 }}>valid</b></span></div><div className="thermal-source-line"><span>EXH-015</span><span className="thermal-mono">25.0–27.0 °C <b style={{ color:"#047857", fontFamily:"inherit", fontSize:12 }}>valid</b></span></div><div className="thermal-source-line"><b>Arithmetic average</b><b className="thermal-mono">25.5 °C</b></div></div>
            <div className="thermal-box"><div className="thermal-box-title">Tank geometry provenance</div><div className="thermal-provenance"><b>TNK-014</b> · volume: dimensions; surface: plan geometry; wall: calculated</div><div className="thermal-provenance"><b>TNK-015</b> · volume: dimensions; surface: plan geometry; wall: manual override (custom tank)<label className="thermal-area-edit"><span>Reviewed exposed wall area (m²)</span><input type="number" value={customArea} onChange={e => setCustomArea(e.target.value)} /></label></div><div className="thermal-provenance"><b>TNK-016</b> · volume: dimensions; surface: plan geometry; wall: calculated</div></div></div>
          </section>
          <section className="thermal-section"><h3>Environment and envelope</h3><div className="thermal-grid">
            <Field label="Ambient air temperature (°C)" value="30" /><Field label="Relative humidity (%)" value="65" /><Field label="Surrounding-surface temperature (°C)" value="28" /><Field label="Atmospheric pressure (kPa)" value="101.325" />
            <div className="thermal-derived"><div className="thermal-small-label">Derived water temperature</div><div className="v">25.5 °C</div><p>Arithmetic average of the linked exhibit minimum and maximum.</p></div><Field label="Reviewed water-temperature override (optional) (°C)" value="" />
            <label className="span2"><span>Surface-activity class (required)</span><select defaultValue="Moderate"><option>Moderate</option><option>Still</option><option>High</option></select></label>
            <div className="thermal-guidance span2"><b>Surface-activity guidance</b><p>Moderate surface circulation with distributed returns.</p><small>Select the category that best describes movement at the water surface.</small></div>
            <label className="span2"><span>Approved correlation version</span><select defaultValue="v1.1"><option>v1.1</option></select></label><Field label="Correlation version" value="v1.1" disabled /><Field label="Mass-transfer coefficient (kg/m²·s·kPa)" value="0.000018" disabled />
          </div>
          <div className="thermal-checks"><span className="thermal-governed"><ShieldCheck size={16} /> Approval is governed by the shared library</span><label><input type="checkbox" /> Project-specific deviation from selected correlation</label></div>
          <div className="thermal-grid" style={{ marginTop: 12 }}><Field label="Lower surface-activity class" value="Still" disabled /><Field label="Lower-class coefficient (kg/m²·s·kPa)" value="0.000010" disabled /><Field label="Correlation adjustment" value="0.000002" disabled /><Field label="Upper adjacent class" value="High" disabled /></div>
          <div className="thermal-wall" style={{ marginTop: 12 }}><h4>Tank wall construction and U-value</h4><p>Construction defaults are engineering assumptions. Use a reviewed custom U-value or explicit wall layer when the standard assumption does not apply.</p>
            <div className="thermal-grid"><label><span>Tank construction type</span><select defaultValue="Reinforced concrete"><option>Reinforced concrete</option><option>Fiberglass</option></select></label><div className="thermal-assumption span2"><b>Engineering assumption</b><div>Reinforced concrete: Concrete · 300 mm · k 1.700 W/m·K</div><small>Standard cast-in-place wall basis · AAT_FOUNDATIONS_WALL_V1.0</small></div><Field label="Reviewed custom wall U-value (optional) (W/m²·K)" value="" /><Field label="Effective wall material" value="Concrete" /><Field label="Effective wall layer thickness (mm)" value="300" /><Field label="Effective wall conductivity (W/m·K)" value="1.700" /></div>
            <div className="thermal-reset"><span>Effective values match the governed default.</span><button disabled>Reset to governed default</button></div><div className="thermal-saved">Saved calculation basis: <b>Thermal wall construction default</b> · 4.72 W/m²·K · governed default assumption</div>
          </div></section>
          <section className="thermal-section"><h3>Operational gains and capacity</h3><div className="thermal-grid"><Field label="Equipment heat gain (kW)" value="2.4" /><Field label="Lighting power (kW)" value="1.8" /><Field label="Lighting-to-water coupling (%)" value="85" /><Field label="Capacity margin (%)" value="10" /></div><div className="thermal-checks"><label><input type="checkbox" /> Count an explicit operational water exchange (not LSS circulation)</label></div><label style={{ marginTop:12 }}><span>Deviation or override justification</span><textarea rows={2} defaultValue="" /></label></section>
          <section className="thermal-section"><h3>Signed contributions</h3><div className="thermal-contributions">{[["conduction",-8.42],["evaporation",-13.76],["equipment heat",2.40],["lighting heat",1.53]].map(([k,v]) => <div className={`thermal-contribution ${Number(v)<0?"cooling":""}`} key={k as string}><div className="thermal-small-label">{k}</div><div className="v">{Number(v).toFixed(2)} kW</div></div>)}</div><div className="thermal-results">{[["Net envelope","-22.18 kW"],["Total load","-18.25 kW"],["Cooling with margin","24.8 kW"],["Heating with recovery + margin","4.2 kW"]].map(([k,v]) => <div className="thermal-result" key={k}><div className="k">{k}</div><div className="v">{v}</div></div>)}</div></section>
          <div className="thermal-actions"><button className="thermal-button" onClick={() => setOpen(false)}>Close</button><button className="thermal-button primary"><Calculator size={16} style={{ verticalAlign:"-3px", marginRight:6 }} />Save &amp; recalculate</button></div>
        </section>}
      </div>
    </main>
  );
}

export default Current;