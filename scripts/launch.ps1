# Meus Perfumes — abre o app no navegador, iniciando o servidor se ele não estiver rodando.
#
# O servidor sobe como processo PRÓPRIO do Windows (criado pelo WMI): não é filho deste terminal, do Claude ou de
# qualquer outro programa — fechar qualquer um deles não derruba o app. Saída em data\logs\server.log.
#
#   -NoBrowser   só garante o servidor (usado na inicialização com o Windows)
#   -Stop        encerra o servidor

param([switch]$NoBrowser, [switch]$Stop)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$port = if ($env:PERFUMES_PORT) { $env:PERFUMES_PORT } else { 3100 }
$url = "http://localhost:$port"

function Test-App {
  try {
    $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/status" -TimeoutSec 4
    return $r.app -eq 'perfume-collection'
  } catch { return $false }
}

function Get-AppProcess {
  $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($conn) { Get-CimInstance Win32_Process -Filter "ProcessId=$($conn.OwningProcess)" }
}

if ($Stop) {
  $p = Get-AppProcess
  if ($p -and $p.CommandLine -match 'server[\\/]main\.ts') {
    Stop-Process -Id $p.ProcessId -Force
    Write-Host 'Meus Perfumes encerrado.'
  } else {
    Write-Host 'Nada para encerrar.'
  }
  exit 0
}

if (-not (Test-App)) {
  $node = (Get-Command node -ErrorAction SilentlyContinue).Source
  if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
  if (-not (Test-Path $node)) { throw 'Node.js não encontrado. Instale em https://nodejs.org e tente de novo.' }

  if (-not (Test-Path (Join-Path $root 'dist\index.html'))) {
    Write-Host 'Montando o app pela primeira vez...'
    Push-Location $root
    & npm run build | Out-Host
    Pop-Location
  }

  $logs = Join-Path $root 'data\logs'
  New-Item -ItemType Directory -Force $logs | Out-Null
  $log = Join-Path $logs 'server.log'
  $tsx = Join-Path $root 'node_modules\tsx\dist\cli.mjs'
  $cmd = "cmd.exe /d /c `"`"$node`" `"$tsx`" server\main.ts >> `"$log`" 2>&1`""

  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $cmd
    CurrentDirectory = $root
    ProcessStartupInformation = $startup
  }
  if ($created.ReturnValue -ne 0) { throw "O Windows não iniciou o servidor (código $($created.ReturnValue))." }

  $deadline = (Get-Date).AddSeconds(45)
  while (-not (Test-App)) {
    if ((Get-Date) -gt $deadline) { throw "O app não respondeu. Veja $log" }
    Start-Sleep -Milliseconds 500
  }
}

if (-not $NoBrowser) { Start-Process $url }
