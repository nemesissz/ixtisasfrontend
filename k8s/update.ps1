# ═══════════════════════════════════════════════════════════════════
#  Kod yeniləmə axını — image-i yenidən qurur və k8s pod-unu təzələyir
#
#  İstifadə:
#    powershell -ExecutionPolicy Bypass -File k8s\update.ps1 frontend
#    powershell -ExecutionPolicy Bypass -File k8s\update.ps1 backend
#    powershell -ExecutionPolicy Bypass -File k8s\update.ps1 all
#
#  Qeyd: əvvəlcə müvafiq repoda `git pull` edin (yeni kodu çəkmək üçün).
# ═══════════════════════════════════════════════════════════════════
param(
    [ValidateSet("frontend", "backend", "all")]
    [string]$Target = "all"
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent   # mmu-ixtisas qovluğu (compose burada)

function Update-One($name) {
    Write-Host ">> $name image-i yenidən qurulur..." -ForegroundColor Cyan
    docker compose -f "$root\docker-compose.yml" build $name
    Write-Host ">> k8s pod-u yenidən başladılır..." -ForegroundColor Cyan
    kubectl rollout restart "deploy/$name" -n isp
    kubectl rollout status  "deploy/$name" -n isp --timeout=120s
    Write-Host ">> $name yeniləndi." -ForegroundColor Green
}

if ($Target -eq "all") {
    Update-One "backend"
    Update-One "frontend"
} else {
    Update-One $Target
}
