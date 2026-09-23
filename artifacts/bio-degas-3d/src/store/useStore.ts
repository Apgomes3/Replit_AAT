import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

export const TOP_DOWN_SUPPORT_CLEARANCE = 180;

export interface Envelope {
  length: number;
  width: number;
  height: number;
}

export interface CrateConfig {
  length: number; // 1040 (Y-axis along rows)
  width: number;  // 740 (X-axis along columns)
  height: number; // 530 (Z-axis)
}

export interface Stack {
  id: string;
  row: number;
  col: number;
  quantity: number;
  x: number;
  y: number;
  z: number;
}

export interface Tray {
  id: string;
  x: number; // Longitudinal position
  length: number; // 3405
  width: number; // 2005
  height: number; // 620
  frameWidth: number;
  sideChannelWidth: number;
  dividerHeight: number;
  panelThickness: number;
  perforationDiameter: number;
  perforationRows: number;
  perforationColumns: number;
}

export type PipeFace = 'access' | 'rear' | 'left' | 'right' | 'top' | 'bottom';

export interface PipeConnection {
  id: string;
  name: string;
  face: PipeFace;
  coringDiameter: number;
  diameter: number;
  pipeLength: number;
  outletPipeLength: number;
  x: number;
  y: number;
  elbowRadius: number;
  elbowRotation: number;
  matchWaterLevel: boolean;
}

export interface ValidationState {
  isValid: boolean;
  warnings: string[];
  errors: string[];
}

export interface ProjectState {
  // Params
  envelope: Envelope;
  wallThickness: number;
  accessMin: number;
  crate: CrateConfig;
  nominalStackHeight: number;
  maxStackHeight: number;
  stackFillDirection: 'bottom' | 'top';
  topDownTrayClearance: number;
  rows: number;
  trayCount: number;
  trayCountAuto: boolean;
  trayGap: number;
  waterLevel: number;
  requiredCrates: number;
  trayExplorationMode: boolean;

  // Instance state
  stacks: Stack[];
  trays: Tray[];
  pipeConnections: PipeConnection[];
  
  // UI State
  selectedId: string | null;
  
  // Actions
  updateParams: (params: Partial<Omit<ProjectState, 'stacks' | 'trays' | 'selectedId' | 'updateParams' | 'regenerateStacks' | 'updateStackQuantity' | 'updateTrayPosition' | 'resetReference' | 'loadSave'>>) => void;
  regenerateStacks: () => void;
  regenerateTrays: () => void;
  updateStackQuantity: (id: string, qty: number) => void;
  updateTrayPosition: (id: string, x: number) => void;
  updateTray: (id: string, patch: Partial<Omit<Tray, 'id'>>) => void;
  addTray: () => void;
  removeTray: (id: string) => void;
  addPipeConnection: () => void;
  removePipeConnection: (id: string) => void;
  updatePipeConnection: (id: string, patch: Partial<Omit<PipeConnection, 'id'>>) => void;
  setSelectedId: (id: string | null) => void;
  resetReference: () => void;
  loadSave: (state: Partial<ProjectState>) => void;
}

const DEFAULT_REFERENCE = {
  envelope: { length: 8360, width: 2240, height: 2390 },
  wallThickness: 80,
  accessMin: 800,
  crate: { length: 1040, width: 740, height: 530 },
  nominalStackHeight: 3,
  maxStackHeight: 4,
  stackFillDirection: 'bottom' as const,
  topDownTrayClearance: 100,
  rows: 2,
  trayCount: 2,
  trayCountAuto: true,
  trayGap: 100,
  waterLevel: 1590,
  requiredCrates: 58,
  trayExplorationMode: false,
};

const DEFAULT_PIPE_CONNECTIONS: PipeConnection[] = [{
  id: 'pipe-connection-01',
  name: 'PC-01',
  face: 'access',
  coringDiameter: 320,
  diameter: 250,
  pipeLength: 300,
  outletPipeLength: 800,
  x: 400,
  y: 1100,
  elbowRadius: 180,
  elbowRotation: 180,
  matchWaterLevel: true,
}];

