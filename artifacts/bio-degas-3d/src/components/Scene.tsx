import { createContext, useContext, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid, GizmoHelper, GizmoViewport } from '@react-three/drei';
import * as THREE from 'three';
import { calculateWaterMatchedOutletLength, type PipeConnection, useStore, useValidation } from '@/store/useStore';

const VisualModeContext = createContext<'finished' | 'technical'>('finished');

function TankShell() {
  const mode = useContext(VisualModeContext);
  const isFinished = mode === 'finished';
  const envelope = useStore(s => s.envelope);
  const wallThickness = useStore(s => s.wallThickness);
  const L = envelope.length / 1000;
  const W = envelope.width / 1000;
  const H = envelope.height / 1000;
  const internalL = (envelope.length - 2 * wallThickness) / 1000;
  const internalW = (envelope.width - 2 * wallThickness) / 1000;
  const internalH = (envelope.height - wallThickness) / 1000;
  
  return (
    <group position={[internalL / 2, internalH / 2, internalW / 2]}>
      <mesh>
        <boxGeometry args={[L, H, W]} />
        {isFinished ? (
          <meshStandardMaterial color="#475569" roughness={0.6} metalness={0.2} side={THREE.BackSide} />
        ) : (
          <meshStandardMaterial color="#88aacc" transparent opacity={0.10} depthWrite={false} side={THREE.DoubleSide} />
        )}
      </mesh>
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(L, H, W)]} />
        {isFinished ? (
          <lineBasicMaterial color="#1e293b" opacity={1} />
        ) : (
          <lineBasicMaterial color="#64748b" opacity={0.4} transparent />
        )}
      </lineSegments>
    </group>
  );
}

function AccessZone() {
  const mode = useContext(VisualModeContext);
  const isFinished = mode === 'finished';
  const envelope = useStore(s => s.envelope);
  const wallThickness = useStore(s => s.wallThickness);
  const accessMin = useStore(s => s.accessMin);
  const internalW = (envelope.width - 2 * wallThickness) / 1000;
  const internalH = (envelope.height - wallThickness) / 1000;
  const L = accessMin / 1000;
  
  return (
    <group position={[L / 2, internalH / 2, internalW / 2]}>
      <mesh>
        <boxGeometry args={[L, internalH, internalW]} />
        {isFinished ? (
          <meshStandardMaterial color="#f59e0b" transparent opacity={0.03} depthWrite={false} />
        ) : (
          <meshStandardMaterial color="#d97706" transparent opacity={0.15} depthWrite={false} />
        )}
      </mesh>
    </group>
  );
}

function WaterVolume() {
  const mode = useContext(VisualModeContext);
  const isFinished = mode === 'finished';
  const envelope = useStore(s => s.envelope);
  const wallThickness = useStore(s => s.wallThickness);
  const waterLevel = useStore(s => s.waterLevel);
  const internalL = (envelope.length - 2 * wallThickness) / 1000;
  const internalW = (envelope.width - 2 * wallThickness) / 1000;
  const H = waterLevel / 1000;
  
  return (
    <group position={[internalL / 2, H / 2, internalW / 2]}>
      <mesh>
        <boxGeometry args={[internalL, H, internalW]} />
        {isFinished ? (
          <meshPhysicalMaterial 
            color="#0284c7"
            transparent 
            opacity={0.8}
            transmission={0.6}
            roughness={0.1}
            metalness={0.1}
            thickness={2}
            depthWrite={false}
          />
        ) : (
          <meshPhysicalMaterial 
            color="#0ea5e9" 
            transparent 
            opacity={0.25} 
            roughness={0.1}
            transmission={0.9}
            thickness={0.5}
            depthWrite={false}
          />
        )}
      </mesh>
    </group>
  );
}

