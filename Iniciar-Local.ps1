$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'Instala y abre Docker Desktop con contenedores Linux antes de iniciar ModerAI.'
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Abre Docker Desktop y espera a que el motor este listo.' }
& docker compose version
if ($LASTEXITCODE -ne 0) { throw 'Docker Compose no esta disponible.' }
if (-not (Test-Path -LiteralPath '.env')) {
    $dbPassword = [guid]::NewGuid().ToString('N')
    $rootPassword = [guid]::NewGuid().ToString('N')
    "DB_PASSWORD=$dbPassword`nDB_ROOT_PASSWORD=$rootPassword" | Set-Content -LiteralPath '.env' -Encoding ascii
}
Write-Host 'Iniciando MySQL y el modelo local en CPU. La primera descarga puede tardar varios minutos.'
& docker compose up --build --detach --wait --wait-timeout 1800
if ($LASTEXITCODE -ne 0) {
    throw 'No termino el arranque. Revisa docker compose logs --tail 100. Los datos se conservan.'
}
Write-Host 'ModerAI listo: http://localhost:8000/src/feed/feed.html'
Write-Host 'Para detener: docker compose stop'
