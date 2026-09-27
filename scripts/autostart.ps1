# Meus Perfumes — iniciar junto com o Windows (opcional, reversível).
# Põe (ou tira) um atalho na pasta Inicializar do SEU usuário: ao entrar no Windows, o app sobe sozinho, sem abrir
# navegador. Nada de serviço do sistema nem permissão de administrador.
#
#   npm run app:autostart            instala
#   npm run app:autostart -- -Remove desinstala

param([switch]$Remove)

$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath('Startup')
$lnk = Join-Path $startup 'Meus Perfumes (servidor).lnk'

if ($Remove) {
  if (Test-Path $lnk) { Remove-Item $lnk -Force; Write-Host 'Não inicia mais com o Windows.' } else { Write-Host 'Já não estava configurado.' }
  exit 0
}

$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$s.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\scripts\launch.ps1`" -NoBrowser"
$s.WorkingDirectory = $root
$s.IconLocation = "$root\assets\meus-perfumes.ico,0"
$s.Description = 'Inicia o servidor do Meus Perfumes ao entrar no Windows'
$s.WindowStyle = 7
$s.Save()
Write-Host "Pronto: o Meus Perfumes vai iniciar junto com o Windows ($lnk)."
