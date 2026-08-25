@echo off
chcp 65001 >nul 2>&1
title Finanzas Personales 2026

echo.
echo  ======================================
echo    Finanzas Personales 2026
echo  ======================================
echo.

:: 1. Verificar Node.js
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [ERROR] Node.js no esta instalado.
    echo  Descargalo desde: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('node -v') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER%

:: 2. Instalar dependencias si hace falta
if not exist "node_modules" (
    echo  [..] Instalando dependencias...
    call npm install --silent
    if %ERRORLEVEL% neq 0 (
        echo  [ERROR] Fallo npm install
        pause
        exit /b 1
    )
    echo  [OK] Dependencias instaladas
) else (
    echo  [OK] node_modules ya existe
)

:: 3. Verificar e iniciar Ollama
echo.
echo  --- IA Local (Ollama) ---
curl -s http://localhost:11434/api/tags >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [OK] Ollama esta corriendo
    goto :ollama_done
)

where ollama >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo  [AVISO] Ollama no esta instalado.
    echo  Las funciones de IA no van a funcionar.
    echo  Instalalo desde: https://ollama.com/download
    echo.
    goto :ollama_done
)

echo  [..] Iniciando Ollama en segundo plano...
start "" /b ollama serve
timeout /t 3 /nobreak >nul

curl -s http://localhost:11434/api/tags >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo  [OK] Ollama iniciado correctamente
) else (
    echo  [AVISO] Ollama no pudo iniciar.
    echo  Intenta manualmente: ollama serve
)
:ollama_done

:: 4. Tests (opcional)
echo.
set /p RUN_TESTS="Correr tests antes de levantar? (s/n): "
if /i "%RUN_TESTS%"=="s" (
    echo  [..] Ejecutando tests...
    call npx vitest run
    echo.
)

:: 5. Levantar servidor
echo.
echo  [..] Abriendo http://localhost:3000 ...
start http://localhost:3000
node server.js
