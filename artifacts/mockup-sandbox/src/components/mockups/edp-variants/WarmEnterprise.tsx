import React from "react";
import {
  Search,
  Bell,
  Settings,
  User,
  LayoutDashboard,
  Library,
  ShoppingCart,
  Database,
  Plus,
  BookOpen,
  BarChart2,
  Users,
  Box,
  FileText,
  Activity,
  AlertCircle,
  MoreVertical,
  ArrowRight,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export function WarmEnterprise() {
  return (
    <div className="min-h-screen bg-[#fafaf9] flex w-full font-sans text-stone-900">
      {/* Sidebar */}
      <aside className="w-64 bg-stone-100 border-r border-stone-200 flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-stone-200">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-600 flex items-center justify-center text-white font-bold shadow-sm">
              E
            </div>
            <span className="font-semibold text-lg tracking-tight text-stone-800">
              EDP
            </span>
          </div>
        </div>

        <div className="flex-1 py-6 px-4 flex flex-col gap-8">
          <nav className="space-y-1">
            <NavItem icon={<LayoutDashboard size={18} />} label="Dashboard" active />
            <NavItem icon={<Library size={18} />} label="Library" />
            <NavItem icon={<ShoppingCart size={18} />} label="Procurement" />
            <NavItem icon={<Database size={18} />} label="Systems" />
          </nav>

          <div>
            <h3 className="px-3 text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">
              Recent Projects
            </h3>
            <div className="space-y-1">
              <ProjectItem label="Seattle Aquarium Exp." color="bg-blue-500" />
              <ProjectItem label="Ocean Voyager Tank" color="bg-teal-500" />
              <ProjectItem label="Pacific Seas Filter" color="bg-indigo-500" />
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-stone-200">
          <div className="flex items-center gap-3 px-3 py-2 rounded-md hover:bg-stone-200 transition-colors cursor-pointer text-sm">
            <div className="w-8 h-8 rounded-full bg-stone-300 flex items-center justify-center overflow-hidden">
              <User size={16} className="text-stone-600" />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="font-medium text-stone-800 truncate">Alex Engineer</p>
              <p className="text-xs text-stone-500 truncate">alex@edp.com</p>
            </div>
            <Settings size={16} className="text-stone-400" />
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-16 bg-white border-b border-stone-200 flex items-center justify-between px-8 z-10">
          <div className="flex items-center gap-4 flex-1">
            <h1 className="text-xl font-semibold text-stone-800">Dashboard</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="relative w-64">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400"
              />
              <Input
                placeholder="Search products, POs..."
                className="pl-9 bg-stone-50 border-stone-200 text-sm focus-visible:ring-amber-500 focus-visible:border-amber-500 rounded-full h-9"
              />
            </div>
            <Button variant="ghost" size="icon" className="text-stone-500 rounded-full hover:bg-stone-100 relative">
              <Bell size={18} />
              <span className="absolute top-2 right-2.5 w-2 h-2 bg-amber-500 rounded-full border border-white"></span>
            </Button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 overflow-auto p-8">
          <div className="max-w-6xl mx-auto space-y-8">
            {/* KPIs */}
            <div className="grid grid-cols-4 gap-6">
              <KpiCard title="Products" value="1,284" icon={<Box size={20} className="text-amber-600" />} trend="+12 this week" />
              <KpiCard title="Active POs" value="23" icon={<FileText size={20} className="text-amber-600" />} trend="4 pending approval" />
              <KpiCard title="Systems" value="47" icon={<Activity size={20} className="text-amber-600" />} trend="Across 3 projects" />
              <KpiCard title="Pending Reviews" value="5" icon={<AlertCircle size={20} className="text-amber-600" />} trend="Requires action" alert />
            </div>

            <div className="grid grid-cols-3 gap-6">
              {/* Main List */}
              <div className="col-span-2 space-y-6">
                <Card className="border-stone-200 shadow-sm rounded-xl bg-white overflow-hidden">
                  <CardHeader className="border-b border-stone-100 bg-white px-6 py-4 flex flex-row items-center justify-between">
                    <div>
                      <CardTitle className="text-lg font-medium text-stone-800">Recent Purchase Orders</CardTitle>
                      <CardDescription className="text-stone-500 mt-1">Latest procurement activity across all projects</CardDescription>
                    </div>
                    <Button variant="outline" size="sm" className="text-stone-600 border-stone-200 hover:bg-stone-50">View All</Button>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="divide-y divide-stone-100">
                      <PoRow id="PO-2023-089" supplier="Aquatic Pumps Inc" amount="$12,450.00" status="Released" date="Oct 24, 2023" />
                      <PoRow id="PO-2023-088" supplier="ClearGlass Tanks" amount="$45,200.00" status="Review" date="Oct 23, 2023" />
                      <PoRow id="PO-2023-087" supplier="Industrial Piping Co" amount="$3,120.50" status="Draft" date="Oct 21, 2023" />
                      <PoRow id="PO-2023-086" supplier="Marine Sensors Ltd" amount="$8,900.00" status="Released" date="Oct 19, 2023" />
                      <PoRow id="PO-2023-085" supplier="Aquatic Pumps Inc" amount="$4,250.00" status="Received" date="Oct 15, 2023" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Sidebar Cards */}
              <div className="space-y-6">
                <Card className="border-stone-200 shadow-sm rounded-xl bg-white">
                  <CardHeader className="pb-3 px-6 pt-6">
                    <CardTitle className="text-sm font-semibold text-stone-800 uppercase tracking-wider">Quick Actions</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4 pb-6 space-y-2">
                    <QuickAction icon={<Plus size={16} />} label="New Purchase Order" primary />
                    <QuickAction icon={<BookOpen size={16} />} label="Browse Library" />
                    <QuickAction icon={<BarChart2 size={16} />} label="View Reports" />
                    <QuickAction icon={<Users size={16} />} label="Team Members" />
                  </CardContent>
                </Card>

                <Card className="border-amber-100 bg-amber-50 shadow-sm rounded-xl">
                  <CardContent className="p-6">
                    <h4 className="font-medium text-amber-900 mb-2">Needs Attention</h4>
                    <p className="text-sm text-amber-700 mb-4 leading-relaxed">
                      You have 2 purchase orders waiting for technical review in the Seattle Aquarium Expansion project.
                    </p>
                    <Button className="w-full bg-amber-600 hover:bg-amber-700 text-white shadow-sm border-0">
                      Review Now
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode; label: string; active?: boolean }) {
  return (
    <div
      className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-all ${
        active
          ? "bg-white text-amber-600 shadow-sm font-medium border border-stone-200/60"
          : "text-stone-600 hover:bg-stone-200/50 hover:text-stone-900"
      }`}
    >
      <div className={active ? "text-amber-600" : "text-stone-500"}>{icon}</div>
      <span className="text-sm">{label}</span>
    </div>
  );
}

function ProjectItem({ label, color }: { label: string; color: string }) {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-md cursor-pointer hover:bg-stone-200/50 group text-sm">
      <div className={`w-2 h-2 rounded-full ${color}`} />
      <span className="text-stone-600 group-hover:text-stone-900 truncate">{label}</span>
    </div>
  );
}

function KpiCard({ title, value, icon, trend, alert = false }: { title: string; value: string; icon: React.ReactNode; trend: string; alert?: boolean }) {
  return (
    <Card className="border-stone-200 shadow-sm rounded-xl bg-white transition-all hover:shadow-md">
      <CardContent className="p-6">
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-sm font-medium text-stone-500">{title}</h3>
          <div className={`p-2 rounded-lg ${alert ? 'bg-red-50' : 'bg-amber-50'}`}>
            {icon}
          </div>
        </div>
        <div className="flex flex-col">
          <span className="text-3xl font-semibold text-stone-900 tracking-tight mb-1">{value}</span>
          <span className={`text-xs font-medium ${alert ? 'text-red-600' : 'text-stone-500'}`}>
            {trend}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function PoRow({ id, supplier, amount, status, date }: { id: string; supplier: string; amount: string; status: string; date: string }) {
  const statusColors: Record<string, string> = {
    Draft: "bg-stone-100 text-stone-600 hover:bg-stone-200",
    Review: "bg-amber-100 text-amber-700 hover:bg-amber-200",
    Released: "bg-emerald-100 text-emerald-700 hover:bg-emerald-200",
    Received: "bg-blue-100 text-blue-700 hover:bg-blue-200",
  };

  return (
    <div className="flex items-center justify-between px-6 py-4 hover:bg-stone-50/50 transition-colors group">
      <div className="flex items-center gap-4 flex-1">
        <div className="w-10 h-10 rounded-lg bg-stone-100 flex items-center justify-center border border-stone-200">
          <FileText size={18} className="text-stone-500" />
        </div>
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="font-medium text-sm text-stone-900">{id}</span>
            <Badge variant="secondary" className={`${statusColors[status]} font-medium border-0`}>
              {status}
            </Badge>
          </div>
          <div className="text-xs text-stone-500 flex items-center gap-2">
            <span>{supplier}</span>
            <span className="w-1 h-1 rounded-full bg-stone-300"></span>
            <span>{date}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-6">
        <span className="font-medium text-sm text-stone-800">{amount}</span>
        <Button variant="ghost" size="icon" className="text-stone-400 hover:text-stone-700 opacity-0 group-hover:opacity-100 transition-opacity">
          <MoreVertical size={16} />
        </Button>
      </div>
    </div>
  );
}

function QuickAction({ icon, label, primary = false }: { icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <Button
      variant="ghost"
      className={`w-full justify-between h-11 px-4 font-normal rounded-lg transition-all ${
        primary 
          ? "bg-amber-600 hover:bg-amber-700 text-white shadow-sm hover:text-white" 
          : "bg-transparent text-stone-700 hover:bg-stone-100 border border-transparent hover:border-stone-200"
      }`}
    >
      <div className="flex items-center gap-3">
        <span className={primary ? "text-amber-100" : "text-stone-400"}>{icon}</span>
        <span className={primary ? "font-medium" : ""}>{label}</span>
      </div>
      {!primary && <ArrowRight size={14} className="text-stone-400 opacity-50" />}
    </Button>
  );
}
