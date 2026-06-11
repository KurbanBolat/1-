param(
  [switch]$StopOnly,
  [switch]$CleanNext
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$tmpDir = Join-Path $root ".tmp"
$lockFile = Join-Path $tmpDir "dev.lock.json"
$frontendDir = Join-Path $root "frontend"
$backendDir = Join-Path $root "backend"

if (!(Test-Path $tmpDir)) {
  New-Item -ItemType Directory -Path $tmpDir | Out-Null
}

function Get-PortPids([int]$Port) {
  $pids = @()
  $lines = netstat -ano | findstr ":$Port"
  foreach ($ln in $lines) {
    $parts = ($ln -split "\s+" | Where-Object { $_ })
    if ($parts.Length -ge 5) {
      $pidValue = 0
      if ([int]::TryParse($parts[-1], [ref]$pidValue)) {
        $pids += $pidValue
      }
    }
  }
  return ($pids | Select-Object -Unique)
}

function Stop-IfRunning([int]$TargetPid) {
  try {
    $proc = Get-Process -Id $TargetPid -ErrorAction Stop
    Stop-Process -Id $proc.Id -Force -ErrorAction Stop
    Write-Host "Stopped PID $TargetPid"
  } catch {
  }
}

function Stop-FromLock {
  if (!(Test-Path $lockFile)) {
    return
  }
  try {
    $lock = Get-Content $lockFile -Raw | ConvertFrom-Json
    if ($lock.backend_pid) { Stop-IfRunning -TargetPid $lock.backend_pid }
    if ($lock.frontend_pid) { Stop-IfRunning -TargetPid $lock.frontend_pid }
  } catch {
  }
  Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
}

function Wait-Health([string]$Url, [string]$Name, [int]$MaxAttempts = 60) {
  for ($i = 1; $i -le $MaxAttempts; $i++) {
    try {
      $status = & curl.exe -s -o NUL -w "%{http_code}" --max-time 4 $Url
      $status = [int]$status
      if ($status -ge 200 -and $status -lt 500) {
        Write-Host "$Name ready: $status"
        return $true
      }
    } catch {
    }
    Start-Sleep -Milliseconds 800
  }
  Write-Host "$Name not healthy: $Url"
  return $false
}

Stop-FromLock
Get-PortPids 3000 | ForEach-Object { Stop-IfRunning -TargetPid $_ }
Get-PortPids 8000 | ForEach-Object { Stop-IfRunning -TargetPid $_ }

if ($StopOnly) {
  Write-Host "Stopped running dev processes."
  exit 0
}

$shouldCleanNext = $CleanNext.IsPresent -or $true
if ($shouldCleanNext) {
  $nextDir = Join-Path $frontendDir ".next"
  if (Test-Path $nextDir) {
    Remove-Item $nextDir -Recurse -Force -ErrorAction SilentlyContinue
  }
}

if (!$env:API_RATE_LIMIT_PER_MINUTE) {
  $env:API_RATE_LIMIT_PER_MINUTE = "1000"
}

$backendProc = Start-Process `
  -FilePath "python" `
  -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000" `
  -WorkingDirectory $backendDir `
  -WindowStyle Hidden `
  -PassThru

Start-Sleep -Seconds 1

$frontendProc = Start-Process `
  -FilePath "node" `
  -ArgumentList ".\node_modules\next\dist\bin\next", "dev", "-p", "3000" `
  -WorkingDirectory $frontendDir `
  -WindowStyle Hidden `
  -PassThru

$lockPayload = @{
  backend_pid = $backendProc.Id
  frontend_pid = $frontendProc.Id
  created_at = (Get-Date).ToString("o")
} | ConvertTo-Json
$lockPayload | Set-Content $lockFile -Encoding UTF8

$backendOk = Wait-Health -Url "http://127.0.0.1:8000/health" -Name "Backend"
$frontendOk = Wait-Health -Url "http://localhost:3000/?lang=en&currency=USD" -Name "Frontend"

Write-Host "backend_pid=$($backendProc.Id)"
Write-Host "frontend_pid=$($frontendProc.Id)"

if (!($backendOk -and $frontendOk)) {
  Write-Host "One or more services failed health checks. Use scripts/dev.ps1 -StopOnly to clean up."
  exit 1
}

Write-Host "Dev stack is ready: http://localhost:3000"
