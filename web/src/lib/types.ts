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

export type SecurityRiskFlag = "CRITICAL" | "HIGH_RISK" | "MEDIUM_RISK" | "BLIND_SPOT" | "OK";

export interface SecurityAuditFinding {
  server_name: string;
  audit_timestamp_utc: string;
  check_name: string;
  finding: string;
  detail: string;
  risk_flag: SecurityRiskFlag;
}

export interface SecurityAuditRunSummary {
  runId: string;
  ranAtUtc: string;
  targetLabel: string;
  score: number;
  grade: "A" | "B" | "C" | "D" | "F";
  counts: Record<SecurityRiskFlag, number>;
  exportStatus: "skipped" | "success" | "failed";
  exportMessage: string;
}

export interface SecurityAuditRunResponse {
  summary: SecurityAuditRunSummary;
  findings: SecurityAuditFinding[];
  remediation: Array<{
    checkName: string;
    recommendation: string;
  }>;
}

export interface SecurityAuditRunRequest {
  sqlTarget: {
    targetLabel: string;
    environment?: string;
    notes?: string;
  };
  fabric: {
    enabled: boolean;
    tenantId?: string;
    clientId?: string;
    clientSecret?: string;
    workspaceId?: string;
    lakehouseId?: string;
    filePrefix?: string;
    scope?: string;
    baseUrl?: string;
  };
}

// ─── Remediation Scope of Work ────────────────────────────────────────────────

export type RemediationRole = "DBA" | "Security Engineer";

export interface RemediationTask {
  taskId: string;
  relatedCheck: string;
  riskLevel: "CRITICAL" | "HIGH_RISK" | "MEDIUM_RISK" | "BLIND_SPOT";
  impactedServers?: string[];
  impactedDatabases?: string[];
  whyItMatters: string;
  remediationSteps: string[];
  verificationSteps: string[];
  estimatedEffortHours: number;
  scoreImprovementIfResolved: number;
  blocking: boolean;
}

export interface RemediationWorkstream {
  role: RemediationRole;
  objective: string;
  tasks: RemediationTask[];
}

export interface RemediationScope {
  currentScore: number;
  targetScore: number;
  currentGrade: "A" | "B" | "C" | "D" | "F";
  targetGrade: "B";
  affectedServers: string[];
  affectedDatabases: string[];
  effortEstimateHours: { dba: number; securityEngineer: number };
  workstreams: RemediationWorkstream[];
  acceptanceCriteria: {
    requiredConditions: string[];
    reRunAuditRequired: true;
    expectedScoreAfterRemediation: number;
  };
}
