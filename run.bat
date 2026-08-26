@echo off
setlocal

REM ===========================================================================
REM  Cyberjet Compliance — lancement en production locale
REM
REM  Compile l'interface React dans wwwroot, puis démarre l'API ASP.NET Core
REM  qui sert à la fois le JSON et l'interface. Une seule adresse, un seul
REM  processus : c'est ce qui est déployé sur le serveur.
REM
REM  Pour développer, préférez run-dev.bat : il garde le rechargement à chaud.
REM ===========================================================================

cd /d "%~dp0"

where dotnet >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Le SDK .NET est introuvable.
    echo Installez .NET SDK 9 : https://dotnet.microsoft.com/download
    exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERREUR] Node.js est introuvable.
    echo Installez Node.js 20 LTS ou plus recent : https://nodejs.org
    exit /b 1
)

echo.
echo === Interface ===
pushd client
if not exist node_modules (
    echo Installation des dependances npm ^(premiere fois, environ une minute^)...
    call npm ci
    if errorlevel 1 ( popd & exit /b 1 )
)
call npm run build
if errorlevel 1 ( popd & exit /b 1 )
popd

echo.
echo === API ===
echo L'application sera disponible sur http://localhost:5080
echo Fermez cette fenetre ou faites Ctrl+C pour arreter.
echo.

dotnet run --project server\Cyberjet.Api --configuration Release --urls http://0.0.0.0:5080

endlocal
