import { useState } from "react";
import { Link2, ServerCog } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";

type SetupState = "idle" | "saving" | "saved" | "error";

export function ServerSetupPage() {
  const [state, setState] = useState<SetupState>("idle");
  const [message, setMessage] = useState("");
  const [serverId, setServerId] = useState("");
  const [profileId, setProfileId] = useState("");

  const [form, setForm] = useState({
    serverName: "",
    hostname: "",
    instanceName: "",
    port: "1433",
    environment: "production",
    authType: "SQL Auth",
    username: "sqlmonitor_svc",
    password: "",
    database: "master",
    encrypt: "true",
    trustServerCert: "false",
    timeout: "30"
  });

  function updateField(name: string, value: string) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSaveAll() {
    setState("saving");
    setMessage("");
    try {
      const server = await api<any>("/servers", {
        method: "POST",
        body: JSON.stringify({
          name: form.serverName,
          hostname: form.hostname,
          instanceName: form.instanceName || undefined,
          port: Number(form.port),
          environment: form.environment
        })
      });

      setServerId(server.ServerId);

      const profile = await api<any>("/connections", {
        method: "POST",
        body: JSON.stringify({
          name: `${form.serverName} Primary`,
          serverId: server.ServerId,
          hostname: form.hostname,
          port: Number(form.port),
          instanceName: form.instanceName || null,
          authType: form.authType,
          username: form.username,
          password: form.password,
          database: form.database,
          encrypt: form.encrypt === "true",
          trustServerCert: form.trustServerCert === "true",
          connectionTimeout: Number(form.timeout),
          environment: form.environment,
          notes: "Created from simple setup UX"
        })
      });

      setProfileId(profile.ProfileId);
      setState("saved");
      setMessage("Server and connection profile created.");
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Failed to save");
    }
  }

  async function handleTest() {
    if (!profileId) {
      setState("error");
      setMessage("Create the server profile first, then test.");
      return;
    }

    setState("saving");
    try {
      const result = await api<{ status: string }>(`/connections/${profileId}/test`, {
        method: "POST"
      });
      setState("saved");
      setMessage(`Connection test result: ${result.status}`);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : "Test failed");
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-white">Simple New Server Setup</h1>
        <p className="text-slate-400">
          Fill this one form, click save, then run test. This creates both the monitored server and its connection profile.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ServerCog className="h-5 w-5 text-blue-300" />
            Server Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Input placeholder="Server display name" value={form.serverName} onChange={(e) => updateField("serverName", e.target.value)} />
          <Input placeholder="Hostname / FQDN" value={form.hostname} onChange={(e) => updateField("hostname", e.target.value)} />
          <Input placeholder="Instance name (optional)" value={form.instanceName} onChange={(e) => updateField("instanceName", e.target.value)} />
          <Input placeholder="Port" value={form.port} onChange={(e) => updateField("port", e.target.value)} />
          <Select value={form.environment} onChange={(e) => updateField("environment", e.target.value)}>
            <option value="production">production</option>
            <option value="staging">staging</option>
            <option value="development">development</option>
            <option value="dr">dr</option>
          </Select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5 text-blue-300" />
            Connection Profile
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2">
          <Select value={form.authType} onChange={(e) => updateField("authType", e.target.value)}>
            <option value="SQL Auth">SQL Auth</option>
            <option value="Windows Auth">Windows Auth</option>
            <option value="Entra ID Password">Entra ID Password</option>
            <option value="Entra Service Principal">Entra Service Principal</option>
            <option value="Entra Managed Identity">Entra Managed Identity</option>
          </Select>
          <Input placeholder="Username" value={form.username} onChange={(e) => updateField("username", e.target.value)} />
          <Input type="password" placeholder="Password / client secret" value={form.password} onChange={(e) => updateField("password", e.target.value)} />
          <Input placeholder="Database" value={form.database} onChange={(e) => updateField("database", e.target.value)} />
          <Select value={form.encrypt} onChange={(e) => updateField("encrypt", e.target.value)}>
            <option value="true">Encrypt: true</option>
            <option value="false">Encrypt: false</option>
          </Select>
          <Select value={form.trustServerCert} onChange={(e) => updateField("trustServerCert", e.target.value)}>
            <option value="false">Trust server certificate: false</option>
            <option value="true">Trust server certificate: true</option>
          </Select>
          <Input placeholder="Connection timeout seconds" value={form.timeout} onChange={(e) => updateField("timeout", e.target.value)} />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div className="flex flex-wrap gap-3">
            <Button onClick={handleSaveAll} disabled={state === "saving" || !form.serverName || !form.hostname}>
              {state === "saving" ? "Saving..." : "Save Server + Profile"}
            </Button>
            <Button variant="secondary" onClick={handleTest} disabled={state === "saving" || !profileId}>
              Test Connection
            </Button>
          </div>

          {message ? (
            <div className="space-y-2 rounded-lg border border-border bg-slate-900 p-3 text-sm">
              <div className="flex items-center gap-2">
                <Badge
                  label={state === "saved" ? "success" : state === "error" ? "error" : "working"}
                  tone={state === "saved" ? "success" : state === "error" ? "danger" : "warning"}
                />
                <span className="text-slate-200">{message}</span>
              </div>
              {serverId ? <p className="text-xs text-slate-400">ServerId: {serverId}</p> : null}
              {profileId ? <p className="text-xs text-slate-400">ProfileId: {profileId}</p> : null}
            </div>
          ) : null}

          <p className="text-xs text-slate-400">
            Passwords and client secrets are encrypted at rest in SQLMonitorDB before being stored.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
