@echo off
REM ================================================================
REM  C:\ISP\isp-images.tar faylini yeni kodla yenileyir.
REM  C:\ISP-deki diger fayllara (.env, docker-compose.offline.yml) TOXUNMUR.
REM  Image adlari C:\ISP\docker-compose.offline.yml-den oxunur - eyni qalir.
REM
REM  Isletmek (MMU-isp qovlugunda):  deploy\ISP-yenile.bat
REM ================================================================
setlocal EnableDelayedExpansion
set "ISP=C:\ISP"
set "COMPOSE=%ISP%\docker-compose.offline.yml"
cd /d "%~dp0.."

if not exist "%COMPOSE%" ( echo [X] %COMPOSE% tapilmadi. & pause & exit /b 1 )

REM ── C:\ISP-in istifade etdiyi image-ler ──
set "IMAGES="
pushd "%ISP%"
for /f "delims=" %%i in ('docker compose -f docker-compose.offline.yml config --images') do set "IMAGES=!IMAGES! %%i"
popd
echo C:\ISP image-leri:%IMAGES%
echo %IMAGES% | findstr /c:"mmu-ixtisas-backend" >nul || ( echo [X] mmu-ixtisas-backend gozlenirdi. & pause & exit /b 1 )
echo %IMAGES% | findstr /c:"mmu-ixtisas-frontend" >nul || ( echo [X] mmu-ixtisas-frontend gozlenirdi. & pause & exit /b 1 )

echo.
echo [1/3] Yeni kodla image-ler qurulur (kesden)...
docker compose -p mmu-isp build backend frontend || ( echo [X] build alinmadi & pause & exit /b 1 )
docker tag mmu-isp-backend:latest  mmu-ixtisas-backend:latest  || ( pause & exit /b 1 )
docker tag mmu-isp-frontend:latest mmu-ixtisas-frontend:latest || ( pause & exit /b 1 )

echo [2/3] Kohne fayl ehtiyata: isp-images.old.tar
if exist "%ISP%\isp-images.old.tar" del "%ISP%\isp-images.old.tar"
if exist "%ISP%\isp-images.tar" ren "%ISP%\isp-images.tar" isp-images.old.tar

echo [3/3] Yeni isp-images.tar yazilir (1-3 deqiqe)...
docker save%IMAGES% -o "%ISP%\isp-images.tar"
if errorlevel 1 (
  echo [X] yazilmadi - kohne fayl geri qaytarilir.
  if exist "%ISP%\isp-images.old.tar" ren "%ISP%\isp-images.old.tar" isp-images.tar
  pause & exit /b 1
)

echo.
echo Hazirdir: %ISP%\isp-images.tar yenilendi.
echo Her sey qaydasindadirsa ehtiyat fayli silmek olar: %ISP%\isp-images.old.tar
pause
