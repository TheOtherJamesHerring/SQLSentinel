import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Download,
  FileDown,
  ShieldCheck,
  User2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { RemediationScope, RemediationTask } from "@/lib/types";

// ─── Props ───────────────────────────────────────────────────────────────────

interface SecurityRemediationModalProps {
  scope: RemediationScope;
  onClose: () => void;
  targetLabel?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const RISK_BADGE_TONE: Record<string, "danger" | "warning" | "primary" | "muted"> = {
  CRITICAL: "danger",
  HIGH_RISK: "warning",
  MEDIUM_RISK: "primary",
  BLIND_SPOT: "muted",
};

const RISK_BORDER: Record<string, string> = {
  CRITICAL: "border-l-danger",
  HIGH_RISK: "border-l-warning",
  MEDIUM_RISK: "border-l-primary",
  BLIND_SPOT: "border-l-muted",
};

const RISK_BORDER_COLOR: Record<string, string> = {
  CRITICAL: "#b30000",
  HIGH_RISK: "#b85900",
  MEDIUM_RISK: "#0052cc",
  BLIND_SPOT: "#999999",
};

function gradeColor(grade: string) {
  if (grade === "A") return "text-success";
  if (grade === "B") return "text-primary";
  if (grade === "C") return "text-warning";
  return "text-danger";
}

// ─── Export helpers ──────────────────────────────────────────────────────────

function buildTextExport(scope: RemediationScope, targetLabel: string): string {
  const servers = scope.affectedServers.length ? scope.affectedServers.join(", ") : "(unknown)";
  const databases = scope.affectedDatabases.length ? scope.affectedDatabases.join(", ") : "None identified";
  const lines: string[] = [
    "SQL SECURITY POSTURE — REMEDIATION SCOPE OF WORK",
    "=".repeat(60),
    `Target          : ${targetLabel}`,
    `Server(s)       : ${servers}`,
    `Database(s)     : ${databases}`,
    `Current Score   : ${scope.currentScore}  (Grade ${scope.currentGrade})`,
    `Target Score    : ${scope.targetScore}  (Grade ${scope.targetGrade})`,
    `DBA Effort      : ${scope.effortEstimateHours.dba}h`,
    `Security Eng.   : ${scope.effortEstimateHours.securityEngineer}h`,
    "",
  ];

  for (const ws of scope.workstreams) {
    lines.push(`${"─".repeat(60)}`);
    lines.push(`WORKSTREAM — ${ws.role.toUpperCase()}`);
    lines.push(`Objective: ${ws.objective}`);
    lines.push("");

    for (const task of ws.tasks) {
      lines.push(`  [${task.taskId}] ${task.relatedCheck.replace(/_/g, " ")} | ${task.riskLevel.replace(/_/g, " ")} | ${task.estimatedEffortHours}h | +${task.scoreImprovementIfResolved} pts${task.blocking ? " | BLOCKING" : ""}`);
      if (task.impactedServers?.length) {
        lines.push(`  Server(s): ${task.impactedServers.join(", ")}`);
      }
      if (task.impactedDatabases?.length) {
        lines.push(`  Database(s): ${task.impactedDatabases.join(", ")}`);
      }
      lines.push(`  Why it matters:`);
      lines.push(`    ${task.whyItMatters}`);
      lines.push(`  Remediation steps:`);
      task.remediationSteps.forEach((s, i) => lines.push(`    ${i + 1}. ${s}`));
      lines.push(`  Verification:`);
      task.verificationSteps.forEach((s) => lines.push(`    - ${s}`));
      lines.push("");
    }
  }

  lines.push("─".repeat(60));
  lines.push("ACCEPTANCE CRITERIA");
  scope.acceptanceCriteria.requiredConditions.forEach((c) => lines.push(`  • ${c}`));
  lines.push(`Expected score after remediation: ${scope.acceptanceCriteria.expectedScoreAfterRemediation}`);
  lines.push("Re-audit required: YES");

  return lines.join("\n");
}

function downloadText(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── PDF export (print-to-PDF via new window) ─────────────────────────────────

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="40" height="40">
  <rect width="512" height="512" rx="96" fill="#1d4ed8"/>
  <rect x="112" y="180" width="288" height="200" rx="18" fill="#1e3a8a" stroke="#3b82f6" stroke-width="8"/>
  <ellipse cx="256" cy="180" rx="144" ry="42" fill="#2563eb" stroke="#3b82f6" stroke-width="8"/>
  <ellipse cx="256" cy="240" rx="144" ry="42" fill="none" stroke="#3b82f6" stroke-width="8"/>
  <ellipse cx="256" cy="300" rx="144" ry="42" fill="none" stroke="#3b82f6" stroke-width="8"/>
  <ellipse cx="256" cy="380" rx="144" ry="42" fill="#2563eb" stroke="#3b82f6" stroke-width="8"/>
  <text x="256" y="198" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="52" font-weight="800" letter-spacing="-1">SQL</text>
</svg>`;

const RISK_PRINT_COLOR: Record<string, { bg: string; text: string; border: string }> = {
  CRITICAL:    { bg: "#fff0f0", text: "#b30000", border: "#b30000" },
  HIGH_RISK:   { bg: "#fff4e8", text: "#b85900", border: "#b85900" },
  MEDIUM_RISK: { bg: "#e8f0ff", text: "#0052cc", border: "#0052cc" },
  BLIND_SPOT:  { bg: "#f0f0f0", text: "#444444", border: "#999999" },
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPdfHtml(scope: RemediationScope, targetLabel: string): string {
  const date = new Date().toLocaleDateString("en-GB", {
    year: "numeric", month: "long", day: "numeric",
  });
  const timestamp = new Date().toLocaleString("en-GB");

  const gradeHex = (g: string) =>
    g === "A" ? "#0d6b3b" : g === "B" ? "#0052cc" : g === "C" ? "#b85900" : "#b30000";

  function taskHtml(task: RemediationTask, idx: number): string {
    const rc = RISK_PRINT_COLOR[task.riskLevel] ?? RISK_PRINT_COLOR.BLIND_SPOT;
    const blockingBadge = task.blocking
      ? `<span style="background:#fff0f0;color:#b30000;border:1px solid #b30000;border-radius:4px;padding:1px 7px;font-size:9px;font-weight:700;margin-left:6px;">BLOCKING</span>`
      : "";
    const steps = task.remediationSteps
      .map((s, i) => `<li style="margin-bottom:5px;"><span style="font-family:monospace;font-size:10px;font-weight:700;color:#1a1a1a;">${String(i + 1).padStart(2, "0")}.</span>&nbsp;${esc(s)}</li>`)
      .join("");
    const checks = task.verificationSteps
      .map((s) => `<li style="margin-bottom:4px;">&#10003;&nbsp;${esc(s)}</li>`)
      .join("");
    const impactedServers = task.impactedServers?.length
      ? `<p style="margin:0 0 4px;font-size:10px;color:#555;"><strong>Server(s):</strong> ${esc(task.impactedServers.join(", "))}</p>`
      : "";
    const impactedDatabases = task.impactedDatabases?.length
      ? `<p style="margin:0 0 8px;font-size:10px;color:#555;"><strong>Database(s):</strong> ${esc(task.impactedDatabases.join(", "))}</p>`
      : "";
    return `
      <div style="border:1px solid #d0d0d0;border-left:4px solid ${rc.border};border-radius:6px;margin-bottom:14px;page-break-inside:avoid;background:#fff;">
        <div style="padding:10px 14px 8px;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">
            <span style="font-family:monospace;font-size:10px;color:#666;">TASK-${String(idx + 1).padStart(2, "0")}</span>
            <span style="background:${rc.bg};color:${rc.text};border:1px solid ${rc.border};border-radius:4px;padding:1px 7px;font-size:9px;font-weight:700;">${task.riskLevel.replace(/_/g, " ")}</span>
            ${blockingBadge}
            <span style="margin-left:auto;font-size:10px;color:#666;">${task.estimatedEffortHours}h &nbsp;|&nbsp; +${task.scoreImprovementIfResolved} pts</span>
          </div>
          <div style="font-size:13px;font-weight:700;color:#1a1a1a;">${esc(task.relatedCheck.replace(/_/g, " "))}</div>
        </div>
        <div style="padding:0 14px 12px;border-top:1px solid #f0f0f0;">
          ${impactedServers}
          ${impactedDatabases}
          <p style="margin:10px 0 4px;font-size:11px;font-weight:700;color:#b85900;">&#9888; Why it matters</p>
          <p style="font-size:11px;color:#444;margin:0 0 10px;line-height:1.6;">${esc(task.whyItMatters)}</p>
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#1a1a1a;">Remediation steps</p>
          <ol style="margin:0 0 10px;padding-left:18px;font-size:11px;color:#444;line-height:1.6;">${steps}</ol>
          <p style="margin:0 0 6px;font-size:11px;font-weight:700;color:#1a1a1a;">Verification</p>
          <ul style="margin:0;padding-left:18px;font-size:11px;color:#444;line-height:1.6;list-style:none;">${checks}</ul>
        </div>
      </div>`;
  }