export const PIPE_FACES: Array<{ value: PipeFace; label: string }> = [
  { value: 'access', label: 'Access end (+X)' },
  { value: 'rear', label: 'Rear end (-X)' },
  { value: 'left', label: 'Left side (+Y)' },
  { value: 'right', label: 'Right side (-Y)' },
  { value: 'top', label: 'Top face (-Z)' },
  { value: 'bottom', label: 'Bottom face (+Z)' },
];

export function calculateWaterMatchedOutletLength(
  connection: PipeConnection,
  envelope: Envelope,
  wallThickness: number,
  waterLevel: number,
) {
  const internalH = (envelope.height - wallThickness) / 1000;
  const waterY = waterLevel / 1000;
  const stubLength = (connection.pipeLength ?? 300) / 1000;
  const pipeRadius = Math.max(connection.diameter / 2000, 0.025);
  const elbowRadius = Math.max((connection.elbowRadius ?? 180) / 1000, pipeRadius * 1.5);
  const rotation = (connection.elbowRotation ?? 0) * Math.PI / 180;

  let pointY = connection.y / 1000;
  let directionY = 0;
  let branchY = -Math.cos(rotation);

  if (connection.face === 'top') {
    pointY = internalH;
    directionY = -1;
    branchY = 0;
  } else if (connection.face === 'bottom') {
    pointY = 0;
    directionY = 1;
    branchY = 0;
  }

  const elbowEndY = pointY
    + directionY * (stubLength + elbowRadius)
    + branchY * elbowRadius;

  if (Math.abs(branchY) < 0.001) return null;
  const outletLength = (waterY - elbowEndY) / branchY;
  return outletLength > 0 ? outletLength * 1000 : null;
}

export function calculateTopDownCrateDatum(
  envelope: Envelope,
  wallThickness: number,
  trays: Tray[],
  clearance: number,
) {
  if (trays.length === 0) return null;
  const internalHeight = envelope.height - wallThickness;
  const lowestTrayUnderside = Math.min(...trays.map(tray => internalHeight - tray.height));
  return lowestTrayUnderside - Math.max(0, clearance);
}

export function calculateTopDownSupportDatum(
  envelope: Envelope,
  wallThickness: number,
  trays: Tray[],
  clearance: number,
  stacks: Stack[],
  crateHeight: number,
) {
  const crateTopDatum = calculateTopDownCrateDatum(envelope, wallThickness, trays, clearance);
  if (crateTopDatum === null) return null;
  const tallestActiveStack = Math.max(0, ...stacks.map(stack => stack.quantity));
  return crateTopDatum - tallestActiveStack * crateHeight;
}

function generateStacks(state: Partial<ProjectState>) {
  const s = { ...DEFAULT_REFERENCE, ...state } as ProjectState;
  const internalL = s.envelope.length - 2 * s.wallThickness;
  const internalW = s.envelope.width - 2 * s.wallThickness;
  
  const availableL = internalL - s.accessMin;
  const cols = Math.floor(availableL / s.crate.width); // crate.width is 740 along X
  const rows = Math.min(s.rows, Math.floor(internalW / s.crate.length)); // crate.length is 1040 along Y
  
  let currentTotal = 0;
  const newStacks: Stack[] = [];
  
  // Place stacks from start of available area (accessMin)
  // But coordinate system: X=0 at access start.
  // Wait, if access is at the start (0 to 800), stacks start at X = 800.
  // We'll place access at X=0 to accessMin. Stacks go from accessMin to internalL.
  
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      let qty = 0;
      if (currentTotal < s.requiredCrates) {
        qty = Math.min(s.nominalStackHeight, s.requiredCrates - currentTotal);
        currentTotal += qty;
      }
      
      // If we haven't reached required crates but are at the end, we might need to add more to existing stacks
      
      newStacks.push({
        id: uuidv4(),
        row: r,
        col: c,
        quantity: qty,
        x: s.accessMin + c * s.crate.width,
        y: (internalW - rows * s.crate.length) / 2 + r * s.crate.length, // Centered in Y
        z: 0
      });
    }
  }
  
  // If we still need more crates, distribute them up to maxStackHeight
  if (currentTotal < s.requiredCrates) {
    for (let i = 0; i < newStacks.length && currentTotal < s.requiredCrates; i++) {
      const room = s.maxStackHeight - newStacks[i].quantity;
      if (room > 0) {
        const add = Math.min(room, s.requiredCrates - currentTotal);
        newStacks[i].quantity += add;
        currentTotal += add;
      }
    }
  }
  
  return newStacks;
}

