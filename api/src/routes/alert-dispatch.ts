import { Router } from "express";
import axios from "axios";
import nodemailer from "nodemailer";
import { query } from "../db/sql.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { env } from "../config/env.js";

const alertDispatchRouter = Router();

alertDispatchRouter.use(requireAuth);

alertDispatchRouter.get("/dispatch-config", async (_req, res, next) => {
  try {
    const configs = await query<{ ConfigId: string; Channel: string; IsEnabled: boolean; ConfigData: string }>(
      `SELECT ConfigId, Channel, IsEnabled, ConfigData FROM dbo.AlertDispatchConfig ORDER BY Channel`
    );

    const data = configs.map((config) => ({
      ...config,
      ConfigData: safeParseJson(config.ConfigData)
    }));

    res.json({ data });
  } catch (error) {
    next(error);
  }
});

alertDispatchRouter.patch("/dispatch-config/:channel", requireRole(["admin"]), async (req, res, next) => {
  try {
    const channel = String(req.params.channel || "").toLowerCase();
    if (!["email", "slack", "webhook", "pagerduty"].includes(channel)) {
      res.status(400).json({ message: "Invalid channel" });
      return;
    }

    const isEnabled = Boolean(req.body?.isEnabled);
    const configData = req.body?.configData ?? {};

    await query(
      `UPDATE dbo.AlertDispatchConfig
       SET IsEnabled = @isEnabled,
           ConfigData = @configData,
           UpdatedDate = GETUTCDATE()
       WHERE Channel = @channel`,
      {
        channel,
        isEnabled,
        configData: JSON.stringify(configData)
      }
    );

    await query(
      `INSERT INTO dbo.AuditLog (UserId, Action, TableName, RecordId, NewValue, IpAddress)
       VALUES (@userId, 'CONFIG_CHANGE', 'AlertDispatchConfig', @channel, @newValue, @ipAddress)`,
      {
        userId: req.user?.sub ?? "unknown",
        channel,
        newValue: JSON.stringify({ isEnabled, configData }),
        ipAddress: req.ip
      }
    );

    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
});

alertDispatchRouter.post("/dispatch-config/test/:channel", requireRole(["admin"]), async (req, res, next) => {
  try {
    const channel = String(req.params.channel || "").toLowerCase();

    const [config] = await query<{ ConfigData: string }>(
      `SELECT ConfigData FROM dbo.AlertDispatchConfig WHERE Channel = @channel`,
      { channel }
    );

    if (!config) {
      res.status(404).json({ message: "Channel not configured" });
      return;
    }

    const configData = safeParseJson(config.ConfigData);

    if (channel === "slack") {
      await sendSlackMessage(configData, {
        title: "SQLSentinnel Test Alert",
        text: "Dispatch test succeeded.",
        severity: "info"
      });
      res.json({ data: { ok: true } });
      return;
    }

    if (channel === "email") {
      await sendEmailMessage(configData, {
        title: "SQLSentinnel Test Alert",
        text: "Email dispatch test succeeded.",
        severity: "info"
      });
      res.json({ data: { ok: true } });
      return;
    }

    res.status(400).json({ message: "Unknown channel" });
  } catch (error) {
    next(error);
  }
});

alertDispatchRouter.post("/acknowledge/:alertId", async (req, res, next) => {
  try {
    const alertId = req.params.alertId;

    await query(
      `UPDATE dbo.Alerts
       SET Status = 'acknowledged',
           AcknowledgedBy = @userName,
           AcknowledgedAt = GETUTCDATE()
       WHERE AlertId = @alertId`,
      {
        alertId,
        userName: req.user?.name ?? req.user?.sub ?? "system"
      }
    );

    await query(
      `INSERT INTO dbo.AuditLog (UserId, Action, RecordId, IpAddress)
       VALUES (@userId, 'ACKNOWLEDGE_ALERT', @recordId, @ipAddress)`,
      {
        userId: req.user?.sub ?? "unknown",
        recordId: alertId,
        ipAddress: req.ip
      }
    );

    res.json({ data: { ok: true } });
  } catch (error) {
    next(error);
  }
});

export async function dispatchAlert(alertId: string): Promise<{ sent: number; failed: number }> {
  const [alert] = await query<{
    AlertId: string;
    AlertType: string;
    Severity: string;
    Title: string;
    Message: string | null;
  }>(
    `SELECT AlertId, AlertType, Severity, Title, Message
     FROM dbo.Alerts
     WHERE AlertId = @alertId`,
    { alertId }
  );

  if (!alert) return { sent: 0, failed: 0 };

  const configs = await query<{ Channel: string; ConfigData: string }>(
    `SELECT Channel, ConfigData FROM dbo.AlertDispatchConfig WHERE IsEnabled = 1`
  );

  let sent = 0;
  let failed = 0;

  for (const cfg of configs) {
    const config = safeParseJson(cfg.ConfigData);
    try {
      if (cfg.Channel.toLowerCase() === "slack") {
        await sendSlackMessage(config, {
          title: alert.Title,
          text: alert.Message ?? "No message",
          severity: alert.Severity
        });
        await recordNotification(alert.AlertId, "slack", String(config.channel ?? "#sql-monitoring"), "sent", null);
        sent += 1;
      }

      if (cfg.Channel.toLowerCase() === "email") {
        await sendEmailMessage(config, {
          title: alert.Title,
          text: alert.Message ?? "No message",
          severity: alert.Severity
        });
        await recordNotification(alert.AlertId, "email", String(config.toAddresses ?? "mailing-list"), "sent", null);
        sent += 1;
      }
    } catch (error) {
      failed += 1;
      await recordNotification(
        alert.AlertId,
        cfg.Channel,
        "unknown",
        "failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  return { sent, failed };
}

function safeParseJson(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function sendSlackMessage(
  config: Record<string, unknown>,
  payload: { title: string; text: string; severity: string }
): Promise<void> {
  const webhookUrl = String(config.webhookUrl ?? "");
  if (!webhookUrl) {
    throw new Error("Slack webhook URL not configured");
  }

  const severityColor: Record<string, string> = {
    critical: "#dc2626",
    warning: "#d97706",
    info: "#0b63ce"
  };

  await axios.post(webhookUrl, {
    attachments: [
      {
        color: severityColor[payload.severity.toLowerCase()] ?? "#64748b",
        title: payload.title,
        text: payload.text,
        ts: Math.floor(Date.now() / 1000)
      }
    ]
  });
}

async function sendEmailMessage(
  config: Record<string, unknown>,
  payload: { title: string; text: string; severity: string }
): Promise<void> {
  const smtpHost = String(config.smtpHost ?? config.smtpServer ?? env.SMTP_HOST);
  const smtpPort = Number(config.smtpPort ?? env.SMTP_PORT);
  const smtpSecure = Boolean(config.smtpSecure ?? env.SMTP_SECURE);
  const smtpUser = String(config.smtpUser ?? env.SMTP_USER);
  const smtpPass = String(config.smtpPass ?? env.SMTP_PASS);
  const smtpFrom = String(config.fromAddress ?? env.SMTP_FROM);

  const rawRecipients = config.toAddresses;
  const toAddresses = Array.isArray(rawRecipients)
    ? rawRecipients.map((x) => String(x)).filter((x) => x.length > 0)
    : String(rawRecipients ?? "")
        .split(",")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);

  if (!smtpHost || toAddresses.length === 0) {
    throw new Error("Email dispatch is not configured (smtpHost/toAddresses)");
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: smtpUser && smtpPass ? { user: smtpUser, pass: smtpPass } : undefined
  });

  await transporter.sendMail({
    from: smtpFrom,
    to: toAddresses.join(","),
    subject: `[SQLSentinnel][${payload.severity.toUpperCase()}] ${payload.title}`,
    text: payload.text,
    html: `<p>${payload.text}</p>`
  });
}

async function recordNotification(
  alertId: string,
  channel: string,
  target: string,
  status: string,
  errorMessage: string | null
) {
  await query(
    `INSERT INTO dbo.Notifications (AlertId, Channel, Target, Status, ErrorMessage, LastAttemptAt, SentAt)
     VALUES (@alertId, @channel, @target, @status, @errorMessage, GETUTCDATE(),
       CASE WHEN @status = 'sent' THEN GETUTCDATE() ELSE NULL END)`,
    {
      alertId,
      channel,
      target,
      status,
      errorMessage
    }
  );
}

export default alertDispatchRouter;
