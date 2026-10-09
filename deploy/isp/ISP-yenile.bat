@echo off
REM ================================================================
REM  Isp - serverde (C:\ISP) image-leri yukleyir ve proqrami ise salir.
REM  Baza (isp_mysqldata) SILINMIR - yalniz proqram yenilenir.
REM ================================================================
setlocal
cd /d "%~dp0"

if not exist isp-images.tar ( echo [X] isp-images.tar tapilmadi. & pause & exit /b 1 )
if not exist .env ( echo [X] .env tapilmadi. & pause & exit /b 1 )

echo [1/3] Image-ler yuklenir (1-2 deqiqe)...
docker load -i isp-images.tar || ( echo [X] docker load alinmadi. Docker Desktop isleyir? & pause & exit /b 1 )

echo [2/3] Konteynerler yenilenir...
docker compose -f docker-compose.offline.yml up -d --remove-orphans || ( pause & exit /b 1 )

echo [3/3] Veziyyet:
docker compose -f docker-compose.offline.yml ps
echo.
echo Hazirdir: http://localhost:5174
echo Ilk 30 saniye 502 normaldir (backend bazani yenileyir).
pause
