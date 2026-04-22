import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useApiQuery } from "@/hooks/useApiQuery";

// TODO: Add event-to-remediation mapping, noise reduction for repeated events,
// and normalized severity classification for Windows and SQL Server events.

type SeverityClass = "critical" | "warning" | "informational";

type EventLike = {
  LogEventId: string | number;
  Source?: string | null;
  Severity?: string | null;
  EventId?: number | string | null;
  Message?: string | null;
  EventTime?: string | null;
};

function normalizeSeverity(severity: string | null | undefined): SeverityClass {
  const s = (severity ?? "").toLowerCase();
  const numeric = Number(s);
  // Windows event levels commonly map: 1 Critical, 2 Error, 3 Warning, 4 Info.
  if (Number.isFinite(numeric)) {
    if (numeric <= 2) return "critical";
    if (numeric === 3) return "warning";
    return "informational";
  }
  if (s.includes("critical") || s.includes("error") || s.includes("fatal") || s.includes("sev 1") || s.includes("sev 2")) {
    return "critical";
  }
  if (s.includes("warn")) return "warning";
  return "informational";
}

function severityToneClasses(severity: SeverityClass) {
  if (severity === "critical") {
    return {
      container: "border-red-900/60 bg-red-950/30",
      heading: "text-red-200",
      badge: "border border-red-900/70 bg-red-950/50 text-red-200",
      guidance: "text-red-100/90"
    };
  }
  if (severity === "warning") {
    return {
      container: "border-amber-900/60 bg-amber-950/20",
      heading: "text-amber-200",
      badge: "border border-amber-800/70 bg-amber-950/40 text-amber-200",
      guidance: "text-amber-100/90"
    };
  }
  return {
    container: "border-slate-700/70 bg-slate-900/30",
    heading: "text-slate-200",
    badge: "border border-slate-700/80 bg-slate-900/50 text-slate-200",
    guidance: "text-slate-200/90"
  };
}

function severityLabel(severity: SeverityClass) {
  if (severity === "critical") return "CRITICAL";
  if (severity === "warning") return "WARNING";
  return "INFORMATIONAL";
}

function severityRank(severity: SeverityClass) {
  if (severity === "critical") return 3;
  if (severity === "warning") return 2;
  return 1;
}

function toIntEventId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : null;
}

function deriveEventInterpretation(event: EventLike) {
  const source = (event.Source ?? "").toLowerCase();
  const msg = (event.Message ?? "").toLowerCase();
  const severity = normalizeSeverity(event.Severity);
  const eventId = toIntEventId(event.EventId);

  // Deterministic interpretation using source + event id + severity and known keywords.
  if (source.includes("sql") && (eventId === 18456 || msg.includes("login failed"))) {
    return {
      description: "SQL Server authentication failure was recorded.",
      guidance: "Review login state details, validate credentials, and investigate repeated failures for possible security exposure."
    };
  }
  if (source.includes("sql") && (eventId === 1205 || msg.includes("deadlock"))) {
    return {
      description: "SQL Server detected a deadlock and terminated one transaction.",
      guidance: "Investigate blocking patterns and query access order; monitor recurrence and tune affected workload paths."
    };
  }
  if (source.includes("sql") && (msg.includes("i/o") || msg.includes("825") || msg.includes("823") || msg.includes("824"))) {
    return {
      description: "SQL Server reported storage I/O reliability warnings or errors.",
      guidance: "Escalate for storage validation, review SQL error details, and confirm backup integrity and restore readiness."
    };
  }
  if (source.includes("sql") && (msg.includes("memory") || msg.includes("resource semaphore") || msg.includes("701"))) {
    return {
      description: "SQL Server signaled memory pressure conditions.",
      guidance: "Review memory grants and workload concurrency; validate instance memory settings and host memory availability."
    };
  }
  if ((source.includes("service control manager") || source.includes("windows")) && (eventId === 7036 || msg.includes("entered the") || msg.includes("running state"))) {
    return {
      description: "A Windows service state transition was recorded.",
      guidance: "Informational in most cases; verify expected maintenance activity if transitions are frequent or unexpected."
    };
  }
  if ((source.includes("disk") || source.includes("ntfs") || source.includes("storport") || source.includes("iastor")) && severity !== "informational") {
    return {
      description: "Windows logged a storage subsystem warning or error.",
      guidance: "Investigate disk and controller health, correlate with latency alerts, and verify recent backup completion."
    };
  }
  if (source.includes("security") || msg.includes("audit") || msg.includes("privilege") || msg.includes("failed login")) {
    return {
      description: "A security or audit-relevant event was generated.",
      guidance: "Validate user/activity context and review for repeated anomalies according to security monitoring policy."
    };
  }
  if (msg.includes("always on") || msg.includes("availability group") || msg.includes("failover")) {
    return {
      description: "High availability state or failover activity was reported.",
      guidance: "Confirm replica synchronization and role health; review cluster and AG logs for sequence and impact."
    };
  }

  if (severity === "critical") {
    return {
      description: "An error event was logged by the source component.",
      guidance: "Investigate this event alongside related entries before and after the timestamp to determine operational impact."
    };
  }
  if (severity === "warning") {
    return {
      description: "A warning indicates elevated risk or degraded behavior.",
      guidance: "Monitor closely and investigate if the condition repeats or correlates with performance or availability symptoms."
    };
  }
  return {
    description: "Informational event indicating normal or expected system activity.",
    guidance: "No immediate action is required unless this event appears unexpectedly in current operational context."
  };
}

