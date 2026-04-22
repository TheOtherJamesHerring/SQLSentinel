import { runQuery } from "./sqlConnection.js";

export async function collectBlockingSessions() {
  return runQuery<{
    session_id: number;
    blocking_session_id: number;
    DatabaseName: string;
    login_name: string;
    host_name: string;
    program_name: string;
    wait_type: string;
    wait_time: number;
    wait_resource: string;
    QueryText: string;
    status: string;
    cpu_time: number;
    logical_reads: number;
  }>(`
    SELECT
      r.session_id, r.blocking_session_id,
      DB_NAME(r.database_id) AS DatabaseName,
      s.login_name, s.host_name, s.program_name,
      r.wait_type, r.wait_time, r.wait_resource,
      SUBSTRING(st.text, (r.statement_start_offset/2)+1,
        ((CASE r.statement_end_offset WHEN -1 THEN DATALENGTH(st.text)
          ELSE r.statement_end_offset END - r.statement_start_offset)/2)+1) AS QueryText,
      r.status, r.cpu_time, r.logical_reads
    FROM sys.dm_exec_requests r
    JOIN sys.dm_exec_sessions s ON r.session_id = s.session_id
    CROSS APPLY sys.dm_exec_sql_text(r.sql_handle) st
    WHERE r.blocking_session_id > 0;
  `);
}
