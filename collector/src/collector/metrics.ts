import { runQuery } from "./sqlConnection.js";

export async function collectCpuMemoryConnections() {
  let cpuRows: Array<{ CpuUsage: number }> = [];
  try {
    cpuRows = await runQuery<{ CpuUsage: number }>(`
      SELECT TOP 1
        100 - SystemIdle AS CpuUsage
      FROM (
        SELECT
          record.value('(./Record/SchedulerMonitorEvent/SystemHealth/SystemIdle)[1]', 'int') AS SystemIdle
        FROM (
          SELECT TOP 1 CONVERT(XML, record) AS record
          FROM sys.dm_os_ring_buffers
          WHERE ring_buffer_type = N'RING_BUFFER_SCHEDULER_MONITOR'
          ORDER BY timestamp DESC
        ) AS RingBuffer
      ) AS CPU;
    `);
  } catch {
    // Azure SQL Database fallback: use recent resource stats where available.
    cpuRows = await runQuery<{ CpuUsage: number }>(`
      SELECT TOP 1 CAST(avg_cpu_percent AS DECIMAL(5,2)) AS CpuUsage
      FROM sys.dm_db_resource_stats
      ORDER BY end_time DESC;
    `).catch(() => []);
  }

  let memoryRows: Array<{ MemoryUsedPct: number }> = [];
  try {
    memoryRows = await runQuery<{ MemoryUsedPct: number }>(`
      SELECT CAST(physical_memory_in_use_kb * 100.0 / total_physical_memory_kb AS DECIMAL(5,2)) AS MemoryUsedPct
      FROM sys.dm_os_process_memory
      CROSS JOIN sys.dm_os_sys_memory;
    `);
  } catch {
    memoryRows = await runQuery<{ MemoryUsedPct: number }>(`
      SELECT TOP 1 CAST(avg_memory_usage_percent AS DECIMAL(5,2)) AS MemoryUsedPct
      FROM sys.dm_db_resource_stats
      ORDER BY end_time DESC;
    `).catch(() => []);
  }

  const connectionRows = await runQuery<{ ActiveConnections: number }>(`
    SELECT COUNT(*) AS ActiveConnections
    FROM sys.dm_exec_sessions
    WHERE is_user_process = 1;
  `).catch(() => []);

  return {
    cpuUsage: cpuRows[0]?.CpuUsage ?? 0,
    memoryUsage: memoryRows[0]?.MemoryUsedPct ?? 0,
    activeConnections: connectionRows[0]?.ActiveConnections ?? 0
  };
}

export async function collectDiskMetrics() {
  return runQuery<{
    volume_mount_point: string;
    logical_volume_name: string;
    TotalGb: number;
    FreeGb: number;
    UsedPct: number;
  }>(`
    SELECT DISTINCT
      vs.volume_mount_point,
      vs.logical_volume_name,
      CAST(vs.total_bytes / 1073741824.0 AS DECIMAL(10,2)) AS TotalGb,
      CAST(vs.available_bytes / 1073741824.0 AS DECIMAL(10,2)) AS FreeGb,
      CAST((vs.total_bytes - vs.available_bytes) * 100.0 / vs.total_bytes AS DECIMAL(5,2)) AS UsedPct
    FROM sys.master_files mf
    CROSS APPLY sys.dm_os_volume_stats(mf.database_id, mf.file_id) vs;
  `).catch(() => []);
}

export async function collectTempdbUsage() {
  const rows = await runQuery<{
    TotalMb: number;
    UsedMb: number;
    VersionStoreMb: number;
    UserObjectMb: number;
    InternalObjectMb: number;
  }>(`
    SELECT
      CAST(SUM(total_page_count) / 128.0 AS DECIMAL(18,2)) AS TotalMb,
      CAST(SUM(allocated_extent_page_count) / 128.0 AS DECIMAL(18,2)) AS UsedMb,
      CAST(SUM(version_store_reserved_page_count) / 128.0 AS DECIMAL(18,2)) AS VersionStoreMb,
      CAST(SUM(user_object_reserved_page_count) / 128.0 AS DECIMAL(18,2)) AS UserObjectMb,
      CAST(SUM(internal_object_reserved_page_count) / 128.0 AS DECIMAL(18,2)) AS InternalObjectMb
    FROM tempdb.sys.dm_db_file_space_usage;
  `).catch(() => []);

  return rows[0] ?? {
    TotalMb: 0,
    UsedMb: 0,
    VersionStoreMb: 0,
    UserObjectMb: 0,
    InternalObjectMb: 0
  };
}
