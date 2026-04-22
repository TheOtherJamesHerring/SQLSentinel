import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Power, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

export function ServerDetailPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const server = useApiQuery<any>(["server", id], `/servers/${id}`);
  const metrics = useApiQuery<any[]>(["server-metrics", id], `/servers/${id}/metrics`);
  const databases = useApiQuery<any[]>(["server-databases", id], `/servers/${id}/databases`);
  const blocking = useApiQuery<any[]>(["server-blocking", id], `/servers/${id}/blocking`);
  const alerts = useApiQuery<any[]>(["server-alerts", id], `/servers/${id}/alerts`);
  const [busy, setBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const toChart = (type: string) =>
    (metrics.data ?? [])
      .filter((m) => m.MetricType === type)
      .map((m) => ({ name: new Date(m.Timestamp).toLocaleTimeString(), value: Number(m.Value) }));

  async function toggleCollector() {
    if (!id || busy) return;
    setBusy(true);
    try {
      await api(`/servers/${id}/collector`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !Boolean(server.data?.CollectorEnabled) })
      });
      await Promise.all([server.refetch(), metrics.refetch()]);
    } finally {
      setBusy(false);
    }
  }

  async function deleteServer() {
    if (!id || busy) return;

    setBusy(true);
    setDeleteError("");
    try {
      await api(`/servers/${id}`, { method: "DELETE" });
      navigate("/");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Failed to delete server.");
    } finally {
      setBusy(false);
      setConfirmDeleteOpen(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">{server.data?.Name ?? "Server Detail"}</h1>
        <p className="text-slate-400">{server.data?.Hostname}</p>
      </header>

      <section className="flex flex-wrap gap-2">
        <button
          onClick={toggleCollector}
          disabled={busy}
          className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition ${
            Boolean(server.data?.CollectorEnabled)
              ? "border border-emerald-500/40 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20"
              : "border border-amber-500/40 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20"
          } disabled:opacity-50`}
        >
          <Power className="h-4 w-4" />
          {Boolean(server.data?.CollectorEnabled) ? "Disable Collector Stats" : "Enable Collector Stats"}
        </button>

        <button
          onClick={() => setConfirmDeleteOpen(true)}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-300 transition hover:bg-red-500/20 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          Delete Server
        </button>
      </section>

      {deleteError && (
        <section className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          Delete failed: {deleteError}
        </section>
      )}

      {confirmDeleteOpen && (
        <section className="rounded-lg border border-red-500/40 bg-card p-4">
          <p className="text-sm font-semibold text-red-300">Delete this server?</p>
          <p className="mt-1 text-xs text-slate-300">
            This will permanently remove the server, related databases, metrics, alerts, events, and collector history.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              onClick={deleteServer}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              {busy ? "Deleting..." : "Yes, Delete"}
            </button>
            <button
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-border disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </section>
      )}

      <section className="grid gap-4 lg:grid-cols-3">
        <Card><CardHeader><CardTitle>CPU</CardTitle></CardHeader><CardContent><TimeSeriesChart data={toChart("cpu")}    color="#0080FF" warnThreshold={80} criticalThreshold={90} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Memory</CardTitle></CardHeader><CardContent><TimeSeriesChart data={toChart("memory")} color="#22C55E" warnThreshold={85} criticalThreshold={95} /></CardContent></Card>
        <Card><CardHeader><CardTitle>Disk I/O</CardTitle></CardHeader><CardContent><TimeSeriesChart data={toChart("disk")}   color="#F59E0B" warnThreshold={80} criticalThreshold={90} /></CardContent></Card>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Databases</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(databases.data ?? []).map((db) => (
              <div
                key={db.DatabaseId}
                className={`flex items-center justify-between rounded-lg border p-3 ${
                  db.Health === "healthy" ? "border-border" : "border-warning/40 bg-warning/5"
                }`}
              >
                <div>
                  <Link to={`/databases/${db.DatabaseId}`} className="text-sm font-medium text-blue-300 hover:text-blue-200">
                    {db.Name}
                  </Link>
                  <p className="text-xs text-muted">Recovery: {db.RecoveryModel ?? "-"}</p>
                </div>
                <Badge label={db.Health ?? "unknown"} tone={db.Health === "healthy" ? "success" : "warning"} />
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Blocking Sessions Tree</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(blocking.data ?? []).slice(0, 10).map((item) => (
              <div key={item.BlockingId} className="rounded-lg border border-border p-3 text-sm">
                Session {item.SessionId} blocked by {item.BlockingSessionId} ({item.WaitType})
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Recent Alerts and DBCC</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(alerts.data ?? []).slice(0, 10).map((a) => (
              <div key={a.AlertId} className="rounded-lg border border-border p-3 text-sm">
                <p className="font-semibold text-white">{a.Title}</p>
                <p className="text-slate-400">{a.Message}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
