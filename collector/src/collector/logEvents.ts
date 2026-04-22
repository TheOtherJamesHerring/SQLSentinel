import { runQuery } from "./sqlConnection.js";

export async function collectSqlErrorLogEntries() {
  return runQuery<{ LogDate: string; ProcessInfo: string; Text: string }>(`
    EXEC sp_readerrorlog 0, 1, N'Error';
  `).catch(() => []);
}

export async function collectWindowsEventsStub() {
  return [
    {
      source: "windows_event",
      severity: "warning",
      message: "Windows event collection requires host-level integration in this deployment profile.",
      eventTime: new Date().toISOString(),
      category: "system"
    }
  ];
}
