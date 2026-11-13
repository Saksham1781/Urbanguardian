# Urban Guardians — start all services
# Usage: Right-click -> "Run with PowerShell"  OR  .\start.ps1 in PS terminal

$envFile = "$PSScriptRoot\.env"
if (!(Test-Path $envFile)) { Write-Error ".env not found at $envFile"; exit 1 }

# Load .env into current shell
Get-Content $envFile | Where-Object { $_ -match "^\s*[^#]" -and $_ -match "=" } | ForEach-Object {
    $kv = $_ -split "=", 2
    [System.Environment]::SetEnvironmentVariable($kv[0].Trim(), $kv[1].Trim(), "Process")
}

$nodePort   = if ($env:NODE_PORT)   { $env:NODE_PORT }   else { "5001" }
$pythonPort = if ($env:PYTHON_PORT) { $env:PYTHON_PORT } else { "8003" }

Write-Host ""
Write-Host "=== Urban Guardians Startup ===" -ForegroundColor Cyan
Write-Host "  AI Service  -> http://localhost:$pythonPort" -ForegroundColor Green
Write-Host "  Backend     -> http://localhost:$nodePort"   -ForegroundColor Green
Write-Host "  Frontend    -> http://localhost:3000"        -ForegroundColor Green
Write-Host ""

# ── Kill anything on the three ports ────────────────────────────────────────
foreach ($port in @($nodePort, $pythonPort, "3000")) {
    $procs = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        try { Stop-Process -Id $proc.OwningProcess -Force -ErrorAction SilentlyContinue } catch {}
    }
}
Write-Host "Cleared ports $nodePort, $pythonPort, 3000" -ForegroundColor Yellow
Start-Sleep -Seconds 1

# ── Start AI service ─────────────────────────────────────────────────────────
$aiDir = "$PSScriptRoot\services\ai-service"
Write-Host "Starting AI service on port $pythonPort ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$aiDir'; python -m uvicorn app.main:app --host 0.0.0.0 --port $pythonPort --reload"

Start-Sleep -Seconds 3

# ── Start Node backend ───────────────────────────────────────────────────────
$backendDir = "$PSScriptRoot\services\backend"
Write-Host "Starting Node backend on port $nodePort ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$backendDir'; node src/server.js"

Start-Sleep -Seconds 2

# ── Start Next.js frontend ───────────────────────────────────────────────────
$webDir = "$PSScriptRoot\apps\web"
Write-Host "Starting Next.js frontend ..." -ForegroundColor Cyan
Start-Process powershell -ArgumentList "-NoExit", "-Command",
    "cd '$webDir'; npm run dev"

Write-Host ""
Write-Host "All services launching in separate windows." -ForegroundColor Green
Write-Host "Open http://localhost:3000 once 'ready' appears in the Next.js window." -ForegroundColor White
