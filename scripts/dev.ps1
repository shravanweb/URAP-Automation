# Starts the API, the worker, and the Vite dev server in separate PowerShell windows.
# Start MariaDB first with scripts\start-database.ps1 and run "npm run setup" in backend once.
# Pass -Robot to also start the URAP robot agent (needs ROBOT_TOKEN in .env).
param([switch]$Robot)
$project = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $project "backend"
$frontend = Join-Path $project "frontend"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backend'; npm start"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backend'; npm run worker"
if ($Robot) {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$backend'; npm run robot"
}
Start-Process powershell -ArgumentList "-NoExit", "-Command", "Set-Location '$frontend'; npm run dev"
Write-Host "API http://localhost:4000  UI http://localhost:5173"
