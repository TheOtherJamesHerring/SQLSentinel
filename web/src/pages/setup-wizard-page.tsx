import { useEffect, useState, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database, Server, ShieldCheck, CheckCircle2, Copy,
  Loader2, AlertCircle, ArrowRight, ArrowLeft, ChevronRight
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerRecord { ServerId: string; Name: string; }
interface ProfileRecord { ProfileId: string; }
interface TestResult { status: string; serverName: string; version: string; }
interface DeployResult {
  deploymentId: string | null;
  mode: string;
  permissionsVerified: boolean;
  deploymentStatus: string;
  deploymentStartedAt: string | null;
  lastHeartbeatAt: string | null;
  resourceName: string | null;
  summary: string;
  command: string;
  envPreview: string[];
  nextSteps: string[];
}

interface CollectorDeploymentHistory {
  DeploymentId: string;
  Mode: string;
  Provider: string;
  ResourceName: string | null;
  RequestedBy: string;
  Status: "running" | "success" | "failed";
  StartedAt: string;
  FinishedAt: string | null;
  DurationMs: number | null;
  Summary: string | null;
  ErrorMessage: string | null;
}

interface CollectorHealth {
  status: "healthy" | "pending" | "stale" | "failed";
  lastHeartbeatAt: string | null;
  heartbeatAgeSeconds: number | null;
  seenAfterDeploy: boolean;
}

interface AzureReadiness {
  available: boolean;
  executable: string | null;
  message: string;
}

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ["Start", "Server", "Sign-in", "Save", "Finish"];

function StepBar({ current }: { current: number }) {
  return (
    <div className="mb-8 flex items-center justify-center gap-2">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition-colors ${
            i < current ? "bg-primary text-[#fff]"
              : i === current ? "bg-primary text-[#fff] ring-2 ring-primary/40"
              : "bg-border text-muted"
          }`}>
            {i < current ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
          </div>
          {!( i === STEPS.length - 1) && (
            <div className={`h-px w-6 ${i < current ? "bg-primary" : "bg-border"}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Step components ──────────────────────────────────────────────────────────

function WelcomeStep({ onNext }: { onNext: () => void }) {
  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-primary shadow-xl shadow-primary/30">
        <Database className="h-10 w-10 text-[#fff]" />
      </div>
      <div>
        <h2 className="text-2xl font-bold text-foreground">Set up your first SQL server</h2>
        <p className="mt-2 max-w-md text-muted">
          We will guide you step-by-step. Most users can finish this in about 2 minutes.
        </p>
      </div>
      <div className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-card p-4 text-left text-sm text-foreground">
        {[
          ["1", "Tell us which SQL service you use"],
          ["2", "Enter login details"],
          ["3", "We test the connection for you"],
          ["4", "Choose easy data collection setup"],
        ].map(([num, text]) => (
          <div key={num} className="flex items-center gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">{num}</span>
            <span>{text}</span>
          </div>
        ))}
      </div>
      <button
        onClick={onNext}
        className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-semibold text-[#fff] shadow transition hover:opacity-90"
      >
        Get Started <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

interface ConnDetails {
  targetType: "on-prem" | "sql-mi" | "azure-sql-db" | "fabric-sql";
  serverName: string; hostname: string; instanceName: string;
  port: string; database: string; environment: string;
}

function ConnectionStep({ data, onChange, onNext, onBack }: {
  data: ConnDetails; onChange: (d: Partial<ConnDetails>) => void;
  onNext: () => void; onBack: () => void;
}) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const isDatabaseScopedTarget = data.targetType === "azure-sql-db" || data.targetType === "fabric-sql";
  const hostnamePlaceholder =
    data.targetType === "azure-sql-db"
      ? "yourserver.database.windows.net"
      : data.targetType === "fabric-sql"
        ? "workspace.datawarehouse.fabric.microsoft.com"
        : data.targetType === "sql-mi"
          ? "your-mi.public.<region>.database.windows.net"
          : "myserver.domain.com";
  const hostnameHint =
    data.targetType === "azure-sql-db"
      ? "Use the server name that ends with .database.windows.net"
      : data.targetType === "fabric-sql"
        ? "Use the name that ends with .datawarehouse.fabric.microsoft.com"
        : data.targetType === "sql-mi"
          ? "Use your Managed Instance host name"
          : "Use the host name or IP of your SQL Server";

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onNext();
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">Server details</h2>
        <p className="mt-1 text-sm text-muted">Tell us what you are connecting to.</p>
      </div>
      <Field label="SQL Service Type" required>
        <select value={data.targetType} onChange={(e) => onChange({ targetType: e.target.value as ConnDetails["targetType"] })}
          className={inputCls}>
          <option value="on-prem">SQL Server (on-prem or VM)</option>
          <option value="sql-mi">Azure SQL Managed Instance</option>
          <option value="azure-sql-db">Azure SQL Database</option>
          <option value="fabric-sql">Microsoft Fabric SQL</option>
        </select>
      </Field>
      <Field label="Display Name" required>
        <input required value={data.serverName} onChange={(e) => onChange({ serverName: e.target.value })}
          placeholder="MTCG-SQL-DEV" className={inputCls} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hostname / IP" required>
          <input required value={data.hostname} onChange={(e) => onChange({ hostname: e.target.value })}
            placeholder={hostnamePlaceholder} className={inputCls} />
          <p className="mt-1 text-xs text-muted">{hostnameHint}</p>
        </Field>
        {!isDatabaseScopedTarget ? (
          <Field label="Instance Name (optional)">
            <input value={data.instanceName} onChange={(e) => onChange({ instanceName: e.target.value })}
              placeholder="MSSQLSERVER" className={inputCls} />
          </Field>
        ) : (
          <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted">
            Instance name is not needed for this SQL service type.
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-xs font-medium text-primary underline underline-offset-2"
      >
        {showAdvanced ? "Hide advanced settings" : "Show advanced settings"}
      </button>
      {showAdvanced && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Port">
            <input type="number" value={data.port} onChange={(e) => onChange({ port: e.target.value })}
              placeholder="1433" className={inputCls} />
          </Field>
          <Field label="Initial Database">
            <input value={data.database} onChange={(e) => onChange({ database: e.target.value })}
              placeholder="master" className={inputCls} />
          </Field>
          <Field label="Environment">
            <select value={data.environment} onChange={(e) => onChange({ environment: e.target.value })}
              className={inputCls}>
              <option value="production">Production</option>
              <option value="staging">Staging</option>
              <option value="development">Development</option>
              <option value="dr">DR / Failover</option>
            </select>
          </Field>
        </div>
      )}
      <StepNav onBack={onBack} nextLabel="Next: Credentials" />
    </form>
  );
}

interface AuthDetails {
  authType: string; username: string; password: string;
  encrypt: string; trustServerCert: string;
}

function CredentialsStep({ conn, auth, onChange, onNext, onBack }: {
  conn: ConnDetails; auth: AuthDetails; onChange: (d: Partial<AuthDetails>) => void;
  onNext: (result: TestResult) => void; onBack: () => void;
}) {
  const [showAdvancedAuth, setShowAdvancedAuth] = useState(false);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const isDatabaseScopedTarget = conn.targetType === "azure-sql-db" || conn.targetType === "fabric-sql";
  const normalizedInstanceName = isDatabaseScopedTarget ? undefined : conn.instanceName || undefined;

  useEffect(() => {
    if (conn.targetType === "on-prem" || conn.targetType === "sql-mi") {
      if (auth.authType !== "SQL Auth" && auth.authType !== "Windows Auth") {
        onChange({ authType: "SQL Auth" });
      }
    }
    if (conn.targetType === "azure-sql-db" || conn.targetType === "fabric-sql") {
      if (auth.authType === "Windows Auth") {
        onChange({ authType: "SQL Auth" });
      }
    }
  }, [auth.authType, conn.targetType, onChange]);

  async function handleTest(e: FormEvent) {
    e.preventDefault();
    setError("");
    setTesting(true);
    try {
      const result = await api<TestResult>("/connections/test-inline", {
        method: "POST",
        body: JSON.stringify({
          targetType: conn.targetType,
          authType: auth.authType,
          hostname: conn.hostname,
          port: Number(conn.port) || 1433,
          instanceName: normalizedInstanceName,
          username: auth.username,
          password: auth.password,
          database: conn.database || "master",
          encrypt: auth.encrypt === "true",
          trustServerCert: auth.trustServerCert === "true"
        })
      });
      onNext(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connection failed");
    } finally {
      setTesting(false);
    }
  }

  return (
    <form onSubmit={handleTest} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">Sign-in details</h2>
        <p className="mt-1 text-sm text-muted">
          Enter the account used to connect to <span className="text-primary font-medium">{conn.hostname}</span>
        </p>
      </div>
      <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted">
        Recommended: use SQL Server login unless your team tells you to use another sign-in method.
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Username" required>
          <input required value={auth.username} onChange={(e) => onChange({ username: e.target.value })}
            placeholder="sqlmonitor_svc" className={inputCls} autoComplete="off" />
        </Field>
        <Field label="Password" required>
          <input required type="password" value={auth.password} onChange={(e) => onChange({ password: e.target.value })}
            placeholder="••••••••" className={inputCls} autoComplete="new-password" />
        </Field>
      </div>
      <button
        type="button"
        onClick={() => setShowAdvancedAuth((v) => !v)}
        className="text-xs font-medium text-primary underline underline-offset-2"
      >
        {showAdvancedAuth ? "Hide advanced sign-in settings" : "Show advanced sign-in settings"}
      </button>
      {showAdvancedAuth && (
        <>
          <Field label="Authentication Type">
            <select value={auth.authType} onChange={(e) => onChange({ authType: e.target.value })}
              className={inputCls}>
              <option value="SQL Auth">SQL Server Authentication</option>
              {(conn.targetType === "on-prem" || conn.targetType === "sql-mi") && (
                <option value="Windows Auth">Windows Authentication</option>
              )}
              {(conn.targetType === "azure-sql-db" || conn.targetType === "fabric-sql") && (
                <option value="Entra ID Password">Microsoft Entra Password</option>
              )}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Encrypt Connection">
              <select value={auth.encrypt} onChange={(e) => onChange({ encrypt: e.target.value })} className={inputCls}>
                <option value="true">Yes (recommended)</option>
                <option value="false">No</option>
              </select>
            </Field>
            <Field label="Trust Server Certificate">
              <select value={auth.trustServerCert} onChange={(e) => onChange({ trustServerCert: e.target.value })} className={inputCls}>
                <option value="true">Yes (for self-signed)</option>
                <option value="false">No</option>
              </select>
            </Field>
          </div>
        </>
      )}
      <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
        Tip: if this account cannot connect, ask your DBA to grant monitoring permissions for SQLSentinnel.
      </div>
      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Connection failed</p>
            <p className="mt-0.5 text-xs opacity-80">{error}</p>
          </div>
        </div>
      )}
      <div className="flex items-center gap-3 pt-1">
        <button type="button" onClick={onBack} className={backBtnCls}>
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <button type="submit" disabled={testing}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-[#fff] shadow transition hover:opacity-90 disabled:opacity-60">
          {testing ? <><Loader2 className="h-4 w-4 animate-spin" /> Testing connection…</> : <><ShieldCheck className="h-4 w-4" /> Test Connection</> }
        </button>
      </div>
    </form>
  );
}

function RegisterStep({ conn, auth, testResult, onNext, onBack }: {
  conn: ConnDetails; auth: AuthDetails; testResult: TestResult;
  onNext: (server: ServerRecord, profile: ProfileRecord) => void; onBack: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function save() {
    setSaving(true);
    setError("");
    try {
      const server = await api<ServerRecord>("/servers", {
        method: "POST",
        body: JSON.stringify({
          name: conn.serverName,
          hostname: conn.hostname,
          instanceName: (conn.targetType === "azure-sql-db" || conn.targetType === "fabric-sql") ? undefined : conn.instanceName || undefined,
          port: Number(conn.port) || 1433,
          environment: conn.environment,
          targetType: conn.targetType
        })
      });
      const profile = await api<ProfileRecord>("/connections", {
        method: "POST",
        body: JSON.stringify({
          name: `${conn.serverName} — Monitor`,
          serverId: server.ServerId,
          hostname: conn.hostname,
          port: Number(conn.port) || 1433,
          instanceName: (conn.targetType === "azure-sql-db" || conn.targetType === "fabric-sql") ? null : conn.instanceName || null,
          authType: auth.authType,
          username: auth.username,
          password: auth.password,
          database: conn.database || "master",
          encrypt: auth.encrypt === "true",
          trustServerCert: auth.trustServerCert === "true",
          connectionTimeout: 30,
          environment: conn.environment,
          notes: `Registered via setup wizard. SQL Server: ${testResult.serverName}`
        })
      });
      setDone(true);
      onNext(server, profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  // Auto-save on mount
  const savedRef = useRef(false);
  if (!savedRef.current) {
    savedRef.current = true;
    save();
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">Registering Server</h2>
        <p className="mt-1 text-sm text-muted">Saving your server so it appears on your dashboard.</p>
      </div>

      {/* Test result */}
      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 space-y-2">
        <div className="flex items-center gap-2 text-emerald-400 font-semibold">
          <CheckCircle2 className="h-5 w-5" />
          Connection verified
        </div>
        <p className="text-xs text-slate-300 font-mono">{testResult.serverName}</p>
        <p className="text-xs text-slate-500 line-clamp-2">{testResult.version}</p>
      </div>

      {saving && (
        <div className="flex items-center gap-2 text-muted text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Saving server registration…
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2.5 text-sm text-danger">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Save failed</p>
            <p className="mt-0.5 text-xs opacity-80">{error}</p>
            <button onClick={save} className="mt-2 text-xs underline">Retry</button>
          </div>
        </div>
      )}
    </div>
  );
}

function CollectorStep({ conn, auth, server }: {
  conn: ConnDetails; auth: AuthDetails; server: ServerRecord;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const hostname = conn.hostname.toLowerCase();
  const defaultMode = hostname.includes("database.windows.net") || hostname.includes("fabric.microsoft.com")
    ? "azure-container-instance"
    : "single-host";
  const [mode, setMode] = useState<"single-host" | "container" | "azure-container-instance" | "azure-app-service">(defaultMode);
  const [serverCount, setServerCount] = useState("1");
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState("");
  const [deployResult, setDeployResult] = useState<DeployResult | null>(null);
  const [deployHistory, setDeployHistory] = useState<CollectorDeploymentHistory[]>([]);
  const [health, setHealth] = useState<CollectorHealth | null>(null);
  const [healthMessage, setHealthMessage] = useState("");
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [checkingAzureReadiness, setCheckingAzureReadiness] = useState(false);
  const [azureReadiness, setAzureReadiness] = useState<AzureReadiness | null>(null);
  const [copied, setCopied] = useState(false);
  const [credentials, setCredentials] = useState({
    hostUsername: "",
    hostPassword: "",
    subscriptionId: "",
    resourceGroup: "",
    location: "eastus",
    tenantId: "",
    clientId: "",
    clientSecret: "",
    appName: "",
    appServicePlan: ""
  });

  const deploymentModes = [
    {
      id: "single-host",
      title: "Manual setup on one machine",
      fit: "Good for small environments (about 1-5 servers)",
      details: "We generate commands. Your operator runs them on one host."
    },
    {
      id: "container",
      title: "Manual Docker setup",
      fit: "Good for medium environments (about 3-10 servers)",
      details: "We generate Docker commands. Your operator runs them."
    },
    {
      id: "azure-container-instance",
      title: "Recommended automatic Azure setup",
      fit: "Best for most Azure SQL environments",
      details: "One-click setup. SQLSentinnel creates and starts the collector in Azure."
    },
    {
      id: "azure-app-service",
      title: "Advanced Azure App Service setup",
      fit: "For teams that standardize on App Service",
      details: "One-click setup using App Service settings and plan controls."
    }
  ] as const;

  const requiresAzureCredentials = mode === "azure-container-instance" || mode === "azure-app-service";
  const isGuidedMode = mode === "single-host" || mode === "container";
  const isAdmin = user?.role === "admin";
  const recommendedModeId = defaultMode;
  const recommendedMode = deploymentModes.find((option) => option.id === recommendedModeId) ?? deploymentModes[0];
  const alternateModes = deploymentModes.filter((option) => option.id !== recommendedModeId);

  async function loadDeployHistory() {
    try {
      const rows = await api<CollectorDeploymentHistory[]>(`/servers/${server.ServerId}/collector/deployments?limit=8`);
      setDeployHistory(rows);
    } catch {
      // Keep UI usable if history is temporarily unavailable.
    }
  }

  async function checkCollectorHealth(deploymentId: string, silent = false) {
    if (!silent) {
      setCheckingHealth(true);
      setHealthMessage("");
    }
    try {
      const result = await api<CollectorHealth>(`/servers/${server.ServerId}/collector/health?deploymentId=${encodeURIComponent(deploymentId)}`);
      setHealth(result);
      if (result.status === "healthy") {
        setHealthMessage("First heartbeat confirmed. Collector is online.");
      } else if (result.status === "failed") {
        setHealthMessage("Deployment failed. Review deployment history below.");
      } else if (result.status === "stale") {
        setHealthMessage("Heartbeat detected but stale. Verify collector runtime.");
      } else {
        setHealthMessage("Waiting for first heartbeat...");
      }
    } catch (err) {
      if (!silent) {
        setHealthMessage(err instanceof Error ? err.message : "Health check failed.");
      }
    } finally {
      if (!silent) {
        setCheckingHealth(false);
      }
    }
  }

  useEffect(() => {
    loadDeployHistory();
  }, [server.ServerId]);

  useEffect(() => {
    if (!requiresAzureCredentials || !isAdmin) {
      setAzureReadiness(null);
      return;
    }

    let active = true;
    setCheckingAzureReadiness(true);
    api<AzureReadiness>("/servers/collector/azure-readiness")
      .then((result) => {
        if (!active) return;
        setAzureReadiness(result);
      })
      .catch((error) => {
        if (!active) return;
        setAzureReadiness({
          available: false,
          executable: null,
          message: error instanceof Error ? error.message : "Automatic Azure setup is not available right now."
        });
      })
      .finally(() => {
        if (!active) return;
        setCheckingAzureReadiness(false);
      });

    return () => {
      active = false;
    };
  }, [isAdmin, requiresAzureCredentials]);

  useEffect(() => {
    const deploymentId = deployResult?.deploymentId;
    if (!deploymentId) return;

    let count = 0;
    checkCollectorHealth(deploymentId, false);
    const timer = window.setInterval(() => {
      count += 1;
      checkCollectorHealth(deploymentId, true);
      if (count >= 12) {
        window.clearInterval(timer);
      }
    }, 10000);

    return () => window.clearInterval(timer);
  }, [deployResult?.deploymentId]);

  async function deployCollector() {
    setDeployError("");
    setDeploying(true);
    try {
      const monitorApiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:3001/api";
      const result = await api<DeployResult>(`/servers/${server.ServerId}/collector/deploy`, {
        method: "POST",
        body: JSON.stringify({
          mode,
          serverCount: Math.max(1, Number(serverCount) || 1),
          monitorApiUrl,
          sql: {
            hostname: conn.hostname,
            port: Number(conn.port) || 1433,
            authType: auth.authType,
            username: auth.username,
            password: auth.password,
            database: conn.database || "master",
            encrypt: auth.encrypt === "true",
            trustServerCert: auth.trustServerCert === "true"
          },
          credentials
        })
      });
      setDeployResult(result);
      await loadDeployHistory();
    } catch (err) {
      setDeployError(err instanceof Error ? err.message : "Deploy failed");
    } finally {
      setDeploying(false);
    }
  }

  function copyCommand(text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">Turn on monitoring</h2>
        <p className="mt-1 text-sm text-muted">Choose the easiest setup type for your environment.</p>
      </div>

      <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">
        Your dashboard starts updating only after collector setup is complete.
      </div>

      <div className="rounded-lg border border-border bg-card/60 p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Simple guidance</p>
        <ul className="space-y-1 text-xs text-muted">
          <li className="flex items-start gap-2"><ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />Automatic setup runs directly from SQLSentinnel (Azure modes).</li>
          <li className="flex items-start gap-2"><ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />Manual setup gives exact commands for your operator to run.</li>
          <li className="flex items-start gap-2"><ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />If unsure, keep the recommended mode selected below.</li>
        </ul>
      </div>

      <div className="space-y-3">
        <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-primary">Recommended for this server</p>
          <button
            type="button"
            onClick={() => setMode(recommendedMode.id)}
            className={`mt-2 w-full rounded-lg border p-3 text-left transition ${mode === recommendedMode.id ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"}`}
          >
            <p className="font-semibold text-foreground">
              {recommendedMode.title}
              <span className="ml-2 rounded bg-border px-1.5 py-0.5 text-[10px] font-medium text-muted">
                {recommendedMode.id === "azure-container-instance" || recommendedMode.id === "azure-app-service" ? "Automatic" : "Manual"}
              </span>
            </p>
            <p className="mt-1 text-xs text-primary">{recommendedMode.fit}</p>
            <p className="mt-1 text-xs text-muted">{recommendedMode.details}</p>
          </button>
        </div>

        <div className="rounded-xl border border-border bg-card/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">Other setup options</p>
          <div className="mt-2 grid gap-3">
            {alternateModes.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setMode(option.id)}
            className={`rounded-lg border p-3 text-left transition ${mode === option.id ? "border-primary bg-primary/10" : "border-border bg-card/50 hover:border-primary/40"}`}
          >
            <p className="font-semibold text-foreground">
              {option.title}
              <span className="ml-2 rounded bg-border px-1.5 py-0.5 text-[10px] font-medium text-muted">
                {option.id === "azure-container-instance" || option.id === "azure-app-service" ? "Automatic" : "Manual"}
              </span>
            </p>
            <p className="mt-1 text-xs text-primary">{option.fit}</p>
            <p className="mt-1 text-xs text-muted">{option.details}</p>
          </button>
            ))}
          </div>
        </div>
      </div>

      <Field label="How many servers will this collector monitor?" required>
        <input type="number" min={1} value={serverCount} onChange={(e) => setServerCount(e.target.value)} className={inputCls} />
      </Field>

      {isGuidedMode && (
        <div className="rounded-lg border border-border bg-card/60 p-3 text-xs text-muted">
          This is guided setup. Click the button below and we will generate the exact commands for your operator to run.
          Secret values stay hidden in the preview for security.
        </div>
      )}

      {!isAdmin && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger">
          Admin permission is required to deploy a collector from this wizard.
        </div>
      )}

      {requiresAzureCredentials && (
        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <p className="text-sm font-semibold text-foreground">Azure setup access</p>
          <p className="text-xs text-muted">Enter the Azure app registration details used for automatic setup.</p>

          {checkingAzureReadiness && (
            <div className="rounded-lg border border-border bg-background px-3 py-2 text-xs text-muted">
              Checking automatic Azure setup availability...
            </div>
          )}

          {!checkingAzureReadiness && azureReadiness && (
            <div className={`rounded-lg border px-3 py-2 text-xs ${azureReadiness.available ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning"}`}>
              {azureReadiness.message}
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Azure Subscription ID" required>
              <input value={credentials.subscriptionId} onChange={(e) => setCredentials((prev) => ({ ...prev, subscriptionId: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Resource Group" required>
              <input value={credentials.resourceGroup} onChange={(e) => setCredentials((prev) => ({ ...prev, resourceGroup: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Azure Region" required>
              <input value={credentials.location} onChange={(e) => setCredentials((prev) => ({ ...prev, location: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Tenant ID" required>
              <input value={credentials.tenantId} onChange={(e) => setCredentials((prev) => ({ ...prev, tenantId: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Client ID" required>
              <input value={credentials.clientId} onChange={(e) => setCredentials((prev) => ({ ...prev, clientId: e.target.value }))} className={inputCls} />
            </Field>
            <Field label="Client Secret" required>
              <input type="password" value={credentials.clientSecret} onChange={(e) => setCredentials((prev) => ({ ...prev, clientSecret: e.target.value }))} className={inputCls} />
            </Field>
            {mode === "azure-app-service" && (
              <>
                <Field label="App Name" required>
                  <input value={credentials.appName ?? ""} onChange={(e) => setCredentials((prev) => ({ ...prev, appName: e.target.value }))} className={inputCls} />
                </Field>
                <Field label="App Service Plan" required>
                  <input value={credentials.appServicePlan ?? ""} onChange={(e) => setCredentials((prev) => ({ ...prev, appServicePlan: e.target.value }))} className={inputCls} />
                </Field>
              </>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={deployCollector}
              disabled={deploying || checkingAzureReadiness || !azureReadiness?.available}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-60"
            >
              {deploying ? <><Loader2 className="h-4 w-4 animate-spin" />Setting up...</> : "Start One-Click Setup"}
            </button>
          </div>
        </div>
      )}

      {isGuidedMode && isAdmin && (
        <div className="flex justify-start">
          <button
            type="button"
            onClick={() => { setDeployError(""); void deployCollector(); }}
            disabled={deploying}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:opacity-90 disabled:opacity-60"
          >
            {deploying ? <><Loader2 className="h-4 w-4 animate-spin" />Generating...</> : "Generate Setup Steps"}
          </button>
        </div>
      )}

      {deployError && (
        <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          Deploy failed: {deployError}
        </div>
      )}

      {deployResult && (
        <div className="space-y-3 rounded-lg border border-success/40 bg-success/10 p-4">
          <p className="text-sm font-semibold text-success">Monitoring setup started</p>
          <p className="text-xs text-foreground/80">{deployResult.summary}</p>
          {deployResult.resourceName && (
            <p className="text-xs text-foreground/80">Resource: <span className="font-mono">{deployResult.resourceName}</span></p>
          )}
          <div className="rounded-lg border border-border bg-card/70 p-3">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Generated command</p>
              <button
                type="button"
                onClick={() => copyCommand(deployResult.command)}
                className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition hover:bg-border"
              >
                <Copy className="h-3.5 w-3.5" />
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 text-xs text-foreground/80 leading-relaxed font-mono">
              {deployResult.command}
            </pre>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted">What to do next</p>
            <ul className="mt-1 space-y-1 text-xs text-foreground/80">
              {deployResult.nextSteps.map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>

          {deployResult.deploymentId && (
            <div className="rounded-lg border border-border bg-card/80 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Monitoring health check</p>
                <button
                  type="button"
                  onClick={() => checkCollectorHealth(deployResult.deploymentId!, false)}
                  disabled={checkingHealth}
                  className="rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition hover:bg-border disabled:opacity-60"
                >
                  {checkingHealth ? "Checking..." : "Check status"}
                </button>
              </div>
              {health && (
                <p className="text-xs text-foreground/80">
                  Status: <span className="font-semibold uppercase">{health.status}</span>
                  {health.lastHeartbeatAt ? ` · Last heartbeat: ${new Date(health.lastHeartbeatAt).toLocaleString()}` : " · No heartbeat yet"}
                </p>
              )}
              {healthMessage && <p className="text-xs text-foreground/80">{healthMessage}</p>}
            </div>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-card/60 p-4 space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">Deployment history</p>
        {deployHistory.length === 0 ? (
          <p className="text-xs text-muted">No deployment attempts recorded yet.</p>
        ) : (
          <div className="space-y-2">
            {deployHistory.map((item) => (
              <div key={item.DeploymentId} className="rounded-md border border-border bg-card/70 p-2.5 text-xs">
                <p className="font-medium text-foreground">
                  {item.Mode} · {item.Status.toUpperCase()} · {new Date(item.StartedAt).toLocaleString()}
                </p>
                <p className="mt-0.5 text-muted">{item.Summary || item.ErrorMessage || "No summary"}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => navigate("/")}
          className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:opacity-90"
        >
          <Server className="h-4 w-4" /> Open Dashboard
        </button>
        <button
          onClick={() => navigate("/servers/new")}
          className="rounded-lg border border-border px-4 py-2.5 text-sm text-foreground transition hover:bg-border"
        >
          Add Another Server
        </button>
      </div>
    </div>
  );
}

// ─── Shared UI helpers ────────────────────────────────────────────────────────

const inputCls =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm text-foreground placeholder-muted/60 outline-none ring-primary/40 transition focus:border-primary focus:ring-2";

const backBtnCls =
  "flex items-center gap-1.5 rounded-lg border border-border px-4 py-2.5 text-sm text-foreground transition hover:bg-border";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted">
        {label}{required && <span className="ml-0.5 text-danger">*</span>}
      </label>
      {children}
    </div>
  );
}

function StepNav({ onBack, nextLabel = "Next" }: { onBack: () => void; nextLabel?: string }) {
  return (
    <div className="flex items-center gap-3 pt-1">
      <button type="button" onClick={onBack} className={backBtnCls}>
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <button type="submit"
        className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow transition hover:opacity-90">
        {nextLabel} <ArrowRight className="h-4 w-4" />
      </button>
    </div>
  );
}

// ─── Wizard container ─────────────────────────────────────────────────────────

export function SetupWizardPage() {
  const [step, setStep] = useState(0);

  const [conn, setConn] = useState<ConnDetails>({
    targetType: "on-prem",
    serverName: "", hostname: "", instanceName: "",
    port: "1433", database: "master", environment: "production"
  });
  const [auth, setAuth] = useState<AuthDetails>({
    authType: "SQL Auth", username: "sqlmonitor_svc", password: "",
    encrypt: "true", trustServerCert: "true"
  });
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [server, setServer] = useState<ServerRecord | null>(null);
  const [profile, setProfile] = useState<ProfileRecord | null>(null);

  function updateConn(d: Partial<ConnDetails>) { setConn((prev) => ({ ...prev, ...d })); }
  function updateAuth(d: Partial<AuthDetails>) { setAuth((prev) => ({ ...prev, ...d })); }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-12">
      <div className="w-full max-w-xl">
        <StepBar current={step} />

        <div className="rounded-2xl border border-border bg-card p-6 shadow-xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.2 }}
            >
              {step === 0 && <WelcomeStep onNext={() => setStep(1)} />}
              {step === 1 && (
                <ConnectionStep data={conn} onChange={updateConn}
                  onNext={() => setStep(2)} onBack={() => setStep(0)} />
              )}
              {step === 2 && (
                <CredentialsStep conn={conn} auth={auth} onChange={updateAuth}
                  onNext={(result) => { setTestResult(result); setStep(3); }}
                  onBack={() => setStep(1)} />
              )}
              {step === 3 && testResult && (
                <RegisterStep conn={conn} auth={auth} testResult={testResult}
                  onNext={(s, p) => { setServer(s); setProfile(p); setStep(4); }}
                  onBack={() => setStep(2)} />
              )}
              {step === 4 && server && (
                <CollectorStep conn={conn} auth={auth} server={server} />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