function Stacks() {
  const mode = useContext(VisualModeContext);
  const isFinished = mode === 'finished';
  const stacks = useStore(s => s.stacks);
  const crate = useStore(s => s.crate);
  const envelope = useStore(s => s.envelope);
  const wallThickness = useStore(s => s.wallThickness);
  const waterLevel = useStore(s => s.waterLevel);
  const stackFillDirection = useStore(s => s.stackFillDirection);
  const selectedId = useStore(s => s.selectedId);
  const setSelectedId = useStore(s => s.setSelectedId);
  
  const l = crate.width / 1000;
  const w = crate.length / 1000;
  const h = crate.height / 1000;
  const internalW = (envelope.width - 2 * wallThickness) / 1000;
  
  return (
    <group>
      {stacks.map(stack => {
        const isSelected = selectedId === stack.id;
        const color = isSelected ? "#3b82f6" : "#0284c7";
        const emissive = isSelected ? "#2563eb" : "#000000";
        const supportHeight = stackFillDirection === 'top'
          ? Math.max(0, waterLevel / 1000 - stack.quantity * h)
          : 0;
        const beamSize = Math.min(0.08, l * 0.1, w * 0.07);
        const beamX = l * 0.42;
        const railZ = w * 0.4;
        const stackCenterZ = stack.y / 1000 + w / 2;
        const wallSpanOffset = internalW / 2 - stackCenterZ;
        
        return (
          <group 
            key={stack.id} 
            position={[stack.x / 1000 + l / 2, 0, stack.y / 1000 + w / 2]}
            onClick={(e) => { e.stopPropagation(); setSelectedId(stack.id); }}
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
            onPointerOut={(e) => { document.body.style.cursor = 'auto'; }}
          >
            <mesh position={[0, supportHeight + 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[l, w]} />
              {isFinished ? (
                <meshBasicMaterial color={isSelected ? "#3b82f6" : "#000000"} transparent opacity={isSelected ? 0.15 : 0} />
              ) : (
                <meshBasicMaterial color={color} transparent opacity={0.4} />
              )}
            </mesh>

            {supportHeight > 0.01 && (
              <group>
                <mesh position={[-beamX, supportHeight - beamSize / 2, wallSpanOffset]}>
                  <boxGeometry args={[beamSize, beamSize, internalW]} />
                  <meshStandardMaterial color={isSelected ? '#f59e0b' : '#64748b'} roughness={0.45} metalness={0.7} />
                </mesh>
                <mesh position={[beamX, supportHeight - beamSize / 2, wallSpanOffset]}>
                  <boxGeometry args={[beamSize, beamSize, internalW]} />
                  <meshStandardMaterial color={isSelected ? '#f59e0b' : '#64748b'} roughness={0.45} metalness={0.7} />
                </mesh>
                <mesh position={[0, supportHeight - beamSize * 1.5, -railZ]}>
                  <boxGeometry args={[l * 0.92, beamSize, beamSize]} />
                  <meshStandardMaterial color={isSelected ? '#f59e0b' : '#64748b'} roughness={0.45} metalness={0.7} />
                </mesh>
                <mesh position={[0, supportHeight - beamSize * 1.5, railZ]}>
                  <boxGeometry args={[l * 0.92, beamSize, beamSize]} />
                  <meshStandardMaterial color={isSelected ? '#f59e0b' : '#64748b'} roughness={0.45} metalness={0.7} />
                </mesh>
              </group>
            )}
            
            {Array.from({ length: stack.quantity }).map((_, i) => (
              <mesh key={i} position={[0, supportHeight + i * h + h / 2, 0]}>
                <boxGeometry args={[l * 0.95, h * 0.95, w * 0.95]} />
                {isFinished ? (
                  <meshStandardMaterial 
                    color={isSelected ? "#3b82f6" : "#0f172a"} 
                    emissive={isSelected ? "#1d4ed8" : "#000000"} 
                    emissiveIntensity={isSelected ? 0.2 : 0} 
                    roughness={0.7} 
                    metalness={0.1} 
                  />
                ) : (
                  <meshStandardMaterial color={color} emissive={emissive} emissiveIntensity={isSelected ? 0.4 : 0} roughness={0.7} metalness={0.2} />
                )}
                {(!isFinished || isSelected) && (
                  <lineSegments>
                    <edgesGeometry args={[new THREE.BoxGeometry(l * 0.95, h * 0.95, w * 0.95)]} />
                    {isFinished ? (
                      <lineBasicMaterial color="#60a5fa" opacity={0.9} transparent />
                    ) : (
                      <lineBasicMaterial color="#ffffff" opacity={isSelected ? 0.8 : 0.3} transparent />
                    )}
                  </lineSegments>
                )}
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function Trays() {
  const mode = useContext(VisualModeContext);
  const isFinished = mode === 'finished';
  const trays = useStore(s => s.trays);
  const envelope = useStore(s => s.envelope);
  const wallThickness = useStore(s => s.wallThickness);
  const selectedId = useStore(s => s.selectedId);
  const setSelectedId = useStore(s => s.setSelectedId);
  const internalW = (envelope.width - 2 * wallThickness) / 1000;
  const internalH = (envelope.height - wallThickness) / 1000;
  
  return (
    <group>
      {trays.map((tray, i) => {
        const isSelected = selectedId === tray.id;
        const l = tray.length / 1000;
        const w = tray.width / 1000;
        const h = tray.height / 1000;
        const frame = Math.min((tray.frameWidth ?? 80) / 1000, Math.min(l, w) / 3);
        const channel = Math.min((tray.sideChannelWidth ?? 360) / 1000, Math.max(0, w / 2 - frame));
        const dividerH = Math.min((tray.dividerHeight ?? 420) / 1000, h);
        const plateT = Math.min((tray.panelThickness ?? 40) / 1000, h);
        const centerW = Math.max(0.08, w - 2 * (frame + channel));
        const usableL = Math.max(0.08, l - frame * 2);
        const rows = Math.max(1, Math.round(tray.perforationRows ?? 5));
        const columns = Math.max(1, Math.round(tray.perforationColumns ?? 12));
        const holeRadius = Math.max((tray.perforationDiameter ?? 35) / 2000, 0.006);
        const yPos = internalH - h / 2;
        const floorY = -h / 2 + plateT / 2;
        const wallColor = isSelected ? '#d946ef' : isFinished ? '#cbd5e1' : '#9333ea';
        const panelColor = isSelected ? '#e879f9' : isFinished ? '#84cc16' : '#a855f7';
        const channelColor = isFinished ? '#0e7490' : '#7e22ce';
        
        return (
          <group 
            key={tray.id} 
            position={[tray.x / 1000 + l / 2, yPos, internalW / 2]}
            onClick={(e) => { e.stopPropagation(); setSelectedId(tray.id); }}
            onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
            onPointerOut={(e) => { document.body.style.cursor = 'auto'; }}
          >
            <mesh position={[0, floorY, 0]}>
              <boxGeometry args={[l, plateT, w]} />
              <meshStandardMaterial color={channelColor} roughness={0.55} metalness={0.08} />
            </mesh>

            <mesh position={[0, 0, -w / 2 + frame / 2]}>
              <boxGeometry args={[l, h, frame]} />
              <meshStandardMaterial color={wallColor} roughness={0.45} metalness={0.12} />
            </mesh>
            <mesh position={[0, 0, w / 2 - frame / 2]}>
              <boxGeometry args={[l, h, frame]} />
              <meshStandardMaterial color={wallColor} roughness={0.45} metalness={0.12} />
            </mesh>
            <mesh position={[-l / 2 + frame / 2, 0, 0]}>
              <boxGeometry args={[frame, h, w]} />
              <meshStandardMaterial color={wallColor} roughness={0.45} metalness={0.12} />
            </mesh>
            <mesh position={[l / 2 - frame / 2, 0, 0]}>
              <boxGeometry args={[frame, h, w]} />
              <meshStandardMaterial color={wallColor} roughness={0.45} metalness={0.12} />
            </mesh>

            <mesh position={[0, -h / 2 + dividerH / 2, -centerW / 2 - frame / 2]}>
              <boxGeometry args={[usableL, dividerH, frame]} />
              <meshStandardMaterial color={wallColor} roughness={0.45} metalness={0.12} />
            </mesh>
            <mesh position={[0, -h / 2 + dividerH / 2, centerW / 2 + frame / 2]}>
              <boxGeometry args={[usableL, dividerH, frame]} />
              <meshStandardMaterial color={wallColor} roughness={0.45} metalness={0.12} />
            </mesh>

            <mesh position={[0, floorY + plateT, 0]}>
              <boxGeometry args={[usableL, plateT, centerW]} />
              <meshStandardMaterial color={panelColor} roughness={0.48} metalness={0.04} />
            </mesh>

            {Array.from({ length: rows * columns }).map((_, holeIndex) => {
              const row = Math.floor(holeIndex / columns);
              const column = holeIndex % columns;
              const holeX = -usableL / 2 + usableL * (column + 1) / (columns + 1);
              const holeZ = -centerW / 2 + centerW * (row + 1) / (rows + 1);
              return (
                <mesh
                  key={holeIndex}
                  position={[holeX, floorY + plateT * 1.55, holeZ]}
                >
                  <cylinderGeometry args={[holeRadius, holeRadius, 0.008, 14]} />
                  <meshStandardMaterial color="#334155" roughness={0.75} />
                </mesh>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

function pipeFaceTransform(
  connection: PipeConnection,
  internalL: number,
  internalH: number,
  internalW: number,
) {
  const localX = connection.x / 1000;
  const localY = connection.y / 1000;

  switch (connection.face) {
    case 'rear':
      return { point: new THREE.Vector3(internalL, localY, localX), direction: new THREE.Vector3(-1, 0, 0) };
    case 'left':
      return { point: new THREE.Vector3(localX, localY, 0), direction: new THREE.Vector3(0, 0, 1) };
    case 'right':
      return { point: new THREE.Vector3(localX, localY, internalW), direction: new THREE.Vector3(0, 0, -1) };
    case 'top':
      return { point: new THREE.Vector3(localX, internalH, localY), direction: new THREE.Vector3(0, -1, 0) };
    case 'bottom':
      return { point: new THREE.Vector3(localX, 0, localY), direction: new THREE.Vector3(0, 1, 0) };
    case 'access':
    default:
      return { point: new THREE.Vector3(0, localY, localX), direction: new THREE.Vector3(1, 0, 0) };
  }
}

function PipeCylinder({
  start,
  end,
  radius,
  color,
  isSelected,
}: {
  start: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
  color: string;
  isSelected?: boolean;
}) {
  const mode = useContext(VisualModeContext);
  const isFinished = mode === 'finished';
  const matColor = isFinished ? (isSelected ? '#f97316' : '#cbd5e1') : color;
  const roughness = isFinished ? (isSelected ? 0.2 : 0.4) : 0.35;
  const metalness = isFinished ? (isSelected ? 0.2 : 0.6) : 0.65;

  const direction = end.clone().sub(start);
  const length = direction.length();
  const midpoint = start.clone().add(end).multiplyScalar(0.5);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    direction.clone().normalize(),
  );

  return (
    <mesh position={midpoint} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 24]} />
      <meshStandardMaterial color={matColor} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

function PipeElbow({
  start,
  control,
  end,
  radius,
  color,
  isSelected,
}: {
  start: THREE.Vector3;
  control: THREE.Vector3;
  end: THREE.Vector3;
  radius: number;
  color: string;
  isSelected?: boolean;
}) {
  const mode = useContext(VisualModeContext);
  const isFinished = mode === 'finished';
  const matColor = isFinished ? (isSelected ? '#f97316' : '#cbd5e1') : color;
  const roughness = isFinished ? (isSelected ? 0.2 : 0.4) : 0.32;
  const metalness = isFinished ? (isSelected ? 0.2 : 0.6) : 0.65;

  const curve = new THREE.QuadraticBezierCurve3(start, control, end);

  return (
    <mesh>
      <tubeGeometry args={[curve, 20, radius, 16, false]} />
      <meshStandardMaterial color={matColor} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

function PipeConnections() {
  const mode = useContext(VisualModeContext);
  const isFinished = mode === 'finished';
  const pipeConnections = useStore(s => s.pipeConnections);
  const envelope = useStore(s => s.envelope);
  const wallThickness = useStore(s => s.wallThickness);
  const waterLevel = useStore(s => s.waterLevel);
  const selectedId = useStore(s => s.selectedId);
  const setSelectedId = useStore(s => s.setSelectedId);
  const internalL = (envelope.length - 2 * wallThickness) / 1000;
  const internalW = (envelope.width - 2 * wallThickness) / 1000;
  const internalH = (envelope.height - wallThickness) / 1000;

  return (
    <group>
      {pipeConnections.map(connection => {
        const { point, direction } = pipeFaceTransform(connection, internalL, internalH, internalW);
        const stubLength = (connection.pipeLength ?? 300) / 1000;
        const waterMatchedLength = calculateWaterMatchedOutletLength(
          connection,
          envelope,
          wallThickness,
          waterLevel,
        );
        const outletPipeLength = (
          connection.matchWaterLevel && waterMatchedLength !== null
            ? waterMatchedLength
            : connection.outletPipeLength ?? 800
        ) / 1000;
        const radius = Math.max(connection.diameter / 2000, 0.025);
        const coringRadius = Math.max((connection.coringDiameter ?? connection.diameter + 70) / 2000, radius);
        const elbowRadius = Math.max(connection.elbowRadius / 1000, radius * 1.5);
        const baseBranchDirection = connection.face === 'top' || connection.face === 'bottom'
          ? new THREE.Vector3(1, 0, 0)
          : new THREE.Vector3(0, -1, 0);
        const branchDirection = baseBranchDirection.applyAxisAngle(
          direction,
          THREE.MathUtils.degToRad(connection.elbowRotation ?? 0),
        );
        const elbowStart = point.clone().add(direction.clone().multiplyScalar(stubLength));
        const elbowControl = elbowStart.clone().add(direction.clone().multiplyScalar(elbowRadius));
        const elbowEnd = elbowControl.clone().add(branchDirection.clone().multiplyScalar(elbowRadius));
        const branchEnd = elbowEnd.clone().add(branchDirection.multiplyScalar(outletPipeLength));
        const isSelected = selectedId === connection.id;
        const color = isSelected ? '#f97316' : '#475569';
        const sketchQuaternion = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 0, 1),
          direction.clone().negate(),
        );
        const sketchPoint = point.clone().add(direction.clone().multiplyScalar(-0.006));

        return (
          <group
            key={connection.id}
            onClick={(event) => {
              event.stopPropagation();
              setSelectedId(connection.id);
            }}
            onPointerOver={(event) => {
              event.stopPropagation();
              document.body.style.cursor = 'pointer';
            }}
            onPointerOut={() => {
              document.body.style.cursor = 'auto';
            }}
          >
            <mesh position={sketchPoint} quaternion={sketchQuaternion}>
              <ringGeometry args={[coringRadius * 0.9, coringRadius, 40]} />
              {isFinished ? (
                <meshStandardMaterial color={isSelected ? '#38bdf8' : '#64748b'} side={THREE.DoubleSide} />
              ) : (
                <meshBasicMaterial color={isSelected ? '#38bdf8' : '#e2e8f0'} side={THREE.DoubleSide} depthTest={false} />
              )}
            </mesh>
            <mesh position={sketchPoint}>
              <sphereGeometry args={[Math.max(coringRadius * 0.09, 0.012), 12, 8]} />
              {isFinished ? (
                <meshStandardMaterial color={isSelected ? '#0ea5e9' : '#475569'} />
              ) : (
                <meshBasicMaterial color={isSelected ? '#0ea5e9' : '#f8fafc'} depthTest={false} />
              )}
            </mesh>
            <PipeCylinder start={point} end={elbowStart} radius={radius} color={color} isSelected={isSelected} />
            <PipeElbow
              start={elbowStart}
              control={elbowControl}
              end={elbowEnd}
              radius={radius}
              color={color}
              isSelected={isSelected}
            />
            <PipeCylinder start={elbowEnd} end={branchEnd} radius={radius} color={color} isSelected={isSelected} />
            {isSelected && (
              <pointLight position={elbowEnd} color="#f97316" intensity={isFinished ? 0.5 : 1.2} distance={isFinished ? 2 : 1.2} />
            )}
          </group>
        );
      })}
    </group>
  );
}

function CameraController({ viewMode }: { viewMode: string }) {
  const { camera, controls } = useThree();
  
  useEffect(() => {
    if (!controls) return;
    const ctrl = controls as any;
    const target = new THREE.Vector3(4, 1, 1);
    
    switch (viewMode) {
      case 'top':
        camera.position.set(4, 15, 1.01); // slight offset to prevent gimbal lock
        break;
      case 'front':
        camera.position.set(4, 2, 12);
        break;
      case 'side':
        camera.position.set(15, 2, 1);
        break;
      case 'iso':
        camera.position.set(-3, 6, 10);
        break;
    }
    
    camera.lookAt(target);
    ctrl.target.copy(target);
    ctrl.update();
  }, [viewMode, camera, controls]);
  
  return null;
}

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      window.WebGL2RenderingContext && canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: true }) ||
      window.WebGLRenderingContext && canvas.getContext('webgl', { failIfMajorPerformanceCaveat: true }),
    );
  } catch {
    return false;
  }
}

function TechnicalPlanFallback({ visualMode }: { visualMode: 'finished' | 'technical' }) {
  const envelope = useStore(s => s.envelope);
  const wallThickness = useStore(s => s.wallThickness);
  const accessMin = useStore(s => s.accessMin);
  const stacks = useStore(s => s.stacks);
  const trays = useStore(s => s.trays);
  const pipeConnections = useStore(s => s.pipeConnections);
  const crate = useStore(s => s.crate);
  const selectedId = useStore(s => s.selectedId);
  const setSelectedId = useStore(s => s.setSelectedId);
  const validation = useValidation();
  const internalL = envelope.length - wallThickness * 2;
  const internalW = envelope.width - wallThickness * 2;
  const x = (value: number) => 70 + (value / internalL) * 820;
  const y = (value: number) => 105 + (value / internalW) * 380;
  const sx = (value: number) => (value / internalL) * 820;
  const sy = (value: number) => (value / internalW) * 380;
  const isFinished = visualMode === 'finished';

  return (
    <div id="coordination-canvas" className={`flex h-full min-h-[480px] w-full flex-col ${isFinished ? 'bg-slate-300' : 'bg-[#f3f6f8]'}`}>
      <div className={`flex items-center justify-between border-b px-5 py-3 ${isFinished ? 'border-slate-600 bg-slate-800 text-white' : 'border-slate-300 bg-white'}`}>
        <div>
          <p className={`text-[11px] font-semibold uppercase tracking-[0.16em] ${isFinished ? 'text-slate-300' : 'text-slate-500'}`}>
            {isFinished ? 'Hardware-safe finished view' : 'Hardware-safe coordination view'}
          </p>
          <p className={`text-sm ${isFinished ? 'text-slate-100' : 'text-slate-700'}`}>
            WebGL is unavailable. This interactive plan mirrors the selected visual mode; use a hardware-accelerated browser for 3D.
          </p>
        </div>
        <span className={`rounded-sm border px-2.5 py-1 text-xs font-semibold ${validation.isValid ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
          {validation.isValid ? 'COORDINATION VALID' : `${validation.errors.length} CHECKS FAILED`}
        </span>
      </div>
      <div className="min-h-0 flex-1 p-5">
        <svg
          viewBox="0 0 960 560"
          className={`h-full w-full rounded border shadow-xl ${isFinished ? 'border-slate-500 bg-slate-200' : 'border-slate-300 bg-white'}`}
          role="img"
          aria-label={isFinished ? 'Bio Degas finished product plan' : 'Bio Degas plenum technical plan'}
        >
          <defs>
            <pattern id="plan-grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#e2e8f0" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="960" height="560" fill={isFinished ? '#cbd5e1' : 'url(#plan-grid)'} />
          <text x="70" y="45" fill="#0f172a" fontSize="17" fontWeight="700">
            {isFinished ? 'BIO/DEGAS — FINISHED PRODUCT VIEW' : 'BIO/DEGAS PLENUM — TOP COORDINATION PLAN'}
          </text>
          <text x="70" y="69" fill="#64748b" fontSize="12">
            {isFinished ? 'Solid material preview · interactive components' : 'X / longitudinal · Y / transverse · dimensions in millimetres'}
          </text>
          <rect x="56" y="91" width="848" height="408" rx={isFinished ? 10 : 3} fill={isFinished ? '#334155' : '#dbeafe'} fillOpacity={isFinished ? 1 : .24} stroke={isFinished ? '#0f172a' : '#16395f'} strokeWidth={isFinished ? 8 : 4} />
          <rect x="70" y="105" width="820" height="380" rx={isFinished ? 5 : 0} fill={isFinished ? '#64748b' : '#e0f2fe'} fillOpacity={isFinished ? 1 : .35} stroke={isFinished ? '#94a3b8' : '#5c7790'} strokeWidth="1.5" />
          <rect x="70" y="105" width={sx(accessMin)} height="380" fill={isFinished ? '#475569' : '#fbbf24'} fillOpacity={isFinished ? 1 : .25} stroke={isFinished ? '#64748b' : '#d97706'} strokeDasharray={isFinished ? undefined : '8 5'} />
          {!isFinished && (
            <text x={70 + sx(accessMin) / 2} y="306" textAnchor="middle" fill="#92400e" fontSize="12" fontWeight="700" transform={`rotate(-90 ${70 + sx(accessMin) / 2} 306)`}>{accessMin} ACCESS</text>
          )}
          {pipeConnections.filter(connection => connection.face === 'access').map(connection => (
            <g key={connection.id} onClick={() => setSelectedId(connection.id)} className="cursor-pointer">
              <line
                x1={70}
                y1={y(connection.x)}
                x2={x(Math.min(connection.pipeLength, internalL))}
                y2={y(connection.x)}
                stroke={selectedId === connection.id ? '#f97316' : isFinished ? '#e2e8f0' : '#475569'}
                strokeWidth={Math.max(4, sy(connection.diameter))}
                strokeLinecap="round"
              />
              <circle
                cx={70}
                cy={y(connection.x)}
                r={Math.max(6, sy((connection.coringDiameter ?? connection.diameter + 70)) / 2)}
                fill="none"
                stroke={selectedId === connection.id ? '#38bdf8' : isFinished ? '#f8fafc' : '#475569'}
                strokeWidth={selectedId === connection.id ? 4 : 2}
              />
              <circle cx={70} cy={y(connection.x)} r="2.5" fill={isFinished ? '#f8fafc' : '#0284c7'} />
              <text x={82} y={y(connection.x) - 10} fill={isFinished ? '#f8fafc' : '#7c2d12'} fontSize="10" fontWeight="700">{connection.name} · Ø{connection.diameter}</text>
            </g>
          ))}
          {trays.map((tray, index) => {
            const frame = tray.frameWidth ?? 80;
            const sideChannel = tray.sideChannelWidth ?? 360;
            const centerPanelWidth = Math.max(80, tray.width - 2 * (frame + sideChannel));
            const trayY = 105 + (380 - sy(tray.width)) / 2;
            const centerY = 105 + (380 - sy(centerPanelWidth)) / 2;
            const rows = Math.max(1, Math.round(tray.perforationRows ?? 5));
            const columns = Math.max(1, Math.round(tray.perforationColumns ?? 12));
            return (
              <g key={tray.id} onClick={() => setSelectedId(tray.id)} className="cursor-pointer">
                <rect
                  x={x(tray.x)}
                  y={trayY}
                  width={sx(tray.length)}
                  height={sy(tray.width)}
                  fill={isFinished ? '#e2e8f0' : '#0e7490'}
                  fillOpacity={isFinished ? 1 : selectedId === tray.id ? .34 : .20}
                  stroke={selectedId === tray.id ? '#38bdf8' : isFinished ? '#f8fafc' : '#9333ea'}
                  strokeWidth={selectedId === tray.id ? 4 : 2}
                />
                <rect
                  x={x(tray.x + frame)}
                  y={centerY}
                  width={sx(Math.max(80, tray.length - frame * 2))}
                  height={sy(centerPanelWidth)}
                  fill={isFinished ? '#84cc16' : '#a855f7'}
                  fillOpacity={isFinished ? 1 : .32}
                  stroke={selectedId === tray.id ? '#e879f9' : '#7e22ce'}
                  strokeWidth="1.5"
                />
                {Array.from({ length: rows * columns }).map((_, holeIndex) => {
                  const row = Math.floor(holeIndex / columns);
                  const column = holeIndex % columns;
                  const holeX = x(tray.x + frame + (tray.length - frame * 2) * (column + 1) / (columns + 1));
                  const holeY = centerY + sy(centerPanelWidth) * (row + 1) / (rows + 1);
                  return <circle key={holeIndex} cx={holeX} cy={holeY} r="1.8" fill="#334155" />;
                })}
                <text x={x(tray.x) + sx(tray.length) / 2} y={trayY + 18} textAnchor="middle" fill={isFinished ? '#334155' : '#f3e8ff'} fontSize="12" fontWeight="700">TRAY {index + 1}</text>
              </g>
            );
          })}
          {stacks.map(stack => (
            <g key={stack.id} onClick={() => setSelectedId(stack.id)} className="cursor-pointer">
              <rect
                x={x(stack.x)}
                y={y(stack.y)}
                width={sx(crate.width)}
                height={sy(crate.length)}
                fill={selectedId === stack.id ? '#2563eb' : isFinished ? '#0f172a' : '#60a5fa'}
                fillOpacity={isFinished ? 1 : selectedId === stack.id ? .72 : .42}
                stroke={selectedId === stack.id ? '#60a5fa' : isFinished ? '#334155' : '#2563eb'}
                strokeWidth={selectedId === stack.id ? 3 : 1.5}
              />
              <text x={x(stack.x) + sx(crate.width) / 2} y={y(stack.y) + sy(crate.length) / 2 - 3} textAnchor="middle" fill={isFinished ? '#cbd5e1' : '#0f2f55'} fontSize="11" fontWeight="700">
                R{stack.row + 1}C{stack.col + 1}
              </text>
              <text x={x(stack.x) + sx(crate.width) / 2} y={y(stack.y) + sy(crate.length) / 2 + 13} textAnchor="middle" fill={isFinished ? '#94a3b8' : '#0f2f55'} fontSize="10">
                {stack.quantity} crates
              </text>
            </g>
          ))}
          {!isFinished && (
            <>
              <line x1="70" y1="522" x2="890" y2="522" stroke="#16395f" strokeWidth="1.5" />
              <line x1="70" y1="515" x2="70" y2="529" stroke="#16395f" strokeWidth="1.5" />
              <line x1="890" y1="515" x2="890" y2="529" stroke="#16395f" strokeWidth="1.5" />
              <text x="480" y="548" textAnchor="middle" fill="#16395f" fontSize="13" fontWeight="700">{envelope.length} EXTERNAL LENGTH</text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}

export function Scene({ viewMode = 'iso', visualMode = 'finished' }: { viewMode?: string, visualMode?: 'finished' | 'technical' }) {
  const setSelectedId = useStore(s => s.setSelectedId);
  const [webglAvailable] = useState(supportsWebGL);

  if (!webglAvailable) {
    return <TechnicalPlanFallback visualMode={visualMode} />;
  }

  return (
    <VisualModeContext.Provider value={visualMode}>
      <Canvas
        camera={{ position: [-3, 6, 10], fov: 45 }}
        onPointerMissed={() => setSelectedId(null)}
        className="w-full h-full"
        gl={{ preserveDrawingBuffer: true, antialias: true }}
        id="coordination-canvas"
      >
        <color attach="background" args={[visualMode === 'finished' ? '#e2e8f0' : '#f8fafc']} />
        
        {visualMode === 'finished' ? (
          <>
            <ambientLight intensity={0.9} />
            <directionalLight position={[10, 20, 15]} intensity={1.2} castShadow />
            <directionalLight position={[-10, 10, -10]} intensity={0.5} />
            <directionalLight position={[0, 5, 10]} intensity={0.5} />
          </>
        ) : (
          <>
            <ambientLight intensity={0.7} />
            <directionalLight position={[10, 20, 10]} intensity={1.5} castShadow />
            <directionalLight position={[-10, 10, -10]} intensity={0.5} />
            <directionalLight position={[0, 5, 10]} intensity={0.5} />
          </>
        )}
        
        <group position={[0, -1, -1]}>
          <TankShell />
          <AccessZone />
          <WaterVolume />
          <Stacks />
          <Trays />
          <PipeConnections />
        </group>
        
        {visualMode === 'technical' ? (
          <Grid 
            infiniteGrid 
            fadeDistance={40}
            sectionColor="#94a3b8"
            cellColor="#cbd5e1"
            position={[0, -1, 0]}
            cellSize={1}
            sectionSize={5}
          />
        ) : (
          <Grid 
            infiniteGrid 
            fadeDistance={60}
            sectionColor="#cbd5e1"
            cellColor="#e2e8f0"
            position={[0, -1, 0]}
            cellSize={1}
            sectionSize={5}
          />
        )}
        
        <OrbitControls makeDefault minDistance={2} maxDistance={40} target={[4, 1, 1]} dampingFactor={0.1} />
        <CameraController viewMode={viewMode} />
        
        <GizmoHelper alignment="bottom-right" margin={[80, 80]}>
          <GizmoViewport axisColors={['#ef4444', '#22c55e', '#3b82f6']} labelColor="white" />
        </GizmoHelper>
      </Canvas>
    </VisualModeContext.Provider>
  );
}
