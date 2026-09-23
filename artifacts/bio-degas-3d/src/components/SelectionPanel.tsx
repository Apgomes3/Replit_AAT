import { calculateTopDownSupportDatum, calculateWaterMatchedOutletLength, useStore } from '@/store/useStore';
import { X, Layers, Box, CircleDot } from 'lucide-react';

export function SelectionPanel() {
  const store = useStore();
  const { selectedId, stacks, trays, pipeConnections, setSelectedId, updateStackQuantity, updateTrayPosition, trayExplorationMode } = store;

  if (!selectedId) return null;

  const stack = stacks.find(s => s.id === selectedId);
  const tray = trays.find(t => t.id === selectedId);
  const pipeConnection = pipeConnections.find(connection => connection.id === selectedId);
  const waterMatchedLength = pipeConnection
    ? calculateWaterMatchedOutletLength(pipeConnection, store.envelope, store.wallThickness, store.waterLevel)
    : null;

  return (
    <div className="absolute bottom-6 left-1/2 -translate-x-1/2 bg-card border border-border shadow-xl rounded-lg w-80 md:w-96 overflow-hidden flex flex-col z-20 animate-in slide-in-from-bottom-4">
      <div className="flex items-center justify-between p-3 border-b border-border bg-muted/30">
        <h3 className="text-sm font-bold flex items-center gap-2 text-foreground">
          {stack
            ? <><Box size={16} className="text-primary" /> Stack Details</>
            : tray
              ? <><Layers size={16} className="text-[#9333ea]" /> Tray Details</>
              : <><CircleDot size={16} className="text-amber-600" /> Pipe Connection</>}
        </h3>
        <button onClick={() => setSelectedId(null)} className="text-muted-foreground hover:text-foreground">
          <X size={16} />
        </button>
      </div>
      
      <div className="p-4 space-y-4">
        {stack && (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs font-medium mb-1">Position (Row, Col)</p>
                <p className="font-mono bg-muted py-1 px-2 rounded inline-block border border-border">R{stack.row + 1}, C{stack.col + 1}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs font-medium mb-1">Coordinates (X, Y)</p>
                <p className="font-mono bg-muted py-1 px-2 rounded inline-block border border-border">{Math.round(stack.x)}, {Math.round(stack.y)}</p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-border">
              <label className="text-sm font-medium text-foreground block">Crate Quantity</label>
              <div className="flex items-center gap-3">
                <input 
                  type="range" 
                  min={0} 
                  max={store.maxStackHeight} 
                  value={stack.quantity} 
                  onChange={(e) => updateStackQuantity(stack.id, Number(e.target.value))}
                  className="flex-1 accent-primary"
                />
                <span className="font-mono text-lg font-bold w-6 text-center">{stack.quantity}</span>
              </div>
            </div>
            
            <div className="text-xs text-muted-foreground pt-2">
              Dimensions: {store.crate.width} x {store.crate.length} mm (Base)
              <br/>
              Height: {stack.quantity * store.crate.height} mm
              <br/>
              Datum: {store.stackFillDirection === 'top' ? 'shared support below dispersion tray' : 'bottom-up from tank floor'}
              {store.stackFillDirection === 'top' && (
                <>
                  <br/>
                  Clearance below FRP angle support: {Math.max(
                    0,
                    calculateTopDownSupportDatum(
                      store.envelope,
                      store.wallThickness,
                      store.trays,
                      store.topDownTrayClearance,
                      store.stacks,
                      store.crate.height,
                    ) ?? 0,
                  )} mm
                </>
              )}
            </div>
          </>
        )}

        {tray && (
          <>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div className="col-span-2">
                <p className="text-muted-foreground text-xs font-medium mb-1">Longitudinal Position (X)</p>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input 
                      type="number" 
                      value={Math.round(tray.x)} 
                      onChange={(e) => updateTrayPosition(tray.id, Number(e.target.value))}
                      className="flex-1 px-3 py-2 font-mono text-sm border border-input rounded-md bg-background focus:ring-2 focus:ring-primary focus:border-transparent"
                    />
                    <span className="text-muted-foreground">mm</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={store.envelope.length - store.wallThickness * 2 - tray.length}
                    value={tray.x}
                    onChange={(e) => updateTrayPosition(tray.id, Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>
                {trayExplorationMode && (
                  <p className="text-[10px] text-amber-500 mt-1 italic">Exploration mode: snaps disabled</p>
                )}
              </div>
            </div>

            <div className="text-xs text-muted-foreground pt-2 border-t border-border">
              Dimensions: {tray.length} x {tray.width} x {tray.height} mm
              <br/>
               Vertical datum: top flush with internal tank top
               <br/>
               Tray bottom: {Math.round(store.envelope.height - store.wallThickness - tray.height)} mm
               <br/>
              ID: {tray.id}
            </div>
          </>
        )}

        {pipeConnection && (
          <>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <label className="text-xs font-medium text-muted-foreground">
                Coring Ø
                <input
                  type="number"
                  min={1}
                  value={pipeConnection.coringDiameter ?? pipeConnection.diameter + 70}
                  onChange={(event) => store.updatePipeConnection(pipeConnection.id, { coringDiameter: Number(event.target.value) })}
                  className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-right font-mono text-sm text-foreground focus:ring-2 focus:ring-primary"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Pipe Ø
                <input
                  type="number"
                  min={1}
                  value={pipeConnection.diameter}
                  onChange={(event) => store.updatePipeConnection(pipeConnection.id, { diameter: Number(event.target.value) })}
                  className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-right font-mono text-sm text-foreground focus:ring-2 focus:ring-primary"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Stub length
                <input
                  type="number"
                  min={1}
                  value={pipeConnection.pipeLength}
                  onChange={(event) => store.updatePipeConnection(pipeConnection.id, { pipeLength: Number(event.target.value) })}
                  className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-right font-mono text-sm text-foreground focus:ring-2 focus:ring-primary"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Pipe 2 length
                <input
                  type="number"
                  min={1}
                  value={pipeConnection.matchWaterLevel && waterMatchedLength !== null
                    ? Math.round(waterMatchedLength)
                    : pipeConnection.outletPipeLength ?? 800}
                  disabled={pipeConnection.matchWaterLevel}
                  onChange={(event) => store.updatePipeConnection(pipeConnection.id, { outletPipeLength: Number(event.target.value) })}
                  className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-right font-mono text-sm text-foreground focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-55"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Elbow rotation
                <input
                  type="number"
                  min={-180}
                  max={180}
                  value={pipeConnection.elbowRotation ?? 0}
                  onChange={(event) => store.updatePipeConnection(pipeConnection.id, { elbowRotation: Number(event.target.value) })}
                  className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-right font-mono text-sm text-foreground focus:ring-2 focus:ring-primary"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Face X
                <input
                  type="number"
                  min={0}
                  value={pipeConnection.x}
                  onChange={(event) => store.updatePipeConnection(pipeConnection.id, { x: Number(event.target.value) })}
                  className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-right font-mono text-sm text-foreground focus:ring-2 focus:ring-primary"
                />
              </label>
              <label className="text-xs font-medium text-muted-foreground">
                Face Y
                <input
                  type="number"
                  min={0}
                  value={pipeConnection.y}
                  onChange={(event) => store.updatePipeConnection(pipeConnection.id, { y: Number(event.target.value) })}
                  className="mt-1 w-full rounded border border-input bg-background px-2 py-1.5 text-right font-mono text-sm text-foreground focus:ring-2 focus:ring-primary"
                />
              </label>
            </div>
            <label className="flex items-start gap-2 rounded border border-sky-500/20 bg-sky-500/5 p-2 text-xs text-foreground">
              <input
                type="checkbox"
                checked={pipeConnection.matchWaterLevel ?? false}
                onChange={(event) => store.updatePipeConnection(pipeConnection.id, { matchWaterLevel: event.target.checked })}
                className="mt-0.5 rounded border-border text-sky-600 focus:ring-sky-500"
              />
              <span>
                <span className="block font-semibold">Endpoint at water level</span>
                <span className="text-muted-foreground">
                  {pipeConnection.matchWaterLevel
                    ? waterMatchedLength !== null
                      ? `Pipe 2 is ${Math.round(waterMatchedLength)} mm to meet the water plane.`
                      : 'Current elbow direction does not intersect the water plane.'
                    : 'Pipe 2 uses its manual length.'}
                </span>
              </span>
            </label>
            <div className="border-t border-border pt-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">{pipeConnection.name}</span>
              <br />
              Face: {pipeConnection.face}
              <br />
              Geometry: wall coring sketch + stub pipe + rotatable elbow + second pipe
            </div>
          </>
        )}
      </div>
    </div>
  );
}