function generateTrays(state: Partial<ProjectState>) {
  const s = { ...DEFAULT_REFERENCE, ...state } as ProjectState;
  const newTrays: Tray[] = [];
  const trayLength = 3405;
  const trayWidth = 2005;
  const trayHeight = 620;
  
  // Trays are placed after access zone, centered in the remaining space?
  // Let's snap them to the accessMin initially.
  let startX = s.accessMin;
  
  for (let i = 0; i < s.trayCount; i++) {
    newTrays.push({
      id: `tray-${i}`,
      x: startX + (trayLength + s.trayGap) * i,
      length: trayLength,
      width: trayWidth,
      height: trayHeight,
      frameWidth: 80,
      sideChannelWidth: 360,
      dividerHeight: 420,
      panelThickness: 40,
      perforationDiameter: 35,
      perforationRows: 5,
      perforationColumns: 12,
    });
  }
  
  return newTrays;
}

function calculateAutomaticTrayCount(state: Partial<ProjectState>) {
  const s = { ...DEFAULT_REFERENCE, ...state } as ProjectState;
  const internalLength = s.envelope.length - 2 * s.wallThickness;
  const availableLength = Math.max(0, internalLength - s.accessMin);
  const standardTrayLength = 3405;
  return Math.max(
    0,
    Math.min(4, Math.floor((availableLength + s.trayGap) / (standardTrayLength + s.trayGap))),
  );
}

function reconcileAutomaticTrays(state: Partial<ProjectState>, existingTrays: Tray[]) {
  const generated = generateTrays(state);
  return generated.map((tray, index) => {
    const existing = existingTrays[index];
    return existing
      ? { ...tray, ...existing, x: tray.x }
      : tray;
  });
}

