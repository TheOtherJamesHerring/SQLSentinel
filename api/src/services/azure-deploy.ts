import { spawn } from "node:child_process";

export type DeployMode = "azure-container-instance" | "azure-app-service";

export interface AzureDeployInput {
  mode: DeployMode;
  collectorImage: string;
  monitorApiUrl: string;
  monitorApiKey: string;
  serverId: string;
  serverName: string;
  subscriptionId: string;
  resourceGroup: string;
  location: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sql: {
    hostname: string;
    port: number;
    authType: string;
    username: string;
    password: string;
    database: string;
    encrypt: boolean;
    trustServerCert: boolean;
  };
  appName?: string;
  appServicePlan?: string;
}

export interface AzureDeployResult {
  resourceName: string;
  commandPreview: string;
  summary: string;
}

export interface AzureCliReadiness {
  available: boolean;
  executable: string | null;
  message: string;
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

let resolvedAzExecutable: string | null = null;

function spawnAzProcess(executable: string, args: string[], stdio: ["ignore", "ignore" | "pipe", "ignore" | "pipe"]) {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec || "cmd.exe";
    const commandLine = [executable, ...args]
      .map((part) => (/[\s"^&|<>]/.test(part) ? `"${part.replace(/"/g, '""')}"` : part))
      .join(" ");

    return spawn(comspec, ["/d", "/s", "/c", commandLine], {
      shell: false,
      windowsHide: true,
      stdio
    });
  }

  return spawn(executable, args, {
    shell: false,
    windowsHide: true,
    stdio
  });
}

function normalizeExecutableCandidate(value: string) {
  const trimmed = value.trim();
  // Allow quoted paths from .env values, e.g. "C:\\Program Files\\...\\az.cmd".
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function tryRunAzVersion(executable: string) {
  return new Promise<boolean>((resolve) => {
    let child;
    try {
      child = spawnAzProcess(executable, ["--version"], ["ignore", "ignore", "ignore"]);
    } catch {
      resolve(false);
      return;
    }

    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}

async function resolveAzExecutable() {
  if (resolvedAzExecutable) return resolvedAzExecutable;

  const configured = process.env.AZURE_CLI_PATH?.trim();
  const platformDefaults = process.platform === "win32"
    ? ["az.cmd", "az.exe", "az"]
    : ["az"];
  const candidates = configured
    ? [normalizeExecutableCandidate(configured), ...platformDefaults]
    : platformDefaults;
  const uniqueCandidates = Array.from(new Set(candidates.filter(Boolean)));

  for (const candidate of uniqueCandidates) {
    // Probe CLI presence once and cache the first working command.
    if (await tryRunAzVersion(candidate)) {
      resolvedAzExecutable = candidate;
      return candidate;
    }
  }

  throw new Error(
    "Azure one-click setup is not available on this server because Azure CLI is not installed or not reachable by the API process. Install Azure CLI on the API host and restart the service."
  );
}

export async function getAzureCliReadiness(): Promise<AzureCliReadiness> {
  try {
    const executable = await resolveAzExecutable();
    return {
      available: true,
      executable,
      message: `Automatic Azure setup is available (${executable}).`
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Azure CLI is not available for this API process.";
    return {
      available: false,
      executable: null,
      message
    };
  }
}

function sanitizeToken(value: string) {
  return value.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 18).toLowerCase();
}

function compact(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function maskSecrets(text: string, secrets: string[]) {
  let result = text;
  for (const secret of secrets) {
    if (!secret) continue;
    result = result.split(secret).join("***");
  }
  return result;
}

async function runAz(args: string[], sensitiveValues: string[]) {
  const azExecutable = await resolveAzExecutable();
  return new Promise<RunResult>((resolve, reject) => {
    let child;
    try {
      child = spawnAzProcess(azExecutable, args, ["ignore", "pipe", "pipe"]);
    } catch (error) {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "EINVAL") {
        reject(new Error("Azure one-click setup is not available because the Azure CLI command is invalid for this host process. Check AZURE_CLI_PATH on the API host (remove surrounding quotes if present) or clear it to use the default 'az' command."));
        return;
      }
      reject(new Error(`Azure CLI execution failed: ${(error as Error).message}`));
      return;
    }

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on("error", (error) => {
      const errorCode = (error as NodeJS.ErrnoException).code;
      if (errorCode === "ENOENT") {
        reject(new Error("Azure one-click setup is not available on this server because Azure CLI is not installed. Ask your administrator to install Azure CLI on the SQLSentinnel API host, or use a guided setup mode instead."));
        return;
      }
      if (errorCode === "EINVAL") {
        reject(new Error("Azure one-click setup is not available because the Azure CLI command is invalid for this host process. Check AZURE_CLI_PATH on the API host (remove surrounding quotes if present) or clear it to use the default 'az' command."));
        return;
      }
      reject(new Error(`Azure CLI execution failed: ${error.message}`));
    });

    child.on("close", (code) => {
      const maskedOut = maskSecrets(stdout, sensitiveValues);
      const maskedErr = maskSecrets(stderr, sensitiveValues);
      if (code !== 0) {
        reject(new Error(compact(maskedErr || maskedOut || `az command failed with code ${code}`)));
        return;
      }
      resolve({ code: code ?? 0, stdout: maskedOut, stderr: maskedErr });
    });
  });
}

export async function executeAzureDeploy(input: AzureDeployInput): Promise<AzureDeployResult> {
  const token = sanitizeToken(input.serverId);
  const resourceName = input.mode === "azure-container-instance"
    ? `sqlsentinnel-collector-${token}`
    : (input.appName?.trim() || `sqlsentinnel-collector-${token}`);

  const sensitiveValues = [input.clientSecret, input.sql.password, input.monitorApiKey];

  await runAz([
    "login",
    "--service-principal",
    "--username", input.clientId,
    "--password", input.clientSecret,
    "--tenant", input.tenantId,
    "--output", "none"
  ], sensitiveValues);

  await runAz([
    "account",
    "set",
    "--subscription", input.subscriptionId
  ], sensitiveValues);

  if (input.mode === "azure-container-instance") {
    await runAz([
      "container",
      "create",
      "--resource-group", input.resourceGroup,
      "--name", resourceName,
      "--image", input.collectorImage,
      "--restart-policy", "Always",
      "--location", input.location,
      "--cpu", "1",
      "--memory", "1.5",
      "--environment-variables",
      `MONITOR_API_URL=${input.monitorApiUrl}`,
      `SERVER_ID=${input.serverId}`,
      `SQL_SERVER_HOST=${input.sql.hostname}`,
      `SQL_SERVER_PORT=${input.sql.port}`,
      `SQL_AUTH_TYPE=${input.sql.authType}`,
      `SQL_USERNAME=${input.sql.username}`,
      `SQL_DATABASE=${input.sql.database}`,
      `SQL_ENCRYPT=${input.sql.encrypt}`,
      `SQL_TRUST_SERVER_CERT=${input.sql.trustServerCert}`,
      "--secure-environment-variables",
      `MONITOR_API_KEY=${input.monitorApiKey}`,
      `SQL_PASSWORD=${input.sql.password}`,
      "--output", "none"
    ], sensitiveValues);

    return {
      resourceName,
      commandPreview: [
        "az login --service-principal -u <client-id> -p *** --tenant <tenant-id>",
        "az account set --subscription <subscription-id>",
        `az container create --resource-group ${input.resourceGroup} --name ${resourceName} --image ${input.collectorImage} ...`
      ].join("\n"),
      summary: `Azure Container Instance '${resourceName}' deployed in ${input.resourceGroup}.`
    };
  }

  const appServicePlan = input.appServicePlan?.trim() || "sqlsentinnel-collector-plan";

  await runAz([
    "appservice",
    "plan",
    "create",
    "--name", appServicePlan,
    "--resource-group", input.resourceGroup,
    "--location", input.location,
    "--is-linux",
    "--sku", "B1",
    "--output", "none"
  ], sensitiveValues);

  await runAz([
    "webapp",
    "create",
    "--resource-group", input.resourceGroup,
    "--plan", appServicePlan,
    "--name", resourceName,
    "--deployment-container-image-name", input.collectorImage,
    "--output", "none"
  ], sensitiveValues);

  await runAz([
    "webapp",
    "config",
    "appsettings",
    "set",
    "--name", resourceName,
    "--resource-group", input.resourceGroup,
    "--settings",
    `MONITOR_API_URL=${input.monitorApiUrl}`,
    `MONITOR_API_KEY=${input.monitorApiKey}`,
    `SERVER_ID=${input.serverId}`,
    `SQL_SERVER_HOST=${input.sql.hostname}`,
    `SQL_SERVER_PORT=${input.sql.port}`,
    `SQL_AUTH_TYPE=${input.sql.authType}`,
    `SQL_USERNAME=${input.sql.username}`,
    `SQL_PASSWORD=${input.sql.password}`,
    `SQL_DATABASE=${input.sql.database}`,
    `SQL_ENCRYPT=${input.sql.encrypt}`,
    `SQL_TRUST_SERVER_CERT=${input.sql.trustServerCert}`,
    "--output", "none"
  ], sensitiveValues);

  return {
    resourceName,
    commandPreview: [
      "az login --service-principal -u <client-id> -p *** --tenant <tenant-id>",
      "az account set --subscription <subscription-id>",
      `az appservice plan create --name ${appServicePlan} --resource-group ${input.resourceGroup} --is-linux --sku B1`,
      `az webapp create --resource-group ${input.resourceGroup} --plan ${appServicePlan} --name ${resourceName} --deployment-container-image-name ${input.collectorImage}`,
      `az webapp config appsettings set --name ${resourceName} --resource-group ${input.resourceGroup} --settings ...`
    ].join("\n"),
    summary: `Azure App Service '${resourceName}' deployed in ${input.resourceGroup}.`
  };
}