function deriveRemediationArea(event: EventLike): string {
  const source = (event.Source ?? "").toLowerCase();
  const msg = (event.Message ?? "").toLowerCase();
  const eventId = toIntEventId(event.EventId);

  if (source.includes("sql") && (eventId === 18456 || msg.includes("login failed") || msg.includes("authentication"))) {
    return "Authentication / Login Hardening";
  }
  if (msg.includes("deadlock") || msg.includes("blocking") || msg.includes("resource semaphore") || msg.includes("memory")) {
    return "Performance & Resource Pressure";
  }
  if (msg.includes("i/o") || msg.includes("823") || msg.includes("824") || msg.includes("825") || source.includes("disk") || source.includes("ntfs") || source.includes("storport")) {
    return "Capacity & Growth Management";
  }
  if (msg.includes("availability group") || msg.includes("always on") || msg.includes("failover") || msg.includes("cluster")) {
    return "High Availability / Failover";
  }
  if (source.includes("security") || msg.includes("audit") || msg.includes("privilege") || msg.includes("access denied")) {
    return "Security Posture Review";
  }
  if (source.includes("service control manager") || msg.includes("service") || msg.includes("started") || msg.includes("stopped")) {
    return "Service Reliability & Operations";
  }
  return "General Operations Review";
}

