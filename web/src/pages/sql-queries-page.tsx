import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const queries = [
  { category: "Performance", name: "Top waits", severity: "safe to run", sql: "SELECT TOP 20 wait_type, wait_time_ms FROM sys.dm_os_wait_stats ORDER BY wait_time_ms DESC;" },
  { category: "Performance", name: "Expensive queries", severity: "safe to run", sql: "SELECT TOP 20 total_worker_time, execution_count FROM sys.dm_exec_query_stats ORDER BY total_worker_time DESC;" },
  { category: "Performance", name: "Missing indexes", severity: "use with caution", sql: "SELECT * FROM sys.dm_db_missing_index_details;" },
  { category: "Performance", name: "Index usage", severity: "safe to run", sql: "SELECT * FROM sys.dm_db_index_usage_stats;" },
  { category: "Blocking", name: "Blocking tree", severity: "safe to run", sql: "SELECT * FROM sys.dm_exec_requests WHERE blocking_session_id > 0;" },
  { category: "Blocking", name: "Deadlock history", severity: "safe to run", sql: "SELECT * FROM sys.fn_xe_file_target_read_file('system_health*.xel', NULL, NULL, NULL);" },
  { category: "Blocking", name: "Open transactions", severity: "safe to run", sql: "DBCC OPENTRAN;" },
  { category: "Maintenance", name: "Fragmentation check", severity: "safe to run", sql: "SELECT * FROM sys.dm_db_index_physical_stats(DB_ID(), NULL, NULL, NULL, 'LIMITED');" },
  { category: "Maintenance", name: "Backup status", severity: "safe to run", sql: "SELECT TOP 50 database_name, backup_finish_date FROM msdb.dbo.backupset ORDER BY backup_finish_date DESC;" },
  { category: "Maintenance", name: "DBCC history", severity: "safe to run", sql: "SELECT * FROM msdb.dbo.dbcc_last_results;" },
  { category: "Security", name: "Logins", severity: "safe to run", sql: "SELECT name, type_desc, is_disabled FROM sys.server_principals;" },
  { category: "Security", name: "Permissions audit", severity: "safe to run", sql: "SELECT * FROM sys.server_permissions;" },
  { category: "Security", name: "Failed logins", severity: "safe to run", sql: "EXEC xp_readerrorlog 0, 1, 'Login failed';" },
  { category: "Capacity", name: "Database sizes", severity: "safe to run", sql: "EXEC sp_MSforeachdb 'USE [?]; EXEC sp_spaceused';" },
  { category: "Capacity", name: "Log usage", severity: "safe to run", sql: "DBCC SQLPERF(LOGSPACE);" },
  { category: "Capacity", name: "Filegroup details", severity: "safe to run", sql: "SELECT * FROM sys.filegroups;" },
  { category: "Capacity", name: "VLF count", severity: "use with caution", sql: "DBCC LOGINFO;" },
  { category: "Performance", name: "CPU by database", severity: "safe to run", sql: "SELECT DB_NAME(database_id), SUM(total_worker_time) FROM sys.dm_exec_query_stats GROUP BY database_id;" },
  { category: "Performance", name: "Memory grants", severity: "safe to run", sql: "SELECT * FROM sys.dm_exec_query_memory_grants;" },
  { category: "Performance", name: "Tempdb usage", severity: "safe to run", sql: "SELECT * FROM sys.dm_db_file_space_usage;" },
  { category: "Blocking", name: "Long transactions", severity: "safe to run", sql: "SELECT * FROM sys.dm_tran_active_transactions;" },
  { category: "Maintenance", name: "Statistics stale", severity: "safe to run", sql: "SELECT * FROM sys.stats WHERE STATS_DATE(object_id, stats_id) < DATEADD(day, -7, GETDATE());" },
  { category: "Security", name: "SA role members", severity: "requires SA", sql: "EXEC sp_helpsrvrolemember 'sysadmin';" },
  { category: "Capacity", name: "Autogrowth settings", severity: "safe to run", sql: "SELECT * FROM sys.database_files;" },
  { category: "Maintenance", name: "Agent job failures", severity: "safe to run", sql: "SELECT * FROM msdb.dbo.sysjobhistory WHERE run_status = 0;" }
];

export function SqlQueriesPage() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");

  const filtered = useMemo(
    () =>
      queries.filter(
        (item) =>
          (category === "all" || item.category.toLowerCase() === category) &&
          (item.name.toLowerCase().includes(search.toLowerCase()) || item.sql.toLowerCase().includes(search.toLowerCase()))
      ),
    [search, category]
  );

  return (
    <Card>
      <CardHeader><CardTitle>SQL Query Library (25 scripts)</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-2">
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search scripts..." />
          <Select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="all">All categories</option>
            <option value="performance">Performance</option>
            <option value="blocking">Blocking</option>
            <option value="maintenance">Maintenance</option>
            <option value="security">Security</option>
            <option value="capacity">Capacity</option>
          </Select>
        </div>
        <div className="space-y-3">
          {filtered.map((item) => (
            <div key={item.name} className="rounded-lg border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="font-semibold text-white">{item.name}</p>
                <Badge
                  label={item.severity}
                  tone={item.severity === "requires SA" ? "danger" : item.severity === "use with caution" ? "warning" : "success"}
                />
              </div>
              <p className="mb-2 text-xs text-slate-400">{item.category}</p>
              <pre className="code-block overflow-x-auto rounded bg-slate-900 p-3 text-xs text-slate-200">{item.sql}</pre>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
