@echo off
setlocal

REM ===========================================================================
REM  Cyberjet Compliance — developpement
REM
REM  Ouvre deux fenetres :
REM    * l'API ASP.NET Core sur http://localhost:5080
REM    * le serveur Vite sur http://localhost:5173, qui relaie /api vers l'API
REM
REM  Le proxy Vite n'est pas un confort : la session vit dans un cookie
REM  SameSite=Lax, que le navigateur refuserait d'envoyer entre deux origines.
REM  Travaillez donc sur http://localhost:5173.
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

if not exist client\node_modules (
    echo Installation des dependances npm ^(premiere fois, environ une minute^)...
    pushd client
    call npm ci
    if errorlevel 1 ( popd & exit /b 1 )
    popd
)

start "Cyberjet API" cmd /k dotnet watch --project server\Cyberjet.Api run
start "Cyberjet Web" cmd /k "cd client && npm run dev"

echo.
echo API       : http://localhost:5080  ^(documentation : /swagger^)
echo Interface : http://localhost:5173  ^<-- ouvrez celle-ci
echo.

endlocal