function eventSignature(event: EventLike) {
  const src = (event.Source ?? "").trim().toLowerCase();
  const eventId = String(event.EventId ?? "-").trim().toLowerCase();
  const message = (event.Message ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  return `${src}|${eventId}|${message}`;
}

type EventGroup = {
  signature: string;
  events: EventLike[];
  normalizedSeverity: SeverityClass;
  remediationArea: string;
};

function groupRepeatedEvents(items: EventLike[]): EventGroup[] {
  const bySig = new Map<string, EventLike[]>();
  const order: string[] = [];

  for (const event of items) {
    const sig = eventSignature(event);
    if (!bySig.has(sig)) {
      bySig.set(sig, []);
      order.push(sig);
    }
    bySig.get(sig)!.push(event);
  }

  return order.map((sig) => {
    const group = bySig.get(sig) ?? [];
    const normalizedSeverity = group.reduce<SeverityClass>((acc, current) => {
      const next = normalizeSeverity(current.Severity);
      return severityRank(next) > severityRank(acc) ? next : acc;
    }, "informational");

    return {
      signature: sig,
      events: group,
      normalizedSeverity,
      remediationArea: deriveRemediationArea(group[0] ?? {})
    };
  });
}

function summarizeFrequencyWindow(events: EventLike[]) {
  const times = events
    .map((e) => (e.EventTime ? new Date(e.EventTime).getTime() : Number.NaN))
    .filter((v) => Number.isFinite(v));
  if (times.length < 2) return `Occurred ${events.length} times`;
  const min = Math.min(...times);
  const max = Math.max(...times);
  const minutes = Math.max(1, Math.round((max - min) / 60_000));
  return `Occurred ${events.length} times in ${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function formatEventTime(value: string | null | undefined) {
  if (!value) return "-";
  const dt = new Date(value);
  return Number.isNaN(dt.getTime()) ? "-" : dt.toLocaleString();
}

export function EventsPage() {
  const [source, setSource] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const qs = new URLSearchParams();
  if (source !== "all") qs.set("source", source);
  if (severity !== "all") qs.set("severity", severity);
  const events = useApiQuery<any[]>(["events", source, severity], `/events?${qs.toString()}`);
  const groupedEvents = groupRepeatedEvents(events.data ?? []);

  return (
    <Card>
      <CardHeader><CardTitle>Events & Logs</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          <Select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="all">All sources</option>
            <option value="sql_error_log">SQL Error Log</option>
            <option value="windows_event">Windows Events</option>
          </Select>
          <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="all">All severities</option>
            <option value="error">Error</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </Select>
        </div>
        <div className="space-y-3">
          {groupedEvents.map((group) => {
            const representative = group.events[0];
            const severityClass = group.normalizedSeverity;
            const tone = severityToneClasses(severityClass);
            const interpretation = deriveEventInterpretation(representative);
            const repeated = group.events.length > 1;
            const highFrequencyInfo = severityClass === "informational" && group.events.length >= 5;
            const expanded = expandedGroups[group.signature] ?? !highFrequencyInfo;

            return (
              <div key={group.signature} className={`rounded-lg border p-3 ${tone.container}`}>
                <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                  <p className={`text-sm font-semibold ${tone.heading}`}>
                    {representative?.Source ?? "Unknown Source"} · {representative?.Severity ?? "info"}
                  </p>
                  <span className={`rounded px-2 py-0.5 text-[11px] uppercase tracking-wide ${tone.badge}`}>
                    {severityLabel(severityClass)}
                  </span>
                </div>

                <p className="mb-2 text-sm text-slate-300">{representative?.Message ?? "-"}</p>

                <p className="text-xs text-slate-400">
                  Event ID: {representative?.EventId ?? "-"} · Time: {formatEventTime(representative?.EventTime)}
                </p>

                <div className="mt-2 space-y-1.5">
                  <p className="text-xs font-semibold text-slate-200/95">
                    Description: <span className="font-normal text-slate-300">{interpretation.description}</span>
                  </p>
                  <p className={`text-xs font-semibold ${tone.guidance}`}>
                    Operational guidance: <span className="font-normal text-slate-300">{interpretation.guidance}</span>
                  </p>
                  <p className="text-xs font-semibold text-slate-200/95">
                    Related remediation area: <span className="font-normal text-slate-300">{group.remediationArea}</span>
                  </p>
                  {repeated && (
                    <p className="text-xs font-semibold text-slate-200/95">
                      Repetition summary: <span className="font-normal text-slate-300">{summarizeFrequencyWindow(group.events)}{highFrequencyInfo ? " (collapsed by default)" : ""}</span>
                    </p>
                  )}
                </div>

                {repeated && (
                  <div className="mt-2">
                    <button
                      type="button"
                      className="text-xs font-medium text-slate-300 underline underline-offset-2 hover:text-white"
                      onClick={() =>
                        setExpandedGroups((prev) => ({
                          ...prev,
                          [group.signature]: !(prev[group.signature] ?? !highFrequencyInfo)
                        }))
                      }
                    >
                      {expanded ? "Hide repeated instances" : "Show repeated instances"}
                    </button>
                  </div>
                )}

                {repeated && expanded && (
                  <div className="mt-2 space-y-1 rounded border border-slate-700/60 bg-slate-950/20 p-2">
                    {group.events.map((evt) => (
                      <p key={evt.LogEventId} className="text-xs text-slate-300">
                        #{evt.LogEventId} · {formatEventTime(evt.EventTime)}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
