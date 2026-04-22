import { useState } from "react";
import { ChevronDown, ChevronRight, Lock, Key } from "lucide-react";
import { cn } from "@/lib/cn";

// ─── Types ────────────────────────────────────────────────────────────────────

type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE" | "PUT";
type AuthScheme = "bearer" | "api-key" | "none";

export interface ApiParam {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  description?: string;
  example?: string;
}

export interface ApiField {
  name: string;
  type: string;
  required?: boolean;
  description?: string;
}

export interface ApiEndpoint {
  method: HttpMethod;
  path: string;
  summary: string;
  description?: string;
  auth: AuthScheme;
  role?: string;
  params?: ApiParam[];
  requestBody?: ApiField[];
  responseFields?: ApiField[];
  tags?: string[];
}

export interface ApiGroup {
  label: string;
  description?: string;
  endpoints: ApiEndpoint[];
}

// ─── Method badge ─────────────────────────────────────────────────────────────

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET:    "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30",
  POST:   "bg-blue-500/15 text-blue-400 border border-blue-500/30",
  PATCH:  "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  PUT:    "bg-amber-500/15 text-amber-400 border border-amber-500/30",
  DELETE: "bg-red-500/15 text-red-400 border border-red-500/30",
};

function MethodBadge({ method }: { method: HttpMethod }) {
  return (
    <span className={cn("rounded px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-widest", METHOD_STYLES[method])}>
      {method}
    </span>
  );
}

// ─── Auth badge ───────────────────────────────────────────────────────────────

function AuthBadge({ auth, role }: { auth: AuthScheme; role?: string }) {
  if (auth === "none") return null;
  const icon = auth === "bearer" ? <Lock className="h-3 w-3" /> : <Key className="h-3 w-3" />;
  const label = auth === "bearer"
    ? role ? `JWT · ${role}` : "JWT"
    : "x-monitor-api-key";
  return (
    <span className="flex items-center gap-1 rounded bg-surface-2 border border-border px-2 py-0.5 text-xs text-muted">
      {icon}
      {label}
    </span>
  );
}

// ─── Field table ──────────────────────────────────────────────────────────────

function FieldTable({ fields }: { fields: ApiField[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-700">
          <th className="py-1.5 pr-3 text-left font-semibold text-slate-400">Field</th>
          <th className="py-1.5 pr-3 text-left font-semibold text-slate-400">Type</th>
          <th className="py-1.5 pr-3 text-left font-semibold text-slate-400">Req</th>
          <th className="py-1.5 text-left font-semibold text-slate-400">Description</th>
        </tr>
      </thead>
      <tbody>
        {fields.map((f) => (
          <tr key={f.name} className="border-b border-slate-800">
            <td className="py-1.5 pr-3 font-mono text-slate-200">{f.name}</td>
            <td className="py-1.5 pr-3 font-mono text-purple-400">{f.type}</td>
            <td className="py-1.5 pr-3 text-slate-500">{f.required ? <span className="text-red-400">✱</span> : "—"}</td>
            <td className="py-1.5 text-slate-400">{f.description ?? ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Single endpoint row ──────────────────────────────────────────────────────

function EndpointRow({ ep }: { ep: ApiEndpoint }) {
  const [open, setOpen] = useState(false);
  const hasDetail = ep.description || ep.params?.length || ep.requestBody?.length || ep.responseFields?.length;

  return (
    <div className="rounded-lg border border-border bg-surface-2">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
        onClick={() => hasDetail && setOpen((v) => !v)}
        aria-expanded={open}
      >
        <MethodBadge method={ep.method} />
        <span className="flex-1 font-mono text-sm text-foreground">{ep.path}</span>
        <span className="hidden text-xs text-slate-500 sm:inline">{ep.summary}</span>
        <AuthBadge auth={ep.auth} role={ep.role} />
        {hasDetail && (
          open
            ? <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" />
            : <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" />
        )}
      </button>

      {open && hasDetail && (
        <div className="space-y-4 border-t border-slate-700 px-4 py-4">
          {ep.description && (
            <p className="text-sm text-slate-400">{ep.description}</p>
          )}

          {ep.params && ep.params.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Parameters</p>
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="py-1.5 pr-3 text-left text-slate-400">Name</th>
                    <th className="py-1.5 pr-3 text-left text-slate-400">In</th>
                    <th className="py-1.5 text-left text-slate-400">Description</th>
                  </tr>
                </thead>
                <tbody>
                  {ep.params.map((p) => (
                    <tr key={p.name} className="border-b border-slate-800">
                      <td className="py-1.5 pr-3 font-mono text-slate-200">{p.name}</td>
                      <td className="py-1.5 pr-3 text-slate-500">{p.in}</td>
                      <td className="py-1.5 text-slate-400">{p.description ?? ""}{p.example ? ` (e.g. ${p.example})` : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {ep.requestBody && ep.requestBody.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Request Body</p>
              <FieldTable fields={ep.requestBody} />
            </div>
          )}

          {ep.responseFields && ep.responseFields.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Response</p>
              <FieldTable fields={ep.responseFields} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Group ────────────────────────────────────────────────────────────────────

function EndpointGroup({ group }: { group: ApiGroup }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="space-y-2">
      <button
        type="button"
        className="flex items-center gap-2 text-sm font-semibold text-slate-300"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        {group.label}
        <span className="ml-1 rounded-full bg-surface-2 border border-border px-2 py-0.5 text-xs font-normal text-muted">
          {group.endpoints.length}
        </span>
      </button>
      {group.description && <p className="pl-6 text-xs text-slate-500">{group.description}</p>}
      {open && (
        <div className="space-y-1.5 pl-4">
          {group.endpoints.map((ep) => <EndpointRow key={`${ep.method}-${ep.path}`} ep={ep} />)}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ApiExplorer({ groups, title }: { groups: ApiGroup[]; title?: string }) {
  const total = groups.reduce((n, g) => n + g.endpoints.length, 0);
  return (
    <div className="space-y-5">
      {title && (
        <div className="flex items-center gap-3">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <span className="rounded-full bg-surface-2 border border-border px-2.5 py-0.5 text-xs text-muted">{total} endpoints</span>
        </div>
      )}
      {groups.map((g) => <EndpointGroup key={g.label} group={g} />)}
    </div>
  );
}
