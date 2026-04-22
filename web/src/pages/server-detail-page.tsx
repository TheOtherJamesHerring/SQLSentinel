import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimeSeriesChart } from "@/components/charts/time-series-chart";
import { useApiQuery } from "@/hooks/useApiQuery";
import { Badge } from "@/components/ui/badge";

export function ServerDetailPage() {
  const { id = "" } = useParams();
  const server = useApiQuery<any>(["server", id], `/servers/${id}`);
  const metrics = useApiQuery<any[]>(["server-metrics", id], `/servers/${id}/metrics`);
  const databases = useApiQuery<any[]>(["server-databases", id], `/servers/${id}/databases`);
  const blocking = useApiQuery<any[]>(["server-blocking", id], `/servers/${id}/blocking`);
  const alerts = useApiQuery<any[]>(["server-alerts", id], `/servers/${id}/alerts`);

  const toChart = (type: string) =>
    (metrics.data ?? [])
      .filter((m) => m.MetricType === type)
      .map((m) => ({ name: new Date(m.Timestamp).toLocaleTimeString(), value: Number(m.Value) }));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-white">{server.data?.Name ?? "Server Detail"}</h1>
        <p className="text-slate-400">{server.data?.Hostname}</p>
      </header>

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
