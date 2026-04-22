import { useEffect, useMemo, useState } from "react";
import { Activity, Bell, Mail, RefreshCw, ServerCog, ShieldCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Threshold = {
  ThresholdId: string;
  Name: string;
  MetricType: string;
  WarningValue: number;
  CriticalValue: number;
  Unit: string | null;
  Description: string | null;
  IsEnabled: boolean;
};

type DispatchConfig = {
  ConfigId: string;
  Channel: string;
  IsEnabled: boolean;
  ConfigData: Record<string, unknown>;
};

type LiteServer = {
  ServerId: string;
  Name: string;
  Hostname: string;
  Environment: string;
};

type LiteUser = {
  userId: string;
  displayName: string;
  role: "admin" | "viewer";
};

type AccessEntry = {
  AccessId: string;
  UserId: string;
  ServerId: string;
  Role: "admin" | "viewer";
  GrantedBy: string;
  GrantedAt: string;
  ServerName: string;
  Environment: string;
};

type CleanupResult = {
  table: string;
  deleted: number;
};

type DispatchRunResult = {
  pending: number;
  sent: number;
  failed: number;
  suppressed: number;
};

type JobRun = {
  JobRunId: string;
  JobName: string;
  RunType: string;
  Status: string;
  StartedAt: string;
  FinishedAt: string | null;
  DurationMs: number | null;
  Summary: string | null;
};

const sectionCardCls =
  "rounded-2xl border border-border/90 bg-gradient-to-b from-card via-card to-background shadow-[0_8px_30px_rgba(11,99,206,0.08)]";

export function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [dispatchConfigs, setDispatchConfigs] = useState<DispatchConfig[]>([]);
  const [servers, setServers] = useState<LiteServer[]>([]);
  const [users, setUsers] = useState<LiteUser[]>([]);
  const [accessEntries, setAccessEntries] = useState<AccessEntry[]>([]);
  const [jobRuns, setJobRuns] = useState<JobRun[]>([]);

  const [selectedUserId, setSelectedUserId] = useState("viewer");
  const [selectedServerId, setSelectedServerId] = useState("");
  const [selectedRole, setSelectedRole] = useState<"admin" | "viewer">("viewer");
  const [cleanupResults, setCleanupResults] = useState<CleanupResult[] | null>(null);
  const [dispatchResult, setDispatchResult] = useState<DispatchRunResult | null>(null);

  const sortedThresholds = useMemo(
    () => [...thresholds].sort((a, b) => a.Name.localeCompare(b.Name)),
    [thresholds]
  );

  const slack = useMemo(() => {
    return (
      dispatchConfigs.find((item) => item.Channel.toLowerCase() === "slack") ?? {
        ConfigId: "",
        Channel: "slack",
        IsEnabled: false,
        ConfigData: { webhookUrl: "", channel: "#sql-monitoring" }
      }
    );
  }, [dispatchConfigs]);

  const email = useMemo(() => {
    return (
      dispatchConfigs.find((item) => item.Channel.toLowerCase() === "email") ?? {
        ConfigId: "",
        Channel: "email",
        IsEnabled: false,
        ConfigData: {
          smtpHost: "",
          smtpPort: 587,
          smtpSecure: false,
          smtpUser: "",
          smtpPass: "",
          fromAddress: "",
          toAddresses: []
        }
      }
    );
  }, [dispatchConfigs]);

  useEffect(() => {
    void loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);

    try {
      const [thresholdRows, dispatchRows, serverRows, userRows, accessRows, runRows] = await Promise.all([
        api<Threshold[]>("/settings/thresholds"),
        api<DispatchConfig[]>("/alerts/dispatch-config"),
        api<LiteServer[]>("/settings/servers-lite"),
        api<LiteUser[]>("/settings/users-lite"),
        api<AccessEntry[]>("/settings/server-access"),
        isAdmin ? api<JobRun[]>("/settings/job-runs?limit=40") : Promise.resolve([])
      ]);

      setThresholds(thresholdRows);
      setDispatchConfigs(dispatchRows);
      setServers(serverRows);
      setUsers(userRows);
      setAccessEntries(accessRows);
      setJobRuns(runRows);

      if (serverRows.length > 0) {
        setSelectedServerId((current) => current || serverRows[0].ServerId);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }

  function updateThreshold(edited: Threshold) {
    setThresholds((current) => current.map((row) => (row.ThresholdId === edited.ThresholdId ? edited : row)));
  }

  async function saveThreshold(item: Threshold) {
    if (!isAdmin) return;
    setSaving(`threshold-${item.ThresholdId}`);
    setError(null);

    try {
      const updated = await api<Threshold>(`/settings/thresholds/${item.ThresholdId}`, {
        method: "PATCH",
        body: JSON.stringify({
          warningValue: Number(item.WarningValue),
          criticalValue: Number(item.CriticalValue),
          isEnabled: Boolean(item.IsEnabled)
        })
      });

      setThresholds((current) => current.map((row) => (row.ThresholdId === updated.ThresholdId ? updated : row)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save threshold");
    } finally {
      setSaving(null);
    }
  }

  function updateDispatchConfig(channel: "slack" | "email", partial: Partial<DispatchConfig>) {
    setDispatchConfigs((current) =>
      current.map((item) => (item.Channel.toLowerCase() === channel ? { ...item, ...partial } : item))
    );
  }

  function updateConfigData(channel: "slack" | "email", partial: Record<string, unknown>) {
    setDispatchConfigs((current) =>
      current.map((item) => {
        if (item.Channel.toLowerCase() !== channel) return item;
        return {
          ...item,
          ConfigData: { ...item.ConfigData, ...partial }
        };
      })
    );
  }

  async function saveDispatchConfig(channel: "slack" | "email") {
    if (!isAdmin) return;
    setSaving(`save-${channel}`);
    setError(null);

    const active = channel === "slack" ? slack : email;

    try {
      await api<{ ok: boolean }>(`/alerts/dispatch-config/${channel}`, {
        method: "PATCH",
        body: JSON.stringify({
          isEnabled: active.IsEnabled,
          configData: active.ConfigData
        })
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to save ${channel} config`);
    } finally {
      setSaving(null);
    }
  }

  async function testDispatchConfig(channel: "slack" | "email") {
    if (!isAdmin) return;
    setSaving(`test-${channel}`);
    setError(null);

    try {
      await api<{ ok: boolean }>(`/alerts/dispatch-config/test/${channel}`, { method: "POST" });
      alert(`${channel.toUpperCase()} test sent successfully.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to send ${channel} test`);
    } finally {
      setSaving(null);
    }
  }

  async function grantAccess() {
    if (!isAdmin || !selectedServerId || !selectedUserId) return;

    setSaving("grant-access");
    setError(null);

    try {
      await api<{ ok: boolean }>("/settings/server-access", {
        method: "POST",
        body: JSON.stringify({
          userId: selectedUserId,
          serverId: selectedServerId,
          role: selectedRole
        })
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to grant access");
    } finally {
      setSaving(null);
    }
  }

  async function revokeAccess(userId: string, serverId: string) {
    if (!isAdmin) return;
    setSaving(`revoke-${userId}-${serverId}`);
    setError(null);

    try {
      await api<unknown>(`/settings/server-access?userId=${encodeURIComponent(userId)}&serverId=${encodeURIComponent(serverId)}`, {
        method: "DELETE"
      });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to revoke access");
    } finally {
      setSaving(null);
    }
  }

  async function runRetentionCleanupNow() {
    if (!isAdmin) return;
    setSaving("retention-run");
    setError(null);

    try {
      const results = await api<CleanupResult[]>("/settings/retention/run-now", {
        method: "POST"
      });
      setCleanupResults(results);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run retention cleanup");
    } finally {
      setSaving(null);
    }
  }

  async function runDispatchNow() {
    if (!isAdmin) return;
    setSaving("dispatch-run");
    setError(null);

    try {
      const result = await api<DispatchRunResult>("/settings/dispatch/run-now", { method: "POST" });
      setDispatchResult(result);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run alert dispatch");
    } finally {
      setSaving(null);
    }
  }

  const lastDispatchRun = jobRuns.find((run) => run.JobName === "alert-dispatch");
  const lastRetentionRun = jobRuns.find((run) => run.JobName === "retention-cleanup");

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/80 bg-[radial-gradient(circle_at_top_left,rgba(11,99,206,0.18),transparent_50%),radial-gradient(circle_at_bottom_right,rgba(15,159,110,0.14),transparent_45%)] p-6 shadow-[0_10px_40px_rgba(16,35,58,0.08)]">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            Operations Console
          </span>
          <span className="text-xs text-muted">Unified controls for alerting, security and maintenance.</span>
        </div>
        <h1 className="mt-3 text-2xl font-semibold text-foreground">Settings & Operations</h1>
      </div>

      {error ? (
        <Card className="border-danger/30 bg-danger/5">
          <CardContent className="py-3 text-sm text-danger">{error}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatusTile icon={Bell} title="Alert Dispatch" value={lastDispatchRun?.Status ?? "No runs"} note={formatRunTime(lastDispatchRun?.StartedAt)} />
        <StatusTile icon={RefreshCw} title="Retention Job" value={lastRetentionRun?.Status ?? "No runs"} note={formatRunTime(lastRetentionRun?.StartedAt)} />
        <StatusTile icon={ShieldCheck} title="Access Rules" value={`${accessEntries.length}`} note="Active assignments" />
        <StatusTile icon={Activity} title="Threshold Profiles" value={`${thresholds.length}`} note="Configured monitors" />
      </div>

      <Card className={sectionCardCls}>
        <CardHeader>
          <CardTitle>Alert Thresholds</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-muted">Loading thresholds...</p> : null}
          {!loading && sortedThresholds.length === 0 ? <p className="text-sm text-muted">No thresholds found.</p> : null}

          {sortedThresholds.map((item) => (
            <div key={item.ThresholdId} className="grid gap-3 rounded-xl border border-border/80 bg-background/50 p-3 md:grid-cols-[1.7fr_1fr_1fr_1fr_auto]">
              <div>
                <p className="text-sm font-medium text-foreground">{item.Name}</p>
                <p className="text-xs text-muted">{item.Description ?? item.MetricType}</p>
              </div>
              <Input type="number" value={item.WarningValue} disabled={!isAdmin} onChange={(e) => updateThreshold({ ...item, WarningValue: Number(e.target.value) })} />
              <Input type="number" value={item.CriticalValue} disabled={!isAdmin} onChange={(e) => updateThreshold({ ...item, CriticalValue: Number(e.target.value) })} />
              <label className="flex items-center gap-2 text-xs text-muted">
                <input type="checkbox" checked={Boolean(item.IsEnabled)} disabled={!isAdmin} onChange={(e) => updateThreshold({ ...item, IsEnabled: e.target.checked })} />
                Enabled
              </label>
              <Button disabled={!isAdmin || saving === `threshold-${item.ThresholdId}`} onClick={() => void saveThreshold(item)}>
                {saving === `threshold-${item.ThresholdId}` ? "Saving..." : "Save"}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className={sectionCardCls}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-primary" />
              Slack Dispatch
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input value={String(slack.ConfigData.webhookUrl ?? "")} disabled={!isAdmin} placeholder="Webhook URL" onChange={(e) => updateConfigData("slack", { webhookUrl: e.target.value })} />
            <Input value={String(slack.ConfigData.channel ?? "#sql-monitoring")} disabled={!isAdmin} placeholder="Channel" onChange={(e) => updateConfigData("slack", { channel: e.target.value })} />
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={Boolean(slack.IsEnabled)} disabled={!isAdmin} onChange={(e) => updateDispatchConfig("slack", { IsEnabled: e.target.checked })} />
              Enable Slack notifications
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!isAdmin || saving === "test-slack"} onClick={() => void testDispatchConfig("slack")}>
                {saving === "test-slack" ? "Testing..." : "Send Test"}
              </Button>
              <Button disabled={!isAdmin || saving === "save-slack"} onClick={() => void saveDispatchConfig("slack")}>
                {saving === "save-slack" ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className={sectionCardCls}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-primary" />
              Email Dispatch (SMTP)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Input value={String(email.ConfigData.smtpHost ?? email.ConfigData.smtpServer ?? "")} disabled={!isAdmin} placeholder="SMTP host" onChange={(e) => updateConfigData("email", { smtpHost: e.target.value, smtpServer: e.target.value })} />
              <Input type="number" value={String(email.ConfigData.smtpPort ?? 587)} disabled={!isAdmin} placeholder="Port" onChange={(e) => updateConfigData("email", { smtpPort: Number(e.target.value) })} />
              <Input value={String(email.ConfigData.smtpUser ?? "")} disabled={!isAdmin} placeholder="SMTP user" onChange={(e) => updateConfigData("email", { smtpUser: e.target.value })} />
              <Input type="password" value={String(email.ConfigData.smtpPass ?? "")} disabled={!isAdmin} placeholder="SMTP password" onChange={(e) => updateConfigData("email", { smtpPass: e.target.value })} />
            </div>
            <Input value={String(email.ConfigData.fromAddress ?? "")} disabled={!isAdmin} placeholder="From address" onChange={(e) => updateConfigData("email", { fromAddress: e.target.value })} />
            <Input value={Array.isArray(email.ConfigData.toAddresses) ? email.ConfigData.toAddresses.join(",") : String(email.ConfigData.toAddresses ?? "")} disabled={!isAdmin} placeholder="Recipients (comma-separated)" onChange={(e) => updateConfigData("email", { toAddresses: e.target.value.split(",").map((x) => x.trim()).filter((x) => x.length > 0) })} />
            <label className="flex items-center gap-2 text-sm text-foreground">
              <input type="checkbox" checked={Boolean(email.IsEnabled)} disabled={!isAdmin} onChange={(e) => updateDispatchConfig("email", { IsEnabled: e.target.checked })} />
              Enable Email notifications
            </label>
            <div className="flex gap-2">
              <Button variant="secondary" disabled={!isAdmin || saving === "test-email"} onClick={() => void testDispatchConfig("email")}>
                {saving === "test-email" ? "Testing..." : "Send Test"}
              </Button>
              <Button disabled={!isAdmin || saving === "save-email"} onClick={() => void saveDispatchConfig("email")}>
                {saving === "save-email" ? "Saving..." : "Save"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className={sectionCardCls}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="h-4 w-4 text-primary" />
            Operations Runbook Panel
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button disabled={!isAdmin || saving === "dispatch-run"} onClick={() => void runDispatchNow()}>
              {saving === "dispatch-run" ? "Running Dispatch..." : "Run Dispatch Now"}
            </Button>
            <Button variant="secondary" disabled={!isAdmin || saving === "retention-run"} onClick={() => void runRetentionCleanupNow()}>
              {saving === "retention-run" ? "Running Cleanup..." : "Run Retention Cleanup"}
            </Button>
            <Button variant="secondary" disabled={loading || saving === "refresh-state"} onClick={() => void loadData()}>
              Refresh Status
            </Button>
          </div>

          {dispatchResult ? (
            <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-sm">
              <p className="font-medium text-foreground">Dispatch Result</p>
              <p className="mt-1 text-muted">pending {dispatchResult.pending} | sent {dispatchResult.sent} | failed {dispatchResult.failed} | suppressed {dispatchResult.suppressed}</p>
            </div>
          ) : null}

          {cleanupResults ? (
            <div className="rounded-xl border border-border/80 bg-background/60 p-3 text-sm">
              <p className="font-medium text-foreground">Retention Cleanup Result</p>
              <p className="mt-1 text-muted">{cleanupResults.map((row) => `${row.table}:${row.deleted}`).join(" | ")}</p>
            </div>
          ) : null}

          <div className="overflow-x-auto rounded-xl border border-border/80">
            <table className="w-full min-w-[780px] text-sm">
              <thead className="bg-card">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Job</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Type</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Status</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Started</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Duration</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Summary</th>
                </tr>
              </thead>
              <tbody>
                {jobRuns.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted">
                      No run history yet.
                    </td>
                  </tr>
                ) : null}
                {jobRuns.map((run) => (
                  <tr key={run.JobRunId} className="border-t border-border/60">
                    <td className="px-3 py-2 text-foreground">{run.JobName}</td>
                    <td className="px-3 py-2 text-muted">{run.RunType}</td>
                    <td className="px-3 py-2 text-foreground">{run.Status}</td>
                    <td className="px-3 py-2 text-muted">{new Date(run.StartedAt).toLocaleString()}</td>
                    <td className="px-3 py-2 text-muted">{run.DurationMs ? `${run.DurationMs} ms` : "-"}</td>
                    <td className="px-3 py-2 text-muted">{run.Summary ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card className={sectionCardCls}>
        <CardHeader>
          <CardTitle>Admin: Per-Server Access Control</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 rounded-xl border border-border/80 bg-background/50 p-3 md:grid-cols-4">
            <select className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground" value={selectedUserId} disabled={!isAdmin} onChange={(e) => setSelectedUserId(e.target.value)}>
              {users.map((entry) => (
                <option key={entry.userId} value={entry.userId}>
                  {entry.displayName} ({entry.userId})
                </option>
              ))}
            </select>

            <select className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground" value={selectedServerId} disabled={!isAdmin} onChange={(e) => setSelectedServerId(e.target.value)}>
              {servers.map((entry) => (
                <option key={entry.ServerId} value={entry.ServerId}>
                  {entry.Name} ({entry.Environment})
                </option>
              ))}
            </select>

            <select className="h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground" value={selectedRole} disabled={!isAdmin} onChange={(e) => setSelectedRole(e.target.value as "admin" | "viewer")}>
              <option value="viewer">viewer</option>
              <option value="admin">admin</option>
            </select>

            <Button disabled={!isAdmin || !selectedServerId || saving === "grant-access"} onClick={() => void grantAccess()}>
              {saving === "grant-access" ? "Granting..." : "Grant / Update"}
            </Button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border/80">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-card">
                <tr>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">User</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Server</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Role</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Granted By</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Granted At</th>
                  <th className="px-3 py-2 text-left text-xs uppercase tracking-wide text-muted">Action</th>
                </tr>
              </thead>
              <tbody>
                {accessEntries.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-3 py-4 text-center text-muted">
                      No server access assignments yet.
                    </td>
                  </tr>
                ) : null}

                {accessEntries.map((entry) => (
                  <tr key={entry.AccessId} className="border-t border-border/60">
                    <td className="px-3 py-2 text-foreground">{entry.UserId}</td>
                    <td className="px-3 py-2 text-foreground">{entry.ServerName}</td>
                    <td className="px-3 py-2 text-foreground">{entry.Role}</td>
                    <td className="px-3 py-2 text-muted">{entry.GrantedBy}</td>
                    <td className="px-3 py-2 text-muted">{new Date(entry.GrantedAt).toLocaleString()}</td>
                    <td className="px-3 py-2">
                      <Button variant="secondary" disabled={!isAdmin || saving === `revoke-${entry.UserId}-${entry.ServerId}`} onClick={() => void revokeAccess(entry.UserId, entry.ServerId)}>
                        {saving === `revoke-${entry.UserId}-${entry.ServerId}` ? "Revoking..." : "Revoke"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatusTile({ icon: Icon, title, value, note }: { icon: React.ComponentType<{ className?: string }>; title: string; value: string; note: string }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/70 p-4 shadow-[0_6px_18px_rgba(16,35,58,0.06)]">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted">{note}</p>
    </div>
  );
}

function formatRunTime(raw?: string) {
  if (!raw) return "No recent run";
  return new Date(raw).toLocaleString();
}
