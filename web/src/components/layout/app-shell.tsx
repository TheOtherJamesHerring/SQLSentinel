import { motion } from "framer-motion";
import { MoonStar, SunMedium } from "lucide-react";
import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Sidebar } from "./sidebar";

export function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [visualMode, setVisualMode] = useState<"daylight" | "midnight">(() => {
    const saved = localStorage.getItem("sqls_visual_mode");
    return saved === "midnight" ? "midnight" : "daylight";
  });

  useEffect(() => {
    const body = document.body;
    body.classList.toggle("ui-midnight", visualMode === "midnight");
    localStorage.setItem("sqls_visual_mode", visualMode);
  }, [visualMode]);

  return (
    <div className="min-h-screen text-foreground">
      <div className="mx-auto flex max-w-[1600px]">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
        <main className="w-full flex-1 p-4 lg:p-6">
          <div className="mb-4 flex justify-end">
            <button
              onClick={() => setVisualMode((mode) => (mode === "daylight" ? "midnight" : "daylight"))}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium text-muted transition hover:bg-surface-2 hover:text-foreground"
            >
              {visualMode === "daylight" ? <MoonStar className="h-4 w-4" /> : <SunMedium className="h-4 w-4" />}
              {visualMode === "daylight" ? "Switch to midnight view" : "Switch to daylight view"}
            </button>
          </div>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-6"
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
    </div>
  );
}
