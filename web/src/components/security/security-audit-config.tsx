import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { SecurityAuditRunRequest, SecurityAuditRunResponse } from "@/lib/types";

interface SecurityAuditConfigProps {
  onRun: (payload: SecurityAuditRunRequest) => Promise<SecurityAuditRunResponse>;
  onRunComplete: (result: SecurityAuditRunResponse) => void;
}

export function SecurityAuditConfig({ onRun, onRunComplete }: SecurityAuditConfigProps) {
  const [targetLabel, setTargetLabel] = useState("");
  const [environment, setEnvironment] = useState("production");
  const [notes, setNotes] = useState("");

  const [fabricEnabled, setFabricEnabled] = useState(false);
  const [tenantId, setTenantId] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [workspaceId, setWorkspaceId] = useState("");
  const [lakehouseId, setLakehouseId] = useState("");
  const [filePrefix, setFilePrefix] = useState("SQLSentinnel/security-audit");
  const [scope, setScope] = useState("https://storage.azure.com/.default");
  const [baseUrl, setBaseUrl] = useState("https://onelake.dfs.fabric.microsoft.com");

  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const requiresFabricFields =
    fabricEnabled &&
    (!tenantId.trim() || !clientId.trim() || !clientSecret.trim() || !workspaceId.trim() || !lakehouseId.trim());

  async function handleRun() {
    setError(null);

    if (!targetLabel.trim()) {
      setError("Target label is required.");
      return;
    }

    if (requiresFabricFields) {
      setError("Fabric export is enabled. Tenant, client, workspace, and lakehouse values are required.");
      return;
    }

    setRunning(true);
    try {
      const payload: SecurityAuditRunRequest = {
        sqlTarget: {
          targetLabel: targetLabel.trim(),
          environment: environment.trim() || undefined,
          notes: notes.trim() || undefined
        },
        fabric: {
          enabled: fabricEnabled,
          tenantId: tenantId.trim() || undefined,
          clientId: clientId.trim() || undefined,
          clientSecret: clientSecret || undefined,
          workspaceId: workspaceId.trim() || undefined,
          lakehouseId: lakehouseId.trim() || undefined,
          filePrefix: filePrefix.trim() || undefined,
          scope: scope.trim() || undefined,
          baseUrl: baseUrl.trim() || undefined
        }
      };

      const result = await onRun(payload);
      onRunComplete(result);
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Security audit run failed.";
      setError(message);
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Security Audit Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted">SQL Target Label</p>
            <Input
              value={targetLabel}
              onChange={(event) => setTargetLabel(event.target.value)}
              placeholder="Prod SQL Cluster A"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-muted">Environment</p>
            <Input
              value={environment}
              onChange={(event) => setEnvironment(event.target.value)}
              placeholder="production"
            />
          </div>
          <div className="space-y-1 md:col-span-1">
            <p className="text-xs uppercase tracking-wide text-muted">Run Notes</p>
            <Input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Blue-team validation pass"
            />
          </div>
        </div>

        <div className="rounded-xl border border-border p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Microsoft Fabric Export</p>
              <p className="text-xs text-muted">Best-effort side effect. API response never depends on export success.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={fabricEnabled}
                onChange={(event) => setFabricEnabled(event.target.checked)}
              />
              Enable
            </label>
          </div>

          {fabricEnabled && (
            <div className="grid gap-3 md:grid-cols-2">
              <Input value={tenantId} onChange={(event) => setTenantId(event.target.value)} placeholder="Tenant ID" />
              <Input value={clientId} onChange={(event) => setClientId(event.target.value)} placeholder="Client ID" />
              <Input
                type="password"
                value={clientSecret}
                onChange={(event) => setClientSecret(event.target.value)}
                placeholder="Client Secret"
              />
              <Input value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} placeholder="Workspace ID" />
              <Input value={lakehouseId} onChange={(event) => setLakehouseId(event.target.value)} placeholder="Lakehouse ID" />
              <Input value={filePrefix} onChange={(event) => setFilePrefix(event.target.value)} placeholder="File Prefix" />
              <Input value={scope} onChange={(event) => setScope(event.target.value)} placeholder="OAuth Scope" />
              <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="OneLake Base URL" />
            </div>
          )}
        </div>

        {error && <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex items-center justify-end">
          <Button onClick={handleRun} disabled={running}>
            {running ? "Running Security Audit..." : "Run SQL Security Audit"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
