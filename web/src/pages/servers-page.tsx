import { Link } from "react-router-dom";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { RiskGauge } from "@/components/ui/risk-gauge";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { ServerSummary } from "@/lib/types";

const statusTone = {
  online: "success",
  warning: "warning",
  critical: "danger",
  offline: "muted",
  unknown: "muted"
} as const;

export function ServersPage() {
  const { data } = useApiQuery<ServerSummary[]>(["servers"], "/servers");
  const [sortBy, setSortBy] = useState<"Name" | "CpuUsage" | "MemoryUsage" | "DiskUsage">("Name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    const rows = [...(data ?? [])];
    rows.sort((a, b) => {
      const aValue = a[sortBy] ?? 0;
      const bValue = b[sortBy] ?? 0;
      if (typeof aValue === "string" && typeof bValue === "string") {
        return direction === "asc" ? aValue.localeCompare(bValue) : bValue.localeCompare(aValue);
      }
      return direction === "asc" ? Number(aValue) - Number(bValue) : Number(bValue) - Number(aValue);
    });
    return rows;
  }, [data, sortBy, direction]);

  function sortableHeader(label: string, key: "Name" | "CpuUsage" | "MemoryUsage" | "DiskUsage") {
    return (
      <button
        className="text-left text-xs uppercase tracking-wide text-slate-400"
        onClick={() => {
          if (sortBy === key) {
            setDirection((d) => (d === "asc" ? "desc" : "asc"));
          } else {
            setSortBy(key);
            setDirection("asc");
          }
        }}
      >
        {label}
      </button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Monitored SQL Servers</CardTitle>
      </CardHeader>
      <CardContent className="overflow-x-auto">
        <Table>
          <THead>
            <TR>
              <TH>{sortableHeader("Server", "Name")}</TH>
              <TH>Version</TH>
              <TH>Uptime</TH>
              <TH>{sortableHeader("CPU%", "CpuUsage")}</TH>
              <TH>{sortableHeader("Memory%", "MemoryUsage")}</TH>
              <TH>{sortableHeader("Disk%", "DiskUsage")}</TH>
              <TH>Connections</TH>
              <TH>Status</TH>
            </TR>
          </THead>
          <tbody>
            {sorted.map((server) => {
              const cpu    = server.CpuUsage    ?? 0;
              const mem    = server.MemoryUsage ?? 0;
              const disk   = server.DiskUsage   ?? 0;
              const isRisk = cpu >= 80 || mem >= 85 || disk >= 85;
              return (
              <TR key={server.ServerId} className={isRisk ? "bg-warning/5" : ""}>
                <TD>
                  <Link to={`/servers/${server.ServerId}`} className="font-semibold text-blue-300 hover:text-blue-200">
                    {server.Name}
                  </Link>
                  <p className="text-xs text-slate-400">{server.Hostname}</p>
                </TD>
                <TD>{server.SqlVersion ?? "-"}</TD>
                <TD>{server.UptimeDays?.toFixed(1) ?? "-"}d</TD>
                <TD>
                  <RiskGauge value={cpu} warn={80} critical={90} />
                </TD>
                <TD>
                  <RiskGauge value={mem} warn={85} critical={95} />
                </TD>
                <TD>
                  <RiskGauge value={disk} warn={80} critical={90} />
                </TD>
                <TD>{server.ActiveConnections ?? 0}</TD>
                <TD>
                  <Badge label={server.Status} tone={statusTone[server.Status]} />
                </TD>
              </TR>
              );
            })}
          </tbody>
        </Table>
      </CardContent>
    </Card>
  );
}
