import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export function ConnectionBuilderPage() {
  const [server, setServer] = useState("localhost");
  const [port, setPort] = useState("1433");
  const [database, setDatabase] = useState("master");
  const [authType, setAuthType] = useState("sql");
  const [username, setUsername] = useState("sqlmonitor_svc");
  const [timeout, setTimeout] = useState("30");

  const strings = useMemo(() => {
    const host = `${server},${port}`;
    return {
      adonet: `Server=${host};Database=${database};User Id=${username};Password=***;Encrypt=True;TrustServerCertificate=False;Connection Timeout=${timeout};`,
      odbc: `Driver={ODBC Driver 18 for SQL Server};Server=${host};Database=${database};Uid=${username};Pwd=***;Encrypt=yes;TrustServerCertificate=no;`,
      node: `sql.connect({ server: '${server}', port: ${port}, user: '${username}', password: process.env.DB_PASSWORD, database: '${database}', options: { encrypt: true, trustServerCertificate: false }, connectionTimeout: ${Number(timeout) * 1000} })`,
      powershell: `Server=${server};Database=${database};User ID=${username};Password=***;Encrypt=True;TrustServerCertificate=False`,
      python: `DRIVER={ODBC Driver 18 for SQL Server};SERVER=${host};DATABASE=${database};UID=${username};PWD=***;Encrypt=yes;TrustServerCertificate=no`,
      efcore: `Server=${host};Database=${database};User Id=${username};Password=***;Encrypt=True;TrustServerCertificate=False;`
    };
  }, [server, port, database, username, timeout]);

  return (
    <Card>
      <CardHeader><CardTitle>Connection String Builder</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Input value={server} onChange={(e) => setServer(e.target.value)} placeholder="server" />
          <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="port" />
          <Input value={database} onChange={(e) => setDatabase(e.target.value)} placeholder="database" />
          <Select value={authType} onChange={(e) => setAuthType(e.target.value)}>
            <option value="sql">SQL Auth</option>
            <option value="windows">Windows Auth</option>
            <option value="entra_password">Entra ID Password</option>
            <option value="entra_sp">Entra Service Principal</option>
            <option value="managed_identity">Entra Managed Identity</option>
          </Select>
          <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="username" />
          <Input value={timeout} onChange={(e) => setTimeout(e.target.value)} placeholder="timeout" />
        </div>

        <div className="space-y-3">
          {Object.entries(strings).map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-slate-900 p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-400">{label}</p>
              <pre className="code-block overflow-x-auto text-xs text-slate-200">{value}</pre>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
