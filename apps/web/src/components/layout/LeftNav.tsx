import { NavLink, useLocation } from 'react-router-dom';
import { FolderOpen, Package, BookOpen, FileText, Network, Search, Settings, Users, Upload, LayoutDashboard, ChevronDown, ChevronRight, Database } from 'lucide-react';
import { useState } from 'react';
import clsx from 'clsx';

const NavItem = ({ to, icon: Icon, label, end }: { to: string; icon: any; label: string; end?: boolean }) => (
  <NavLink
    to={to}
    end={end}
    className={({ isActive }) => clsx(
      'flex items-center gap-2.5 px-3 py-2 text-sm rounded-md transition-colors',
      isActive ? 'bg-[#3E5C76] text-white' : 'text-[#A8C4E0] hover:bg-[#2d3d5c] hover:text-white'
    )}
  >
    <Icon className="w-4 h-4 shrink-0" />
    <span>{label}</span>
  </NavLink>
);

const NavGroup = ({ label, icon: Icon, children }: { label: string; icon: any; children: React.ReactNode }) => {
  const location = useLocation();
  const [open, setOpen] = useState(location.pathname.includes(label.toLowerCase().replace(' ', '/')));
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2.5 px-3 py-2 text-sm text-[#748CAB] hover:text-white w-full rounded-md hover:bg-[#2d3d5c] transition-colors"
      >
        <Icon className="w-4 h-4 shrink-0" />
        <span className="flex-1 text-left">{label}</span>
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>
      {open && <div className="ml-6 mt-0.5 space-y-0.5">{children}</div>}
    </div>
  );
};

export default function LeftNav() {
  return (
    <nav className="w-56 bg-[#1F2A44] flex flex-col h-full shrink-0">
      <div className="p-4 border-b border-[#2d3d5c]">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-[#3E5C76]" />
          <div>
            <div className="text-white text-sm font-semibold leading-tight">Eng. Data</div>
            <div className="text-[#748CAB] text-xs">Platform v0.1</div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
        <NavItem to="/" icon={LayoutDashboard} label="Dashboard" end />
        <NavItem to="/projects" icon={FolderOpen} label="Projects" />
        <NavItem to="/search" icon={Search} label="Search" />

        <div className="pt-2 pb-1 px-3 text-xs text-[#748CAB] uppercase tracking-wider">Product Library</div>
        <NavItem to="/products" icon={Package} label="Families" end />
        <NavItem to="/products/masters" icon={Package} label="Products" />

        <div className="pt-2 pb-1 px-3 text-xs text-[#748CAB] uppercase tracking-wider">Knowledge Hub</div>
        <NavItem to="/knowledge/materials" icon={BookOpen} label="Materials" />
        <NavItem to="/knowledge/specifications" icon={BookOpen} label="Specifications" />
        <NavItem to="/knowledge/design-rules" icon={BookOpen} label="Design Rules" />

        <div className="pt-2 pb-1 px-3 text-xs text-[#748CAB] uppercase tracking-wider">Documents</div>
        <NavItem to="/documents" icon={FileText} label="Document Register" />

        <div className="pt-2 pb-1 px-3 text-xs text-[#748CAB] uppercase tracking-wider">Intelligence</div>
        <NavItem to="/graph" icon={Network} label="Graph Explorer" />

        <div className="pt-2 pb-1 px-3 text-xs text-[#748CAB] uppercase tracking-wider">Admin</div>
        <NavItem to="/admin/users" icon={Users} label="Users" />
        <NavItem to="/admin/import" icon={Upload} label="CSV Import" />
      </div>
    </nav>
  );
}
