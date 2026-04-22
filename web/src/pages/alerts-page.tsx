import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useApiQuery } from "@/hooks/useApiQuery";
import { api } from "@/lib/api";
import type { AlertItem } from "@/lib/types";

interface AlertActionState {
  acknowledging?: boolean;
  resolving?: boolean;
  actionError?: string;
}

export function AlertsPage() {
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [localAlerts, setLocalAlerts] = useState<Map<string, AlertActionState>>(new Map());

  const qs = new URLSearchParams();
  if (status !== "all") qs.set("status", status);
  if (severity !== "all") qs.set("severity", severity);


  const alerts = useApiQuery<AlertItem[]>(["alerts", status, severity], `/alerts?${qs.toString()}`);

  function setAlertState(alertId: string, nextState: AlertActionState) {
    setLocalAlerts((prev) => {
      const map = new Map(prev);
      map.set(alertId, nextState);
      return map;
    });
  }

  async function handleAcknowledge(alertId: string) {
    setAlertState(alertId, { acknowledging: true });
    try {
      await api<AlertItem>(`/alerts/${alertId}/acknowledge`, { method: "POST" });
      await alerts.refetch();
      setLocalAlerts((prev) => {
        const map = new Map(prev);
        map.delete(alertId);
        return map;
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Acknowledge failed";
      setAlertState(alertId, { actionError: msg });
    }
  }

  async function handleResolve(alertId: string) {
    setAlertState(alertId, { resolving: true });
    try {
      await api<AlertItem>(`/alerts/${alertId}/resolve`, { method: "POST" });
      await alerts.refetch();
      setLocalAlerts((prev) => {
        const map = new Map(prev);
        map.delete(alertId);
        return map;
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Resolve failed";
      setAlertState(alertId, { actionError: msg });
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Alerts</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="new">New</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </Select>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="all">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </Select>
        </div>

        <div className="space-y-3">
          {(alerts.data ?? [])
            .slice()
            .sort((a, b) => {
              const order = { critical: 0, warning: 1, info: 2 };
              return (order[a.Severity as keyof typeof order] ?? 3) - (order[b.Severity as keyof typeof order] ?? 3);
            })
            .map((alert) => {
              const local = localAlerts.get(alert.AlertId);
              const alertTypeLabel = alert.AlertType?.replace(/_/g, " ").toUpperCase() || "Unknown";
              return (
                <div
                  key={alert.AlertId}
                  className={`rounded-xl border-l-4 border border-border p-4 transition ${
                    alert.Status === "resolved"
                      ? "opacity-60"
                      : alert.Severity === "critical"
                      ? "border-l-danger bg-danger/5"
                      : alert.Severity === "warning"
                      ? "border-l-warning bg-warning/5"
                      : "border-l-primary"
                  }`}
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <h3
                      className={`font-semibold ${
                        alert.Status === "resolved"
                          ? "text-muted line-through"
                          : alert.Severity === "critical"
                          ? "text-danger"
                          : "text-foreground"
                      }`}
                    >
                      {alert.Title}
                    </h3>
                    <div className="flex gap-2">
                      <Badge label={alert.Severity} tone={alert.Severity === "critical" ? "danger" : alert.Severity === "warning" ? "warning" : "primary"} />
                      <Badge label={alert.Status} tone={alert.Status === "resolved" ? "muted" : alert.Status === "acknowledged" ? "warning" : "primary"} />
                    </div>
                  </div>

                  <p className="text-sm text-foreground/80">{alert.Message}</p>

                  <div className="mt-2 grid gap-1 text-xs text-muted">
                    <p>
                      <strong>Source:</strong> {alertTypeLabel} | <strong>Triggered:</strong> {new Date(alert.TriggeredAt).toLocaleString()}
                    </p>
                    {alert.MetricValue !== undefined && alert.ThresholdValue !== undefined && (
                      <p>
                        <strong>Value:</strong> {alert.MetricValue.toFixed(2)} (threshold: {alert.ThresholdValue.toFixed(2)})
                      </p>
                    )}
                    {alert.AcknowledgedBy && alert.AcknowledgedAt && (
                      <p>
                        <strong>Acknowledged by:</strong> {alert.AcknowledgedBy} at {new Date(alert.AcknowledgedAt).toLocaleString()}
                      </p>
                    )}
                    {alert.ResolvedBy && alert.ResolvedAt && (
                      <p>
                        <strong>Resolved by:</strong> {alert.ResolvedBy} at {new Date(alert.ResolvedAt).toLocaleString()}
                      </p>
                    )}
                  </div>

                  {alert.AiSummary && (
                    <p className="mt-2 text-sm italic text-foreground/70">
                      <strong>AI Summary:</strong> {alert.AiSummary}
                    </p>
                  )}
                  {alert.AiRecommendation && (
                    <p className="mt-1 text-sm italic text-foreground/70">
                      <strong>Recommendation:</strong> {alert.AiRecommendation}
                    </p>
                  )}

                  {alert.Status !== "resolved" && (
                    <div className="mt-4 flex gap-2">
                      <Button
                        variant={alert.Status === "acknowledged" ? "secondary" : "default"}
                        size="sm"
                        onClick={() => handleAcknowledge(alert.AlertId)}
                        disabled={local?.acknowledging || local?.resolving || alert.Status === "acknowledged"}
                      >
                        {local?.acknowledging ? "Acknowledging..." : alert.Status === "acknowledged" ? "✓ Acknowledged" : "Acknowledge"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResolve(alert.AlertId)}
                        disabled={local?.acknowledging || local?.resolving}
                      >
                        {local?.resolving ? "Resolving..." : "Resolve"}
                      </Button>
                    </div>
                  )}

                  {local?.actionError && <p className="mt-2 text-xs text-danger">Error: {local.actionError}</p>}
                </div>
              );
            })}

          {(alerts.data?.length ?? 0) === 0 && (
            <div className="rounded-lg border border-border p-8 text-center text-muted">
              <p>No alerts found matching your filters.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
