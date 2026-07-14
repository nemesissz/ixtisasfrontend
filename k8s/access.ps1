# ═══════════════════════════════════════════════════════════════════
#  Daimi giriş — frontend-i http://localhost:5180-ə bağlayır
#  Bağlantı düşsə avtomatik yenidən qoşulur (Ctrl+C ilə dayandırın).
#
#  İşə salmaq:  powershell -ExecutionPolicy Bypass -File k8s\access.ps1
#  Sonra açın:  http://localhost:5180   (admin / Admin@2026)
# ═══════════════════════════════════════════════════════════════════

$ErrorActionPreference = "SilentlyContinue"
Write-Host "Giris: http://localhost:5180  (dayandirmaq ucun Ctrl+C)" -ForegroundColor Green

while ($true) {
    kubectl port-forward -n isp svc/frontend 5180:80 --address 127.0.0.1
    Write-Host "Baglanti dusdu — 2 saniyeye yeniden qosulur..." -ForegroundColor Yellow
    Start-Sleep -Seconds 2
}
