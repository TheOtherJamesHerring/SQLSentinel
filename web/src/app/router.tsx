import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";
import { AlertsPage } from "@/pages/alerts-page";
import { CapacityPage } from "@/pages/capacity-page";
import { CollectorSetupPage } from "@/pages/collector-setup-page";
import { ConnectionBuilderPage } from "@/pages/connection-builder-page";
import { ConnectionsPage } from "@/pages/connections-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { DatabaseDetailPage } from "@/pages/database-detail-page";
import { EventsPage } from "@/pages/events-page";
import { LoginPage } from "@/pages/login-page";
import { ServerDetailPage } from "@/pages/server-detail-page";
import { SetupWizardPage } from "@/pages/setup-wizard-page";
import { ServersPage } from "@/pages/servers-page";
import { SettingsPage } from "@/pages/settings-page";
import { SecurityPosturePage } from "@/pages/security-posture-page";
import { SqlQueriesPage } from "@/pages/sql-queries-page";
import { useAuth } from "@/lib/auth";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { token } = useAuth();
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function AppRouter() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<ProtectedRoute><SetupWizardPage /></ProtectedRoute>} />

      {/* Protected app shell */}
      <Route element={<ProtectedRoute><AppShell /></ProtectedRoute>}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/servers" element={<ServersPage />} />
        <Route path="/servers/new" element={<SetupWizardPage />} />
        <Route path="/servers/:id" element={<ServerDetailPage />} />
        <Route path="/databases/:id" element={<DatabaseDetailPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/events" element={<EventsPage />} />
        <Route path="/capacity" element={<CapacityPage />} />
        <Route path="/connections" element={<ConnectionsPage />} />
        <Route path="/connection-builder" element={<ConnectionBuilderPage />} />
        <Route path="/collector-setup" element={<CollectorSetupPage />} />
        <Route path="/sql-queries" element={<SqlQueriesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/security-posture" element={<SecurityPosturePage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}