@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul

set "PY=.venv\Scripts\python.exe"

if not exist "%PY%" (
    echo Premiere execution : creation de l'environnement virtuel...
    python -m venv .venv
    if errorlevel 1 (
        echo.
        echo Python est introuvable. Installez Python 3.11 ou superieur, puis relancez.
        pause
        exit /b 1
    )
    "%PY%" -m pip install --upgrade pip --quiet
    echo Installation des dependances...
    "%PY%" -m pip install -r requirements.txt --quiet
    if errorlevel 1 (
        echo Echec de l'installation des dependances.
        pause
        exit /b 1
    )
)

if "%~1"=="--demo" (
    echo Chargement du jeu de demonstration...
    "%PY%" -m app.seed_demo
    echo.
)

for /f "delims=" %%i in ('"%PY%" -c "import socket;print(socket.gethostbyname(socket.gethostname()))" 2^>nul') do set LANIP=%%i

echo.
echo   Application de conformite
echo   Sur ce poste     : http://127.0.0.1:8077
if defined LANIP echo   Depuis le reseau : http://%LANIP%:8077
echo.
echo   Premiere ouverture : un compte administrateur vous sera demande.
echo   Fermez cette fenetre ou appuyez sur Ctrl+C pour arreter.
echo.

start "" http://127.0.0.1:8077
"%PY%" -m uvicorn app.main:app --host 0.0.0.0 --port 8077

endlocal
