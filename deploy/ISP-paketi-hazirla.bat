@echo off
REM ================================================================
REM  C:\ISP deploy paketini hazirlayir (internet demek olar lazim deyil -
REM  Docker kesindeki image-lerden istifade olunur).
REM
REM  Isletmek:  MMU-isp\deploy\ISP-paketi-hazirla.bat  [hedef_qovluq]
REM  Default hedef: C:\ISP-paket
REM
REM  Netice (USB ile servere C:\ISP-e kocurulur):
REM    isp-images.tar, docker-compose.offline.yml, ISP-yenile.bat, .env
REM ================================================================
setlocal
set "OUT=%~1"
if "%OUT%"=="" set "OUT=C:\ISP-paket"
cd /d "%~dp0.."

echo [1/4] Image-ler qurulur (kesden - tez olur)...
docker compose -p mmu-isp build backend frontend || ( echo [X] build alinmadi & pause & exit /b 1 )
docker tag mmu-isp-backend:latest  mmu-ixtisas-backend:latest  || ( pause & exit /b 1 )
docker tag mmu-isp-frontend:latest mmu-ixtisas-frontend:latest || ( pause & exit /b 1 )
docker image inspect mysql:8.4 >nul 2>&1 || docker pull mysql:8.4

if not exist "%OUT%" mkdir "%OUT%"

echo [2/4] isp-images.tar yazilir (~360 MB, 1-3 deqiqe)...
docker save mmu-ixtisas-frontend:latest mmu-ixtisas-backend:latest mysql:8.4 -o "%OUT%\isp-images.tar" || ( pause & exit /b 1 )

echo [3/4] Fayllar kocurulur...
copy /Y "deploy\isp\docker-compose.offline.yml" "%OUT%\" >nul
copy /Y "deploy\isp\ISP-yenile.bat" "%OUT%\" >nul

echo [4/4] .env...
if exist "%OUT%\.env" (
  echo     .env artiq var - toxunulmadi.
) else (
  call :rnd DBPW
  call :rnd JWTK
  call :rnd ADMPW
  call :writeenv
  echo     Yeni .env yaradildi. Ilk admin: admin / %ADMPW%
  echo     ^(bu parol yalniz BOS bazada istifade olunur^)
)
echo.
echo Hazirdir: %OUT%
echo  - YENI server: qovlugu butov C:\ISP-e kocurun, ISP-yenile.bat isledin.
echo  - ISLEYEN server: yalniz isp-images.tar ve ISP-yenile.bat-i kocurun
echo    (oradaki .env ve docker-compose.offline.yml-e TOXUNMAYIN).
pause
exit /b 0

:rnd
for /f %%i in ('powershell -NoProfile -Command "$b=New-Object byte[] 24; [Security.Cryptography.RNGCryptoServiceProvider]::new().GetBytes($b); [BitConverter]::ToString($b).Replace('-','')"') do set "%1=%%i"
exit /b 0

:writeenv
> "%OUT%\.env" (
  echo DB_NAME=mmuisp
  echo DB_ROOT_PASSWORD=%DBPW%
  echo JWT_KEY=%JWTK%
  echo JWT_EXPIRY_MINUTES=480
  echo SEED_ADMIN_USERNAME=admin
  echo SEED_ADMIN_PASSWORD=%ADMPW%
  echo SEED_ADMIN_EMAIL=admin@mmu.az
  echo CORS_ALLOWED_ORIGINS=
  echo TZ=Asia/Baku
)
exit /b 0