export const useStore = create<ProjectState>((set, get) => ({
  ...DEFAULT_REFERENCE,
  stacks: generateStacks(DEFAULT_REFERENCE),
  trays: generateTrays(DEFAULT_REFERENCE),
  pipeConnections: DEFAULT_PIPE_CONNECTIONS,
  selectedId: null,
  
  updateParams: (params) => set((state) => {
    const next = { ...state, ...params };
    // If layout affecting params changed, we might need to regenerate
    const needsRegen = ['envelope', 'wallThickness', 'accessMin', 'crate', 'rows', 'requiredCrates', 'nominalStackHeight', 'maxStackHeight'].some(k => k in params);
    const trayLengthInputsChanged = ['envelope', 'wallThickness', 'accessMin', 'trayGap'].some(k => k in params);
    const autoTrayLayoutChanged = next.trayCountAuto
      && (trayLengthInputsChanged || params.trayCountAuto === true);
    if (autoTrayLayoutChanged) {
      next.trayCount = calculateAutomaticTrayCount(next);
      next.trays = reconcileAutomaticTrays(next, state.trays);
    }
    
    if (needsRegen) {
      next.stacks = generateStacks(next);
    }
    if (!autoTrayLayoutChanged && ['trayCount', 'trayGap'].some(k => k in params)) {
      next.trays = generateTrays(next);
    }
    
    return next;
  }),
  
  regenerateStacks: () => set(state => ({ stacks: generateStacks(state) })),
  regenerateTrays: () => set(state => ({ trays: generateTrays(state) })),
  
  updateStackQuantity: (id, qty) => set(state => {
    const stacks = state.stacks.map(s => s.id === id ? { ...s, quantity: Math.max(0, Math.min(state.maxStackHeight, qty)) } : s);
    return { stacks };
  }),
  
  updateTrayPosition: (id, x) => set(state => {
    let trays = state.trays.map(t => t.id === id ? { ...t, x } : { ...t });
    
    // Snapping logic if not in exploration mode
    if (!state.trayExplorationMode) {
      const internalL = state.envelope.length - 2 * state.wallThickness;
      
      // Keep within bounds
      trays = trays.map(t => {
        let newX = t.x;
        if (newX < state.accessMin) newX = state.accessMin;
        if (newX + t.length > internalL) newX = internalL - t.length;
        return { ...t, x: newX };
      });

      // Snap to each other based on gap
      if (trays.length === 2) {
        if (id === trays[0].id) {
          let nextX = trays[0].x + trays[0].length + state.trayGap;
          if (nextX + trays[1].length > internalL) {
             nextX = internalL - trays[1].length;
             trays[0].x = nextX - state.trayGap - trays[0].length;
          }
          trays[1].x = nextX;
        } else if (id === trays[1].id) {
          let prevX = trays[1].x - state.trayGap - trays[0].length;
          if (prevX < state.accessMin) {
            prevX = state.accessMin;
            trays[1].x = prevX + trays[0].length + state.trayGap;
          }
          trays[0].x = prevX;
        }
      }
    }
    
    return { trays };
  }),

  updateTray: (id, patch) => set(state => ({
    trays: state.trays.map(tray => tray.id === id ? { ...tray, ...patch } : tray),
  })),

  addTray: () => set(state => {
    if (state.trays.length >= 4) return state;
    const lastTray = state.trays[state.trays.length - 1];
    const internalL = state.envelope.length - 2 * state.wallThickness;
    const nextX = lastTray
      ? lastTray.x + lastTray.length + state.trayGap
      : state.accessMin;
    const tray: Tray = {
      id: uuidv4(),
      x: nextX,
      length: 3405,
      width: 2005,
      height: 620,
      frameWidth: 80,
      sideChannelWidth: 360,
      dividerHeight: 420,
      panelThickness: 40,
      perforationDiameter: 35,
      perforationRows: 5,
      perforationColumns: 12,
    };
    return {
      trays: [...state.trays, tray],
      trayCount: state.trays.length + 1,
      trayCountAuto: false,
      selectedId: tray.id,
    };
  }),

  removeTray: (id) => set(state => {
    if (!state.trays.some(tray => tray.id === id)) return state;
    const trays = state.trays.filter(tray => tray.id !== id);
    return {
      trays,
      trayCount: trays.length,
      trayCountAuto: false,
      selectedId: state.selectedId === id ? null : state.selectedId,
    };
  }),

  addPipeConnection: () => set(state => {
    const pipeConnection: PipeConnection = {
      id: uuidv4(),
      name: `PC-${String(state.pipeConnections.length + 1).padStart(2, '0')}`,
      face: 'access',
      coringDiameter: 320,
      diameter: 250,
      pipeLength: 300,
      outletPipeLength: 800,
      x: 400,
      y: 1100,
      elbowRadius: 180,
      elbowRotation: 180,
      matchWaterLevel: true,
    };
    return {
      pipeConnections: [...state.pipeConnections, pipeConnection],
      selectedId: pipeConnection.id,
    };
  }),

  removePipeConnection: (id) => set(state => ({
    pipeConnections: state.pipeConnections.filter(connection => connection.id !== id),
    selectedId: state.selectedId === id ? null : state.selectedId,
  })),

  updatePipeConnection: (id, patch) => set(state => ({
    pipeConnections: state.pipeConnections.map(connection =>
      connection.id === id ? { ...connection, ...patch } : connection,
    ),
  })),
  
  setSelectedId: (id) => set({ selectedId: id }),
  
  resetReference: () => set({
    ...DEFAULT_REFERENCE,
    stacks: generateStacks(DEFAULT_REFERENCE),
    trays: generateTrays(DEFAULT_REFERENCE),
    pipeConnections: DEFAULT_PIPE_CONNECTIONS,
    selectedId: null
  }),
  
  loadSave: (savedState) => set((state) => ({
    ...state,
    ...savedState,
    trays: (savedState.trays ?? state.trays).map(tray => ({
      ...tray,
      frameWidth: tray.frameWidth ?? 80,
      sideChannelWidth: tray.sideChannelWidth ?? 360,
      dividerHeight: tray.dividerHeight ?? 420,
      panelThickness: tray.panelThickness ?? 40,
      perforationDiameter: tray.perforationDiameter ?? 35,
      perforationRows: tray.perforationRows ?? 5,
      perforationColumns: tray.perforationColumns ?? 12,
    })),
    pipeConnections: (savedState.pipeConnections ?? state.pipeConnections).map(connection => ({
      ...connection,
      coringDiameter: connection.coringDiameter ?? Math.max(connection.diameter + 70, connection.diameter),
      pipeLength: connection.pipeLength ?? 300,
      outletPipeLength: connection.outletPipeLength ?? 800,
      elbowRadius: connection.elbowRadius ?? 180,
      elbowRotation: connection.elbowRotation ?? 0,
      matchWaterLevel: connection.matchWaterLevel ?? false,
    })),
  }))
}));

