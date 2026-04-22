param(
    [Parameter(Mandatory = $true)]
    [string]$ApiBaseUrl,

    [Parameter(Mandatory = $true)]
    [string]$AdminUsername,

    [Parameter(Mandatory = $true)]
    [string]$AdminPassword,

    [Parameter(Mandatory = $true)]
    [string]$ServerName,

    [Parameter(Mandatory = $true)]
    [string]$Hostname,

    [string]$InstanceName = "",
    [int]$Port = 1433,
    [ValidateSet("production", "staging", "development", "dr")]
    [string]$Environment = "production",

    [Parameter(Mandatory = $true)]
    [string]$MonitorApiKey,

    [string]$MonitorApiUrl = "",
    [string]$SqlServerHost = "",
    [int]$SqlServerPort = 1433,
    [ValidateSet("sql", "windows", "entra_sp")]
    [string]$SqlAuthType = "sql",
    [string]$SqlUsername = "sqlmonitor_svc",
    [string]$SqlPassword = "",
    [string]$SqlEntraTenantId = "",
    [string]$SqlEntraClientId = "",
    [string]$SqlEntraClientSecret = "",

    [string]$SqlDatabase = "master",
    [bool]$SqlEncrypt = $true,
    [bool]$SqlTrustServerCert = $true,
    [int]$CollectionIntervalSeconds = 60,
    [string]$CollectorEnvPath = "..\collector\.env"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($MonitorApiUrl)) {
    $MonitorApiUrl = $ApiBaseUrl
}

if ([string]::IsNullOrWhiteSpace($SqlServerHost)) {
    $SqlServerHost = $Hostname
}

if ($SqlAuthType -eq "sql" -and [string]::IsNullOrWhiteSpace($SqlPassword)) {
    throw "SqlPassword is required when -SqlAuthType sql"
}

if ($SqlAuthType -eq "entra_sp") {
    if ([string]::IsNullOrWhiteSpace($SqlEntraTenantId) -or
        [string]::IsNullOrWhiteSpace($SqlEntraClientId) -or
        [string]::IsNullOrWhiteSpace($SqlEntraClientSecret)) {
        throw "SqlEntraTenantId, SqlEntraClientId, and SqlEntraClientSecret are required when -SqlAuthType entra_sp"
    }
}

$apiRoot = $ApiBaseUrl.TrimEnd("/")
$collectorApiRoot = $MonitorApiUrl.TrimEnd("/")

Write-Host "Logging in to API as admin..."
$loginBody = @{
    username = $AdminUsername
    password = $AdminPassword
} | ConvertTo-Json

$login = Invoke-RestMethod -Method Post -Uri "$apiRoot/api/auth/login" -ContentType "application/json" -Body $loginBody
if (-not $login.token) {
    throw "Login failed: token not returned."
}

$headers = @{ Authorization = "Bearer $($login.token)" }

Write-Host "Checking if server already exists in SQLSentinnel..."
$serversResponse = Invoke-RestMethod -Method Get -Uri "$apiRoot/api/servers" -Headers $headers
$servers = @()
if ($serversResponse -and $serversResponse.data) {
    $servers = $serversResponse.data
}

$existing = $servers | Where-Object { $_.Hostname -eq $Hostname -or $_.Name -eq $ServerName } | Select-Object -First 1

if ($null -eq $existing) {
    Write-Host "Registering server in API..."
    $createBody = @{
        name = $ServerName
        hostname = $Hostname
        instanceName = $InstanceName
        port = $Port
        environment = $Environment
    } | ConvertTo-Json

    $created = Invoke-RestMethod -Method Post -Uri "$apiRoot/api/servers" -Headers $headers -ContentType "application/json" -Body $createBody
    if (-not $created.data -or -not $created.data.ServerId) {
        throw "Server create did not return a ServerId."
    }
    $serverId = $created.data.ServerId
    Write-Host "Created ServerId: $serverId"
}
else {
    $serverId = $existing.ServerId
    Write-Host "Using existing ServerId: $serverId"
}

$envContent = @"
MONITOR_API_URL=$collectorApiRoot
MONITOR_API_KEY=$MonitorApiKey
SERVER_ID=$serverId
SQL_SERVER_HOST=$SqlServerHost
SQL_SERVER_PORT=$SqlServerPort
SQL_AUTH_TYPE=$SqlAuthType
SQL_USERNAME=$SqlUsername
SQL_PASSWORD=$SqlPassword
SQL_ENTRA_TENANT_ID=$SqlEntraTenantId
SQL_ENTRA_CLIENT_ID=$SqlEntraClientId
SQL_ENTRA_CLIENT_SECRET=$SqlEntraClientSecret
SQL_DATABASE=$SqlDatabase
SQL_ENCRYPT=$SqlEncrypt
SQL_TRUST_SERVER_CERT=$SqlTrustServerCert
COLLECTION_INTERVAL_SECONDS=$CollectionIntervalSeconds
"@

$resolvedEnvPath = Resolve-Path (Join-Path $PSScriptRoot $CollectorEnvPath) -ErrorAction SilentlyContinue
if ($null -eq $resolvedEnvPath) {
    $targetPath = Join-Path $PSScriptRoot $CollectorEnvPath
}
else {
    $targetPath = $resolvedEnvPath.Path
}

Write-Host "Writing collector env file to: $targetPath"
Set-Content -Path $targetPath -Value $envContent -Encoding ascii

Write-Host "Done. Next steps:"
Write-Host "1) Ensure api/.env MONITOR_API_KEY matches collector MONITOR_API_KEY"
Write-Host "2) Start API, then start collector"
Write-Host "3) Open dashboard and confirm server status and incoming metrics"