  const workstreamSections = scope.workstreams.map((ws, wsIdx) => {
    const pageBreak = wsIdx > 0 ? "page-break-before:always;" : "";
    const tasks = ws.tasks.map((t, i) => taskHtml(t, i)).join("");
    return `
      <section style="${pageBreak}">
        <div style="display:flex;align-items:center;gap:8px;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #0052cc;">
          <span style="font-size:14px;font-weight:700;color:#1a1a1a;">${esc(ws.role)}</span>
          <span style="font-size:11px;color:#666;">&#8212; ${esc(ws.objective)}</span>
        </div>
        ${tasks}
      </section>`;
  }).join("");

  const criteria = scope.acceptanceCriteria.requiredConditions
    .map((c) => `<li style="margin-bottom:6px;">&#10003;&nbsp;${esc(c)}</li>`)
    .join("");

  const totalHours = scope.effortEstimateHours.dba + scope.effortEstimateHours.securityEngineer;
  const blockingCount = scope.workstreams.flatMap((w) => w.tasks).filter((t) => t.blocking).length;
  const servers = scope.affectedServers.length ? scope.affectedServers.join(", ") : "(unknown)";
  const databases = scope.affectedDatabases.length ? scope.affectedDatabases.join(", ") : "None identified";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>SQL Remediation SoW – ${esc(targetLabel)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" />
<style>
  @page { size: A4; margin: 2cm 2.2cm 2.2cm; }
  * { box-sizing: border-box; }
  body {
    font-family: 'Space Grotesk', system-ui, sans-serif;
    font-size: 12px;
    color: #1a1a1a;
    background: #fff;
    margin: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1,h2,h3,h4 { margin: 0; }
  p { margin: 0; }
  @media print {
    .no-print { display: none !important; }
    body { font-size: 11px; }
    a { text-decoration: none; color: inherit; }
  }
  .print-btn {
    display: inline-flex; align-items: center; gap: 6px;
    background: #0052cc; color: #fff; border: none; border-radius: 6px;
    padding: 8px 16px; font-size: 13px; font-weight: 600; cursor: pointer;
    font-family: inherit;
  }
  .print-btn:hover { opacity: 0.88; }
  footer {
    margin-top: 32px;
    padding-top: 12px;
    border-top: 1px solid #d0d0d0;
    font-size: 10px;
    color: #888;
    display: flex;
    justify-content: space-between;
    page-break-inside: avoid;
  }
</style>
</head>
<body>

<!-- Print toolbar (hidden when printing) -->
<div class="no-print" style="background:#f5f5f5;border-bottom:1px solid #d0d0d0;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;">
  <span style="font-size:12px;color:#666;">Ready to export — click <strong>Save as PDF</strong> in the print dialog.</span>
  <button class="print-btn" onclick="window.print()">&#128438;&nbsp; Print / Save as PDF</button>
</div>

<!-- Document -->
<div style="padding: 0;">

  <!-- Cover header -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;padding-bottom:18px;border-bottom:3px solid #0052cc;margin-bottom:24px;">
    <div style="display:flex;align-items:center;gap:12px;">
      <div>${LOGO_SVG}</div>
      <div>
        <div style="font-size:18px;font-weight:800;color:#1a1a1a;letter-spacing:-0.3px;">SQLSentinel</div>
        <div style="font-size:11px;color:#666;margin-top:1px;">SQL Security Posture Platform</div>
      </div>
    </div>
    <div style="text-align:right;">
      <div style="font-size:10px;color:#888;">${esc(date)}</div>
      <div style="display:inline-block;margin-top:4px;background:#fff0f0;color:#b30000;border:1px solid #b30000;border-radius:4px;padding:2px 8px;font-size:9px;font-weight:700;letter-spacing:0.5px;">INTERNAL — AUTHORIZED ASSESSMENT</div>
    </div>
  </div>

  <!-- Document title block -->
  <div style="margin-bottom:24px;">
    <h1 style="font-size:22px;font-weight:800;color:#1a1a1a;margin-bottom:4px;">Remediation Scope of Work</h1>
    <p style="font-size:12px;color:#666;">Target: <strong>${esc(targetLabel)}</strong></p>
    <p style="font-size:11px;color:#666;margin-top:4px;">Server(s): <strong>${esc(servers)}</strong></p>
    <p style="font-size:11px;color:#666;margin-top:2px;">Database(s) requiring remediation: <strong>${esc(databases)}</strong></p>
  </div>

  <!-- Score summary -->
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:28px;">
    <div style="border:1px solid #d0d0d0;border-radius:8px;padding:12px;text-align:center;background:#fafafa;">
      <div style="font-size:10px;color:#888;margin-bottom:4px;">Current Score</div>
      <div style="font-size:26px;font-weight:800;color:${gradeHex(scope.currentGrade)};">${scope.currentScore}</div>
      <div style="font-size:10px;font-weight:700;color:${gradeHex(scope.currentGrade)};">Grade ${esc(scope.currentGrade)}</div>
    </div>
    <div style="border:1px solid #d0d0d0;border-radius:8px;padding:12px;text-align:center;background:#fafafa;">
      <div style="font-size:10px;color:#888;margin-bottom:4px;">Target Score</div>
      <div style="font-size:26px;font-weight:800;color:#0052cc;">${scope.targetScore}</div>
      <div style="font-size:10px;font-weight:700;color:#0052cc;">Grade ${esc(scope.targetGrade)}</div>
    </div>
    <div style="border:1px solid #d0d0d0;border-radius:8px;padding:12px;text-align:center;background:#fafafa;">
      <div style="font-size:10px;color:#888;margin-bottom:4px;">DBA Effort</div>
      <div style="font-size:26px;font-weight:800;color:#1a1a1a;">${scope.effortEstimateHours.dba}h</div>
      <div style="font-size:10px;color:#888;">estimated</div>
    </div>
    <div style="border:1px solid #d0d0d0;border-radius:8px;padding:12px;text-align:center;background:#fafafa;">
      <div style="font-size:10px;color:#888;margin-bottom:4px;">Security Eng.</div>
      <div style="font-size:26px;font-weight:800;color:#1a1a1a;">${scope.effortEstimateHours.securityEngineer}h</div>
      <div style="font-size:10px;color:#888;">estimated</div>
    </div>
  </div>

  <!-- Executive summary strip -->
  <div style="background:#e8f0ff;border:1px solid #0052cc;border-radius:8px;padding:12px 16px;margin-bottom:28px;font-size:11px;color:#1a1a1a;">
    This document contains <strong>${blockingCount} blocking task${blockingCount !== 1 ? "s" : ""}</strong> required to reach Grade B
    and <strong>${totalHours}h</strong> of total estimated remediation effort.
    Expected score after resolving all blocking items:
    <strong>${scope.acceptanceCriteria.expectedScoreAfterRemediation}</strong>.
    A re-audit is required to confirm the improved posture.
  </div>

  <!-- Workstreams -->
  ${workstreamSections}

  <!-- Acceptance criteria -->
  <section style="page-break-inside:avoid;margin-top:28px;">
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #0052cc;">
      <span style="font-size:14px;font-weight:700;color:#1a1a1a;">Acceptance Criteria</span>
    </div>
    <div style="border:1px solid #d0d0d0;border-radius:8px;padding:14px 16px;background:#fafafa;">
      <ul style="margin:0;padding-left:4px;list-style:none;font-size:11px;color:#444;line-height:1.7;">${criteria}</ul>
      <div style="margin-top:12px;background:#e8f0ff;border:1px solid #0052cc;border-radius:6px;padding:10px 12px;font-size:11px;color:#1a1a1a;">
        Expected score after full remediation: <strong>${scope.acceptanceCriteria.expectedScoreAfterRemediation}</strong> &mdash; re-audit required to confirm.
      </div>
    </div>
  </section>

  <!-- Footer -->
  <footer>
    <span>Generated by SQLSentinel &middot; ${esc(timestamp)} &middot; Internal Use Only</span>
    <span>Not persisted &middot; Re-run audit to confirm remediation</span>
  </footer>

</div>
</body>
</html>`;
}

function exportToPdf(scope: RemediationScope, targetLabel: string) {
  const html = buildPdfHtml(scope, targetLabel);
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
  // Small delay lets fonts load before the print dialog fires
  setTimeout(() => win.print(), 800);
}

// ─── Task row ────────────────────────────────────────────────────────────────

function TaskRow({ task }: { task: RemediationTask }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-card",
        "border-l-4",
        RISK_BORDER[task.riskLevel],
      )}
      style={{ borderLeftColor: RISK_BORDER_COLOR[task.riskLevel] }}
    >
      <button
        className="flex w-full items-start gap-3 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="mt-0.5 shrink-0 text-muted">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">{task.taskId}</span>
            <Badge label={task.riskLevel.replace(/_/g, " ")} tone={RISK_BADGE_TONE[task.riskLevel]} />
            {task.blocking && <Badge label="BLOCKING" tone="danger" />}
          </div>
          <p className="text-sm font-medium text-foreground">
            {task.relatedCheck.replace(/_/g, " ")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3 pt-0.5 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {task.estimatedEffortHours}h
          </span>
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            +{task.scoreImprovementIfResolved} pts
          </span>
        </div>
      </button>

      {open && (
        <div className="space-y-5 border-t border-border px-4 py-4 text-sm">
          {/* Why it matters */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-warning">
              <AlertTriangle className="h-4 w-4" />
              Why it matters
            </p>
            <p className="text-muted">{task.whyItMatters}</p>
          </div>

          {/* Remediation steps */}
          <div>
            <p className="mb-2 font-semibold text-foreground">Remediation steps</p>
            <ol className="space-y-2">
              {task.remediationSteps.map((step, i) => (
                <li key={i} className="flex gap-2 text-muted">
                  <span className="shrink-0 font-mono text-xs font-semibold text-foreground">
                    {String(i + 1).padStart(2, "0")}.
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          </div>

          {/* Verification */}
          <div>
            <p className="mb-2 font-semibold text-foreground">Verification</p>
            <ul className="space-y-2">
              {task.verificationSteps.map((step, i) => (
                <li key={i} className="flex gap-2 text-muted">
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                  <span>{step}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Modal ───────────────────────────────────────────────────────────────────

export function SecurityRemediationModal({ scope, onClose, targetLabel = "SQL Server" }: SecurityRemediationModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Focus the close button when modal opens
  useEffect(() => {
    closeButtonRef.current?.focus();
  }, []);

  // Prevent body scroll while open
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  function handleBackdropClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleExport() {
    const timestamp = new Date().toISOString().slice(0, 10);
    downloadText(buildTextExport(scope, targetLabel), `sql-remediation-sow-${timestamp}.txt`);
  }

  function handleExportPdf() {
    exportToPdf(scope, targetLabel);
  }

  const totalHours = scope.effortEstimateHours.dba + scope.effortEstimateHours.securityEngineer;
  const blockingCount = scope.workstreams
    .flatMap((ws) => ws.tasks)
    .filter((t) => t.blocking).length;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={handleBackdropClick}
      role="presentation"
    >
      {/* Panel */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remediation-modal-title"
        className="flex h-[95dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:h-[90vh] sm:max-w-3xl sm:rounded-2xl"
      >
        {/* ── Header ── */}
        <div className="flex shrink-0 items-start justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg border border-primary/20 bg-primary/10 p-2 text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2
                id="remediation-modal-title"
                className="text-base font-semibold text-foreground"
              >
                Remediation Scope of Work
              </h2>
              <p className="text-xs text-muted">
                {blockingCount} blocking task{blockingCount !== 1 ? "s" : ""} · {totalHours}h total
                estimated effort
              </p>
            </div>
          </div>
          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Close remediation modal"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Score summary strip ── */}
        <div className="grid shrink-0 grid-cols-4 divide-x divide-border border-b border-border text-center">
          <div className="px-3 py-3">
            <p className="text-xs text-muted">Current</p>
            <p className={cn("text-xl font-bold", gradeColor(scope.currentGrade))}>
              {scope.currentScore}
            </p>
            <p className={cn("text-xs font-semibold", gradeColor(scope.currentGrade))}>
              Grade {scope.currentGrade}
            </p>
          </div>
          <div className="px-3 py-3">
            <p className="text-xs text-muted">Target</p>
            <p className="text-xl font-bold text-primary">{scope.targetScore}</p>
            <p className="text-xs font-semibold text-primary">Grade {scope.targetGrade}</p>
          </div>
          <div className="px-3 py-3">
            <p className="text-xs text-muted">DBA hrs</p>
            <p className="text-xl font-bold text-foreground">{scope.effortEstimateHours.dba}</p>
            <p className="text-xs text-muted">estimated</p>
          </div>
          <div className="px-3 py-3">
            <p className="text-xs text-muted">SecEng hrs</p>
            <p className="text-xl font-bold text-foreground">
              {scope.effortEstimateHours.securityEngineer}
            </p>
            <p className="text-xs text-muted">estimated</p>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div className="flex-1 overflow-y-auto">
          <div className="space-y-8 px-5 py-6">

            <section>
              <h3 className="mb-3 font-semibold text-foreground">Scope Coverage</h3>
              <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-2 text-sm text-muted">
                <p><strong className="text-foreground">Target:</strong> {targetLabel}</p>
                <p><strong className="text-foreground">Server(s):</strong> {scope.affectedServers.join(", ") || "(unknown)"}</p>
                <p><strong className="text-foreground">Database(s) requiring remediation:</strong> {scope.affectedDatabases.length ? scope.affectedDatabases.join(", ") : "None identified"}</p>
              </div>
            </section>

            {/* Workstreams */}
            {scope.workstreams.map((ws) => (
              <section key={ws.role}>
                <div className="mb-3 flex items-center gap-2">
                  <User2 className="h-4 w-4 text-muted" />
                  <h3 className="font-semibold text-foreground">{ws.role}</h3>
                  <span className="hidden text-sm text-muted sm:inline">— {ws.objective}</span>
                </div>
                <p className="mb-4 text-sm text-muted sm:hidden">{ws.objective}</p>
                <div className="space-y-3">
                  {ws.tasks.map((task) => (
                    <TaskRow key={task.taskId} task={task} />
                  ))}
                </div>
              </section>
            ))}

            {/* Acceptance criteria */}
            <section>
              <h3 className="mb-3 font-semibold text-foreground">Acceptance Criteria</h3>
              <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-2">
                {scope.acceptanceCriteria.requiredConditions.map((condition, i) => (
                  <div key={i} className="flex gap-2 text-sm text-muted">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span>{condition}</span>
                  </div>
                ))}
                <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-sm">
                  <ShieldCheck className="h-4 w-4 shrink-0 text-success" />
                  <span>
                    Expected score after remediation:{" "}
                    <strong>{scope.acceptanceCriteria.expectedScoreAfterRemediation}</strong> — re-audit
                    required to confirm.
                  </span>
                </div>
              </div>
            </section>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex shrink-0 items-center justify-between border-t border-border px-5 py-3">
          <p className="text-xs text-muted">
            Generated from latest audit run · not persisted
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleExport}>
              <Download className="mr-1.5 h-3.5 w-3.5" />
              Export .txt
            </Button>
            <Button variant="secondary" size="sm" onClick={handleExportPdf}>
              <FileDown className="mr-1.5 h-3.5 w-3.5" />
              Export PDF
            </Button>
            <Button variant="default" size="sm" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
