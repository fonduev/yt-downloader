@echo off
title YT Downloader Pro
cd /d "%~dp0"
echo.
echo  ========================================
echo   YT Downloader Pro - Iniciando...
echo  ========================================
echo.

:: Check if Python is available
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python no encontrado. Instala Python desde https://python.org
    pause
    exit /b 1
)

:: Check and install requirements
echo  [1/3] Verificando dependencias...
pip install -r requirements.txt --quiet --disable-pip-version-check

:: Check if ffmpeg is available
ffmpeg -version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [AVISO] ffmpeg no encontrado. Intentando instalar con winget...
    winget install --id Gyan.FFmpeg -e --silent >nul 2>&1
    if errorlevel 1 (
        echo  [AVISO] No se pudo instalar ffmpeg automaticamente.
        echo  [AVISO] Para descargar MP3 y fusionar video+audio, instala ffmpeg manualmente:
        echo  [AVISO] https://ffmpeg.org/download.html
        echo  [AVISO] O ejecuta: winget install Gyan.FFmpeg
        echo.
    ) else (
        echo  [OK] ffmpeg instalado correctamente.
    )
) else (
    echo  [OK] ffmpeg encontrado.
)

echo.
echo  [2/3] Iniciando servidor...
echo  [3/3] Abre tu navegador en: http://localhost:10000
echo.
echo  Presiona Ctrl+C para detener el servidor.
echo.

:: Open browser after a short delay
start "" timeout /t 2 /nobreak >nul && start "" "http://localhost:10000"

:: Start the Flask app
python app.py

pause