export function useValidation(): ValidationState {
  const state = useStore();
  const warnings: string[] = [];
  const errors: string[] = [];
  
  const internalL = state.envelope.length - 2 * state.wallThickness;
  const internalW = state.envelope.width - 2 * state.wallThickness;
  const internalH = state.envelope.height - state.wallThickness;
  const faceLimits = (face: PipeFace) => {
    if (face === 'access' || face === 'rear') return { x: internalW, y: internalH };
    if (face === 'left' || face === 'right') return { x: internalL, y: internalH };
    return { x: internalL, y: internalW };
  };
  
  // 1. Envelope / Transport checks
  if (state.envelope.length > 9000 || state.envelope.width > 2250 || state.envelope.height > 2500) {
    errors.push("Envelope exceeds transport limits (9000 x 2250 x 2500).");
  }
  
  // 2. Capacity vs Required
  const actualCrates = state.stacks.reduce((sum, s) => sum + s.quantity, 0);
  if (actualCrates < state.requiredCrates) {
    errors.push(`Not enough crates placed. Required: ${state.requiredCrates}, Placed: ${actualCrates}.`);
  } else if (actualCrates > state.requiredCrates) {
    warnings.push(`More crates placed than required. Placed: ${actualCrates}, Required: ${state.requiredCrates}.`);
  }
  
  // 3. Tray Fit
  state.trays.forEach((t, i) => {
    if (t.length <= 0 || t.width <= 0 || t.height <= 0) {
      errors.push(`Tray ${i + 1} dimensions must be greater than 0mm.`);
    }
    if (t.x < state.accessMin) {
      errors.push(`Tray ${i+1} encroaches on access zone.`);
    }
    if (t.x + t.length > internalL) {
      errors.push(`Tray ${i+1} exceeds internal length.`);
    }
    if (t.width > internalW) {
      errors.push(`Tray ${i+1} width (${t.width}) exceeds internal width (${internalW}).`);
    }
    const centerPanelWidth = t.width - 2 * (t.frameWidth + t.sideChannelWidth);
    if (centerPanelWidth <= 0) {
      errors.push(`Tray ${i + 1} frame and side channels leave no width for the centre panel.`);
    }
    if (t.dividerHeight > t.height) {
      errors.push(`Tray ${i + 1} divider height exceeds the tray height.`);
    }
    if (t.panelThickness > t.height) {
      errors.push(`Tray ${i + 1} panel thickness exceeds the tray height.`);
    }
    if (t.perforationRows < 1 || t.perforationColumns < 1) {
      errors.push(`Tray ${i + 1} perforation rows and columns must be at least 1.`);
    }
  });
  
  // 4. Tray Gap
  if (state.trays.length === 2) {
    const gap = state.trays[1].x - (state.trays[0].x + state.trays[0].length);
    if (Math.abs(gap - state.trayGap) > 1 && !state.trayExplorationMode) {
      warnings.push(`Tray gap is ${Math.round(gap)}mm, expected ${state.trayGap}mm.`);
    } else if (gap < 0) {
      errors.push(`Trays are overlapping by ${Math.abs(Math.round(gap))}mm.`);
    }
  }

  // 5. Water Level Bounds
  const maxStackH = Math.max(...state.stacks.map(s => s.quantity));
  const cratesH = maxStackH * state.crate.height;
  if (state.stackFillDirection === 'bottom' && state.waterLevel < cratesH) {
    warnings.push(`Water level (${state.waterLevel}) is below top of crates (${cratesH}).`);
  }
  
  state.trays.forEach((tray, index) => {
    const trayBottom = internalH - tray.height;
    if (trayBottom < 0) {
      errors.push(`Tray ${index + 1} height (${tray.height}) exceeds internal height (${internalH}).`);
    }
    if (state.waterLevel > trayBottom) {
      warnings.push(`Water level is ${state.waterLevel - trayBottom}mm above the bottom of tray ${index + 1}.`);
    }
  });

  state.pipeConnections.forEach(connection => {
    const limits = faceLimits(connection.face);
    const coringRadius = connection.coringDiameter / 2;
    if (connection.coringDiameter <= 0) {
      errors.push(`${connection.name} coring diameter must be greater than 0mm.`);
    }
    if (connection.diameter <= 0) {
      errors.push(`${connection.name} diameter must be greater than 0mm.`);
    }
    if (
      connection.x - coringRadius < 0
      || connection.x + coringRadius > limits.x
      || connection.y - coringRadius < 0
      || connection.y + coringRadius > limits.y
    ) {
      errors.push(`${connection.name} coring extends outside the selected ${connection.face} face.`);
    }
    if (connection.coringDiameter < connection.diameter) {
      errors.push(`${connection.name} coring must be at least as large as the pipe diameter.`);
    }
    if (connection.pipeLength <= 0) {
      errors.push(`${connection.name} stub pipe length must be greater than 0mm.`);
    }
    if (connection.outletPipeLength <= 0) {
      errors.push(`${connection.name} outlet pipe length must be greater than 0mm.`);
    }
    if (
      connection.matchWaterLevel
      && calculateWaterMatchedOutletLength(
        connection,
        state.envelope,
        state.wallThickness,
        state.waterLevel,
      ) === null
    ) {
      warnings.push(`${connection.name} elbow direction does not intersect the water-level plane inside the tank.`);
    }
    if (connection.pipeLength + connection.outletPipeLength > internalL) {
      warnings.push(`${connection.name} combined internal pipe length exceeds the tank length.`);
    }
  });

  // 6. Stack Validation
  const cols = Math.floor((internalL - state.accessMin) / state.crate.width);
  const rows = Math.floor(internalW / state.crate.length);
  const topDownCrateDatum = calculateTopDownCrateDatum(
    state.envelope,
    state.wallThickness,
    state.trays,
    state.topDownTrayClearance,
  );
  const topDownSupportDatum = calculateTopDownSupportDatum(
    state.envelope,
    state.wallThickness,
    state.trays,
    state.topDownTrayClearance,
    state.stacks,
    state.crate.height,
  );

  if (state.stackFillDirection === 'top' && topDownCrateDatum === null) {
    errors.push('Top-down support configuration cannot be applied because no dispersion tray is available as the crate datum.');
  } else if (
    state.stackFillDirection === 'top'
    && topDownSupportDatum !== null
    && topDownSupportDatum < TOP_DOWN_SUPPORT_CLEARANCE
  ) {
    errors.push(
      `Top-down support configuration cannot be applied: the tallest active stack cannot fit ${state.topDownTrayClearance}mm below the dispersion tray while leaving the required ${TOP_DOWN_SUPPORT_CLEARANCE}mm clearance beneath the shared FRP support level. Crates remain visible for reference, but supports are hidden.`,
    );
  }
  
  let validPositions = 0;
  state.stacks.forEach(s => {
    if (s.quantity > state.maxStackHeight) {
      errors.push(`Stack at row ${s.row}, col ${s.col} exceeds max height (${state.maxStackHeight}).`);
    }
    if (s.col >= cols || s.row >= rows) {
      errors.push(`Stack at row ${s.row}, col ${s.col} is outside valid area.`);
    } else {
      validPositions++;
    }
  });
  
  if (validPositions < state.stacks.length) {
    errors.push(`Some stacks are positioned outside the valid container footprint.`);
  }

  return {
    isValid: errors.length === 0,
    warnings,
    errors
  };
}
