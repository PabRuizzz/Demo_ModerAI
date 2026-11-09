param(
    [ValidatePattern('^[a-zA-Z0-9.-]+$')]
    [string]$VmAddress = '172.195.104.192',
    [ValidatePattern('^[a-zA-Z0-9_-]+$')]
    [string]$VmUser = 'azureuser',
    [string]$KeyPath = (Join-Path $env:USERPROFILE 'Downloads\moderai-vm-key.pem')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $KeyPath -PathType Leaf)) {
    throw "No se encontro la clave SSH: $KeyPath"
}
Get-Command ssh.exe, scp.exe -ErrorAction Stop | Out-Null
$listeners = @(Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue)
if ($listeners.Count -gt 0) {
    throw 'El puerto local 8000 esta ocupado. Cierra el tunel SSH anterior o la API local antes de continuar.'
}

$destination = "${VmUser}@${VmAddress}"
$remoteScript = Join-Path $PSScriptRoot 'iniciar-vm.sh'
Write-Host 'La VM y MySQL deben estar encendidos en Azure.'
Write-Host 'Copiando solamente el script de arranque (no reinstala el proyecto)...'
& scp.exe -o ConnectTimeout=15 -i $KeyPath $remoteScript "${destination}:iniciar-moderai.sh"
if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo copiar el script. Revisa el estado de la VM, su IP y la regla SSH para tu IP publica actual.'
}

Write-Host 'Abriendo el tunel e iniciando FastAPI. Introduce la contrasena de MySQL cuando se solicite.'
# Quitar CR si el archivo se copia con finales de linea de Windows.
& ssh.exe -t -o ConnectTimeout=15 -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -i $KeyPath -L 'localhost:8000:127.0.0.1:8000' $destination "sed -i 's/\r$//' ~/iniciar-moderai.sh && bash ~/iniciar-moderai.sh"
if ($LASTEXITCODE -ne 0) {
    Write-Warning 'La sesion termino. Si no la cerraste tu, revisa el mensaje anterior.'
}
