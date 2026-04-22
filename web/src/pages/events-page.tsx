import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select } from "@/components/ui/select";
import { useApiQuery } from "@/hooks/useApiQuery";

export function EventsPage() {
  const [source, setSource] = useState("all");
  const [severity, setSeverity] = useState("all");
  const qs = new URLSearchParams();
  if (source !== "all") qs.set("source", source);
  if (severity !== "all") qs.set("severity", severity);
  const events = useApiQuery<any[]>(["events", source, severity], `/events?${qs.toString()}`);

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
          {(events.data ?? []).map((event) => (
            <div key={event.LogEventId} className="rounded-lg border border-border p-3">
              <p className="text-sm font-semibold text-white">{event.Source} · {event.Severity}</p>
              <p className="text-sm text-slate-300">{event.Message}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
