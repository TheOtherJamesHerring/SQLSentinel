import { Database, HardDrive, Home, LayoutList, Link2, Logs, LogOut, PlusCircle, Server, Settings, ShieldAlert } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useAuth } from "@/lib/auth";

const navItems = [
  { to: "/", label: "Dashboard", icon: Home, exact: true },
  { to: "/servers", label: "Servers", icon: Server },
  { to: "/alerts", label: "Alerts", icon: LayoutList },
  { to: "/events", label: "Events", icon: Logs },
  { to: "/capacity", label: "Capacity", icon: HardDrive },
  { to: "/connections", label: "Connections", icon: Link2 },
  { to: "/collector-setup", label: "Collector Setup", icon: Database },
  { to: "/security-posture", label: "Security Posture", icon: ShieldAlert },
  { to: "/settings", label: "Settings", icon: Settings }
];

export function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { logout, user } = useAuth();
  const navigate = useNavigate();

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <aside className={cn("hidden flex-col border-r border-border bg-card/95 p-3 lg:flex", collapsed ? "w-16" : "w-64")}>
      <button className="mb-3 rounded-lg border border-border px-2 py-2 text-xs text-muted hover:bg-surface-2" onClick={onToggle}>
        {collapsed ? ">>" : "<<"}
      </button>
      <div className={cn("mb-4 rounded-xl bg-surface-2 py-3 text-lg font-bold text-foreground", collapsed ? "px-2 text-center text-xs" : "px-4")}>
        {collapsed ? "SQL" : "SQLSentinnel"}
      </div>

      {/* Add Server CTA */}
      <NavLink
        to="/servers/new"
        className="nav-cta mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition"
      >
        <PlusCircle className="h-4 w-4 shrink-0" />
        {!collapsed && "Add Server"}
      </NavLink>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.exact}
            className={({ isActive }) =>
              cn(
                "nav-item flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition-colors",
                isActive ? "nav-item-active" : ""
              )
            }
          >
            <item.icon className="h-4 w-4" />
            {!collapsed && item.label}
          </NavLink>
        ))}
      </nav>

      {/* User + logout */}
      <div className={cn("mt-3 border-t border-border pt-3", collapsed ? "flex justify-center" : "")}>
        {!collapsed && user && (
          <p className="mb-2 px-3 text-xs text-muted">
            {user.name} <span className="text-muted">·</span> <span className="capitalize">{user.role}</span>
          </p>
        )}
        <button
          onClick={handleLogout}
          className="nav-logout flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted transition"
        >
          <LogOut className="h-4 w-4" />
          {!collapsed && "Sign out"}
        </button>
      </div>
    </aside>
  );
}
