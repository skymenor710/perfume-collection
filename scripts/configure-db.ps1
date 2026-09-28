# Configura as variáveis do banco no .env.local SEM mostrar nenhum valor na tela.
# Uso (no PowerShell, dentro da pasta do projeto):   npm run db:configure
#
# Pede cada URL com digitação oculta (cole com o botão direito ou Ctrl+V e aperte Enter), confere o formato, grava no
# .env.local (substituindo só estas chaves; o resto do arquivo fica igual) e roda o db:targets no fim.
# Enter vazio = mantém o valor que já estiver no arquivo.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root '.env.local'
$lines = if (Test-Path $envFile) { [System.IO.File]::ReadAllLines($envFile) } else { @('# Configuração local da coleção de perfumes. Não versionar.') }

function Read-Secret([string]$prompt) {
  $secure = Read-Host -Prompt $prompt -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)).Trim().Trim('"').Trim("'") }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Test-Url([string]$value, [bool]$wantPooler, [string]$name) {
  if ($value -notmatch '^postgres(ql)?://') { Write-Host "  $name precisa começar com postgresql:// — não gravado." -ForegroundColor Red; return $false }
  $hostPart = ($value -replace '^postgres(ql)?://[^@]*@', '') -replace '[/:?].*$', ''
  $pooled = $hostPart -match '-pooler\.'
  if ($wantPooler -and -not $pooled) { Write-Host "  $name deveria ser a connection string COM pooler (host com '-pooler') — não gravado." -ForegroundColor Red; return $false }
  if (-not $wantPooler -and $pooled) { Write-Host "  $name deveria ser a conexão DIRETA (host sem '-pooler') — não gravado." -ForegroundColor Red; return $false }
  return $true
}

$wanted = [ordered]@{
  'DATABASE_URL'            = @{ prompt = 'DATABASE_URL (banco PRINCIPAL, COM pooler)'; secret = $true; pooler = $true }
  'DATABASE_URL_UNPOOLED'   = @{ prompt = 'DATABASE_URL_UNPOOLED (banco PRINCIPAL, conexão DIRETA)'; secret = $true; pooler = $false }
  'TEST_DATABASE_URL'       = @{ prompt = 'TEST_DATABASE_URL (branch de TESTES, COM pooler)'; secret = $true; pooler = $true }
  'NEON_TEST_DATABASE_NAME' = @{ prompt = 'NEON_TEST_DATABASE_NAME (nome do database do branch de testes, ex.: neondb ou testes)'; secret = $false; pooler = $false }
}

Write-Host "`nNada do que você digitar aparece na tela nem é impresso. Enter vazio mantém o valor atual.`n"
$values = @{}
foreach ($key in $wanted.Keys) {
  $spec = $wanted[$key]
  $value = if ($spec.secret) { Read-Secret $spec.prompt } else { (Read-Host -Prompt $spec.prompt).Trim() }
  if (-not $value) { Write-Host "  $key : mantido"; continue }
  if ($spec.secret -and -not (Test-Url $value $spec.pooler $key)) { continue }
  $values[$key] = $value
  Write-Host "  $key : recebido"
}

if ($values.ContainsKey('TEST_DATABASE_URL') -and $values.ContainsKey('DATABASE_URL') -and $values['TEST_DATABASE_URL'] -eq $values['DATABASE_URL']) {
  Write-Host "`nTEST_DATABASE_URL é IGUAL a DATABASE_URL — nada foi gravado. O branch de testes precisa ser outro." -ForegroundColor Red
  exit 1
}

$out = New-Object System.Collections.Generic.List[string]
foreach ($line in $lines) {
  $k = if ($line -match '^\s*([A-Z0-9_]+)\s*=') { $Matches[1] } else { $null }
  if ($k -and $values.ContainsKey($k)) { continue }
  $out.Add($line)
}
if ($values.Count) {
  $out.Add('')
  $out.Add('# Banco (Neon) — gravado por npm run db:configure. Não versionar.')
  foreach ($key in $wanted.Keys) { if ($values.ContainsKey($key)) { $out.Add("$key=$($values[$key])") } }
}
# UTF-8 sem BOM (o servidor lê linha a linha).
[System.IO.File]::WriteAllLines($envFile, $out, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "`n.env.local atualizado ($($values.Count) valor(es)). Conferindo sem mostrar nada:`n"
Push-Location $root
try { & npm run -s db:targets } finally { Pop-Location }
