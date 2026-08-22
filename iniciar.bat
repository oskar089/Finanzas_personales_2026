@echo off
REM ============================================================
REM  Finanzas Personales 2026 - Script de inicio
REM  Verifica el entorno, prepara la IA (Ollama + gemma4) y
REM  levanta un servidor local para evitar problemas de CORS,
REM  luego abre la app en el navegador.
REM ============================================================
setlocal EnableExtensions EnableDelayedExpansion
title Finanzas Personales 2026 - Inicio
cd /d "%~dp0"

echo ==============================================
echo    FINANZAS PERSONALES 2026 - Inicializando
echo ==============================================
echo.

REM ---------- 1) Node.js ----------
where node >NUL 2>NUL || goto no_node
for /f "delims=" %%v in ('node --version') do set "NODE_VER=%%v"
echo [OK] Node.js !NODE_VER!

REM ---------- 2) Dependencias ----------
if exist "node_modules\" (
    echo [OK] Dependencias ya instaladas.
    goto check_ollama
)
echo [*] Instalando dependencias con npm install...
call npm install || goto npm_fail
echo [OK] Dependencias instaladas.

REM ---------- 3) Ollama ----------
:check_ollama
curl -s -o NUL --max-time 2 http://localhost:11434/api/tags 2>NUL
if not errorlevel 1 (
    echo [OK] Ollama ya esta corriendo en localhost:11434.
    goto check_model
)
where ollama >NUL 2>NUL || goto no_ollama
echo [*] Arrancando Ollama...
start "Ollama Server" /min cmd /c "ollama serve"
set /a TRIES=0

:wait_ollama
timeout /t 2 /nobreak >NUL
curl -s -o NUL --max-time 2 http://localhost:11434/api/tags 2>NUL
if not errorlevel 1 goto ollama_up
set /a TRIES+=1
if !TRIES! lss 15 goto wait_ollama
goto ollama_slow

:ollama_up
echo [OK] Ollama corriendo en localhost:11434.

REM ---------- 4) Modelo gemma4 ----------
:check_model
ollama list 2>NUL | findstr /b /i "gemma4" >NUL && goto model_ok
echo [AVISO] El modelo gemma4 no esta descargado.
choice /C SN /N /M "[?] Descargarlo ahora? Puede tardar varios minutos [S/N]: "
if errorlevel 2 goto no_pull
echo [*] Descargando gemma4...
call ollama pull gemma4

:model_ok
echo [OK] Modelo gemma4 listo.
goto launch_server

:no_pull
echo [..] Sin problema. Podes bajarlo despues con: ollama pull gemma4
goto launch_server

REM ---------- 5) Servidor local + navegador ----------
:launch_server
echo.
echo [*] Levantando servidor local en http://localhost:3000 ...
echo     El navegador se abrira solo en unos segundos.
echo     Para cerrar la app, simplemente cerrar esta ventana.
echo.
start "" /min cmd /c "timeout /t 3 /nobreak >NUL && start http://localhost:3000"
call npx --yes serve -l 3000 .

echo.
echo [i] Servidor detenido. Hasta la proxima!
pause
exit /b 0

REM ---------- Errores fatales ----------
:no_node
echo [ERROR] Node.js no esta instalado.
echo         Bajalo desde https://nodejs.org y volve a ejecutar este script.
pause
exit /b 1

:npm_fail
echo [ERROR] Fallo npm install. Revisa el mensaje de arriba.
pause
exit /b 1

:no_ollama
echo [AVISO] Ollama no esta instalado: la autocategorizacion con IA quedara desactivada.
echo         La app funciona igual. Si queres la IA, instala Ollama desde https://ollama.com
goto launch_server

:ollama_slow
echo [AVISO] Ollama no respondio tras 30 segundos: la IA quedara desactivada por ahora.
echo         La app funciona igual; reinicia mas tarde para reintentar.
goto launch_server
