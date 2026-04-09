import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { Link } from 'react-router-dom';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import StatusBadge from './StatusBadge';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const STATUS_ICON_COLOR: Record<string, string> = {
  Concept: '#94a3b8',
  'Pre-FEED': '#60a5fa',
  FEED: '#3b82f6',
  'Detail Design': '#6366f1',
  Construction: '#f59e0b',
  Commissioning: '#10b981',
  'Operational': '#22c55e',
  Completed: '#15803d',
  'On Hold': '#f97316',
  Cancelled: '#ef4444',
};

function coloredMarker(status: string) {
  const color = STATUS_ICON_COLOR[status] || '#d97706';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="24" height="36">
    <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z" fill="${color}" stroke="white" stroke-width="1.5"/>
    <circle cx="12" cy="12" r="5" fill="white" opacity="0.9"/>
  </svg>`;
  return L.divIcon({
    html: svg,
    iconSize: [24, 36],
    iconAnchor: [12, 36],
    popupAnchor: [0, -38],
    className: '',
  });
}

function FitBounds({ projects }: { projects: any[] }) {
  const map = useMap();
  useEffect(() => {
    const pts = projects.filter(p => p.latitude != null && p.longitude != null);
    if (pts.length === 0) return;
    if (pts.length === 1) {
      map.setView([pts[0].latitude, pts[0].longitude], 8);
    } else {
      const bounds = L.latLngBounds(pts.map(p => [p.latitude, p.longitude] as [number, number]));
      map.fitBounds(bounds, { padding: [40, 40] });
    }
  }, [projects]);
  return null;
}

interface Props {
  projects: any[];
  height?: string;
  singleProject?: boolean;
}

export default function ProjectsMap({ projects, height = '420px', singleProject = false }: Props) {
  const mapped = projects.filter(p => p.latitude != null && p.longitude != null);
  const unmapped = projects.filter(p => p.latitude == null || p.longitude == null);

  const center: [number, number] = mapped.length > 0
    ? [mapped[0].latitude, mapped[0].longitude]
    : [20, 0];

  return (
    <div className="flex flex-col gap-2">
      <div className="rounded-lg overflow-hidden border border-slate-200" style={{ height }}>
        <MapContainer center={center} zoom={mapped.length === 0 ? 2 : 5} style={{ height: '100%', width: '100%' }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitBounds projects={projects} />
          {mapped.map(p => (
            <Marker
              key={p.id}
              position={[p.latitude, p.longitude]}
              icon={coloredMarker(p.project_status)}
            >
              <Popup>
                <div className="min-w-[180px]">
                  <div className="font-mono text-xs text-slate-400 mb-0.5">{p.project_code}</div>
                  <div className="font-semibold text-slate-800 mb-1">{p.project_name}</div>
                  {(p.city || p.country) && (
                    <div className="text-xs text-slate-500 mb-2">{[p.city, p.country].filter(Boolean).join(', ')}</div>
                  )}
                  <div className="mb-2"><StatusBadge status={p.project_status} /></div>
                  <Link to={`/projects/${p.id}`} className="text-xs text-amber-600 hover:underline font-medium">
                    Open project →
                  </Link>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
      </div>

      {unmapped.length > 0 && !singleProject && (
        <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 text-xs text-amber-700">
          {unmapped.length} project{unmapped.length > 1 ? 's' : ''} without coordinates:{' '}
          {unmapped.slice(0, 5).map(p => p.project_code).join(', ')}
          {unmapped.length > 5 ? ` +${unmapped.length - 5} more` : ''}. Open a project and click Edit to set lat/lng.
        </div>
      )}

      {mapped.length === 0 && (
        <div className="text-center text-sm text-slate-400 py-2">
          No projects have coordinates yet. Open a project, click Edit, and set Latitude / Longitude.
        </div>
      )}
    </div>
  );
}
