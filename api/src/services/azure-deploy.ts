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

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
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

function runAz(args: string[], sensitiveValues: string[]) {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawn("az", args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
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
