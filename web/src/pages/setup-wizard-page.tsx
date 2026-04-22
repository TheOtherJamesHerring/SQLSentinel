import { useState, useRef, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  Database, Server, ShieldCheck, CheckCircle2, Copy, Download,
  Loader2, AlertCircle, ArrowRight, ArrowLeft, ChevronRight
} from "lucide-react";
import { api } from "@/lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ServerRecord { ServerId: string; Name: string; }
interface ProfileRecord { ProfileId: string; }
interface TestResult { status: string; serverName: string; version: string; }

// ─── Step indicator ───────────────────────────────────────────────────────────

const STEPS = ["Welcome", "Connection", "Credentials", "Register", "Collector"];

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
        <h2 className="text-2xl font-bold text-foreground">Welcome to SQLSentinnel</h2>
        <p className="mt-2 max-w-md text-muted">
          Your always-on remote DBA dashboard for SQL Server. Let's connect your first server in under 2 minutes.
        </p>
      </div>
      <div className="w-full max-w-sm space-y-3 rounded-xl border border-border bg-card p-4 text-left text-sm text-foreground">
        {[
          ["1", "Tell us where your SQL Server is"],
          ["2", "Enter service account credentials"],
          ["3", "We'll test the connection live"],
          ["4", "Get a ready-made collector config"],
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
  serverName: string; hostname: string; instanceName: string;
  port: string; database: string; environment: string;
}

function ConnectionStep({ data, onChange, onNext, onBack }: {
  data: ConnDetails; onChange: (d: Partial<ConnDetails>) => void;
  onNext: () => void; onBack: () => void;
}) {
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onNext();
  }
  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">Server Details</h2>
        <p className="mt-1 text-sm text-muted">Where is your SQL Server instance?</p>
      </div>
      <Field label="Display Name" required>
        <input required value={data.serverName} onChange={(e) => onChange({ serverName: e.target.value })}
          placeholder="MTCG-SQL-DEV" className={inputCls} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Hostname / IP" required>
          <input required value={data.hostname} onChange={(e) => onChange({ hostname: e.target.value })}
            placeholder="myserver.domain.com" className={inputCls} />
        </Field>
        <Field label="Port">
          <input type="number" value={data.port} onChange={(e) => onChange({ port: e.target.value })}
            placeholder="1433" className={inputCls} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Instance Name (optional)">
          <input value={data.instanceName} onChange={(e) => onChange({ instanceName: e.target.value })}
            placeholder="MSSQLSERVER" className={inputCls} />
        </Field>
        <Field label="Initial Database">
          <input value={data.database} onChange={(e) => onChange({ database: e.target.value })}
            placeholder="master" className={inputCls} />
        </Field>
      </div>
      <Field label="Environment">
        <select value={data.environment} onChange={(e) => onChange({ environment: e.target.value })}
          className={inputCls}>
          <option value="production">Production</option>
          <option value="staging">Staging</option>
          <option value="development">Development</option>
          <option value="dr">DR / Failover</option>
        </select>
      </Field>
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
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  async function handleTest(e: FormEvent) {
    e.preventDefault();
    setError("");
    setTesting(true);
    try {
      const result = await api<TestResult>("/connections/test-inline", {
        method: "POST",
        body: JSON.stringify({
          hostname: conn.hostname,
          port: Number(conn.port) || 1433,
          instanceName: conn.instanceName || undefined,
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
        <h2 className="text-xl font-bold text-foreground">Authentication</h2>
        <p className="mt-1 text-sm text-muted">
          Service account credentials for <span className="text-primary font-medium">{conn.hostname}</span>
        </p>
      </div>
      <Field label="Auth Type">
        <select value={auth.authType} onChange={(e) => onChange({ authType: e.target.value })}
          className={inputCls}>
          <option value="SQL Auth">SQL Server Authentication</option>
          <option value="Windows Auth">Windows Authentication</option>
        </select>
      </Field>
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
      <div className="rounded-lg border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning">
        💡 The service account needs <strong>VIEW SERVER STATE</strong> and <strong>VIEW DATABASE STATE</strong> permissions.
        Run <code className="opacity-80">scripts/create_sqlmonitor_svc.sql</code> on the target server to create it.
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
          instanceName: conn.instanceName || undefined,
          port: Number(conn.port) || 1433,
          environment: conn.environment
        })
      });
      const profile = await api<ProfileRecord>("/connections", {
        method: "POST",
        body: JSON.stringify({
          name: `${conn.serverName} — Monitor`,
          serverId: server.ServerId,
          hostname: conn.hostname,
          port: Number(conn.port) || 1433,
          instanceName: conn.instanceName || null,
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
        <p className="mt-1 text-sm text-muted">Saving your server and connection profile.</p>
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
  const secretKey = `SQL_${conn.serverName.replace(/[^A-Z0-9]/gi, "_").toUpperCase()}_PASSWORD`;
  const envContent = [
    `# SQLSentinnel Collector — ${conn.serverName}`,
    `# Generated by setup wizard`,
    ``,
    `MONITOR_API_URL=http://localhost:3001`,
    `MONITOR_API_KEY=sqlsentinnel-local-dev-2026`,
    ``,
    `SQL_SERVER_HOST=${conn.hostname}`,
    `SQL_USERNAME=${auth.username}`,
    `${secretKey}=${auth.password}`,
    `SQL_PASSWORD=${auth.password}`,
    ``,
    `SERVER_ID=${server.ServerId}`,
  ].join("\n");

  const [copied, setCopied] = useState(false);

  function copyEnv() {
    navigator.clipboard.writeText(envContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadEnv() {
    const blob = new Blob([envContent], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ".env";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold text-foreground">Deploy the Collector</h2>
        <p className="mt-1 text-sm text-muted">
          The collector runs on any machine with network access to <span className="text-primary font-medium">{conn.hostname}</span>.
          Drop this <code className="text-foreground/70">.env</code> file into the <code className="text-foreground/70">collector/</code> directory, then run:
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-3 font-mono text-xs text-success">
        npm run dev -w collector
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">collector/.env</p>
          <div className="flex gap-2">
            <button onClick={copyEnv}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition hover:bg-border">
              <Copy className="h-3.5 w-3.5" />
              {copied ? "Copied!" : "Copy"}
            </button>
            <button onClick={downloadEnv}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-foreground transition hover:bg-border">
              <Download className="h-3.5 w-3.5" /> Download
            </button>
          </div>
        </div>
        <pre className="max-h-64 overflow-auto rounded-xl border border-border bg-background p-4 text-xs text-foreground/80 leading-relaxed font-mono">
          {envContent}
        </pre>
      </div>

      <div className="rounded-lg border border-border bg-card/50 p-4 text-sm text-muted space-y-2">
        <p className="font-medium text-foreground">What the collector monitors:</p>
        <ul className="space-y-1 text-xs list-none">
          {[
            "CPU, memory, active connections — every minute",
            "Disk usage, database sizes — every 5 minutes",
            "SQL error log events — every 15 minutes",
            "Heartbeat & alert thresholds — continuously",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-primary" />{item}
            </li>
          ))}
        </ul>
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
