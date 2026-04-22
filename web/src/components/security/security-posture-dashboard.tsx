import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import type { SecurityAuditFinding, SecurityAuditRunSummary } from "@/lib/types";

interface SecurityPostureDashboardProps {
  latest: SecurityAuditRunSummary | null;
  history: SecurityAuditRunSummary[];
  findings: SecurityAuditFinding[];
}

function riskTone(flag: SecurityAuditFinding["risk_flag"]) {
  if (flag === "CRITICAL") return "danger" as const;
  if (flag === "HIGH_RISK") return "warning" as const;
  if (flag === "MEDIUM_RISK") return "warning" as const;
  if (flag === "BLIND_SPOT") return "muted" as const;
  return "success" as const;
}

function gradeTone(grade: string) {
  if (grade === "A") return "success" as const;
  if (grade === "B") return "primary" as const;
  if (grade === "C") return "warning" as const;
  if (grade === "D") return "warning" as const;
  return "danger" as const;
}

function trendText(history: SecurityAuditRunSummary[]) {
  if (history.length < 2) {
    return "No trend yet";
  }
  const latest = history[0].score;
  const previous = history[1].score;
  const delta = latest - previous;
  if (delta > 0) return `+${delta} since prior run`;
  if (delta < 0) return `${delta} since prior run`;
  return "No change since prior run";
}

export function SecurityPostureDashboard({ latest, history, findings }: SecurityPostureDashboardProps) {
  const counts = latest?.counts ?? {
    CRITICAL: 0,
    HIGH_RISK: 0,
    MEDIUM_RISK: 0,
    BLIND_SPOT: 0,
    OK: 0
  };

  const riskRows = [
    { label: "Critical", value: counts.CRITICAL, tone: "danger" as const },
    { label: "High Risk", value: counts.HIGH_RISK, tone: "warning" as const },
    { label: "Medium", value: counts.MEDIUM_RISK, tone: "warning" as const },
    { label: "Blind Spot", value: counts.BLIND_SPOT, tone: "muted" as const },
    { label: "OK", value: counts.OK, tone: "success" as const }
  ];

  return (
    <div className="space-y-5">
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Security Posture Score</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-4xl font-bold text-foreground">{latest?.score ?? 0}</p>
            <div className="mt-2">
              <Badge label={`Grade ${latest?.grade ?? "N/A"}`} tone={gradeTone(latest?.grade ?? "F")} />
            </div>
            <p className="mt-2 text-xs text-muted">Deterministic: 100 minus weighted risk deductions, minimum 0.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Risk Concentration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {riskRows.map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <span className="text-sm text-muted">{row.label}</span>
                <Badge label={String(row.value)} tone={row.tone} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-foreground">{trendText(history)}</p>
            <p className="mt-2 text-xs text-muted">Healthy states recede naturally. Risk flags drive movement.</p>
            {latest && (
              <p className="mt-2 text-xs text-muted">
                Last run: {new Date(latest.ranAtUtc).toLocaleString()} ({latest.targetLabel})
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Latest Findings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-[28rem] overflow-auto rounded-lg border border-border">
            <Table>
              <THead>
                <tr>
                  <TH>Risk</TH>
                  <TH>Check</TH>
                  <TH>Finding</TH>
                  <TH>Detail</TH>
                  <TH>Observed (UTC)</TH>
                </tr>
              </THead>
              <tbody>
                {findings.map((finding, index) => (
                  <TR key={`${finding.check_name}-${finding.finding}-${index}`}>
                    <TD>
                      <Badge label={finding.risk_flag} tone={riskTone(finding.risk_flag)} />
                    </TD>
                    <TD className="font-medium">{finding.check_name}</TD>
                    <TD>{finding.finding}</TD>
                    <TD className="max-w-[28rem] whitespace-pre-wrap text-sm text-muted">{finding.detail}</TD>
                    <TD className="text-xs text-muted">{finding.audit_timestamp_utc}</TD>
                  </TR>
                ))}
                {findings.length === 0 && (
                  <TR>
                    <TD colSpan={5} className="py-8 text-center text-sm text-muted">
                      No findings yet. Run the SQL Security Audit to populate this dashboard.
                    </TD>
                  </TR>
                )}
              </tbody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Run History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {history.map((run) => (
              <div key={run.runId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border px-3 py-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{run.targetLabel}</p>
                  <p className="text-xs text-muted">{new Date(run.ranAtUtc).toLocaleString()}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge label={`Score ${run.score}`} tone={gradeTone(run.grade)} />
                  <Badge label={`Grade ${run.grade}`} tone={gradeTone(run.grade)} />
                  <Badge
                    label={run.exportStatus === "success" ? "Fabric Exported" : run.exportStatus === "failed" ? "Fabric Failed" : "Export Skipped"}
                    tone={run.exportStatus === "success" ? "success" : run.exportStatus === "failed" ? "warning" : "muted"}
                  />
                </div>
              </div>
            ))}
            {history.length === 0 && <p className="text-sm text-muted">No history available yet.</p>}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
