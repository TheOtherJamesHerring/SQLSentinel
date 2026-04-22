export type StatusType = "online" | "warning" | "critical" | "offline" | "unknown";

export interface ServerSummary {
  ServerId: string;
  Name: string;
  Hostname: string;
  SqlVersion?: string;
  SqlEdition?: string;
  UptimeDays?: number;
  CpuUsage?: number;
  MemoryUsage?: number;
  DiskUsage?: number;
  ActiveConnections?: number;
  Status: StatusType;
  BlockedProcesses?: number;
  LastCheck?: string;
}

export interface AlertItem {
  AlertId: string;
  AlertType: string;
  Severity: "critical" | "warning" | "info";
  Status: "new" | "acknowledged" | "resolved";
  Title: string;
  Message: string;
  MetricValue?: number;
  ThresholdValue?: number;
  AiSummary?: string;
  AiRecommendation?: string;
  AcknowledgedBy?: string;
  AcknowledgedAt?: string;
  ResolvedBy?: string;
  ResolvedAt?: string;
  TriggeredAt: string;
  ServerId?: string;
  DatabaseId?: string;
  CreatedDate?: string;
}
