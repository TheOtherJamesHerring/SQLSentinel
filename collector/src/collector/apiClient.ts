import axios from "axios";
import { config } from "./config.js";

const client = axios.create({
  baseURL: `${config.MONITOR_API_URL}/api/collect`,
  headers: {
    "x-monitor-api-key": config.MONITOR_API_KEY,
    "Content-Type": "application/json"
  },
  timeout: 15000
});

export async function pushMetrics(payload: Array<Record<string, unknown>>) {
  await client.post("/metrics", payload);
}

export async function pushEvents(payload: Array<Record<string, unknown>>) {
  await client.post("/events", payload);
}

export async function pushAlerts(payload: Array<Record<string, unknown>>) {
  await client.post("/alerts", payload);
}

export async function pushBlocking(payload: Array<Record<string, unknown>>) {
  await client.post("/blocking", payload);
}

export async function pushDbcc(payload: Array<Record<string, unknown>>) {
  await client.post("/dbcc", payload);
}

export async function pushHeartbeat(payload: Record<string, unknown>) {
  await client.post("/heartbeat", payload);
}

export async function pushDatabases(payload: Array<Record<string, unknown>>) {
  await client.post("/databases", payload);
}

export async function pushDiskVolumes(payload: Array<Record<string, unknown>>) {
  await client.post("/disks", payload);
}

export async function pushQueryStoreSnapshots(payload: Array<Record<string, unknown>>) {
  await client.post("/query-store", payload);
}

export async function pushBackupFailures(payload: Array<Record<string, unknown>>) {
  await client.post("/backup-failures", payload);
}

export async function pushAgentJobs(payload: Array<Record<string, unknown>>) {
  await client.post("/agent-jobs", payload);
}

export async function pushSchemaObjects(payload: Record<string, unknown>) {
  await client.post("/schema-objects", payload);
}

export async function pollAdHocJobs(serverId: string): Promise<Array<Record<string, unknown>>> {
  const res = await client.post<{ data: Array<Record<string, unknown>> }>("/job-poll", { serverId });
  return res.data.data ?? [];
}

export async function postJobResult(payload: {
  jobId: string;
  status: "running" | "completed" | "failed";
  durationMs?: number;
  resultSummary?: string;
}) {
  await client.post("/job-result", payload);
}
