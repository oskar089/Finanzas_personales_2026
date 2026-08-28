#!/usr/bin/pwsh
# report-telegram.ps1 - Envia reporte de sesión a Telegram
# Presiona F5 o ejecuta: & ".\scripts\report-telegram.ps1"
# Requiere: $env:TELEGRAM_BOT_TOKEN y $env:TELEGRAM_CHAT_ID (desde .env)

# Determinar ruta del script y proyecto
$scriptDir = Split-Path $MyInvocation.MyCommand.Definition -Parent
$projectRoot = if ($scriptDir) { Join-Path $scriptDir .. } else { "." }
$envPath = Join-Path $projectRoot ".env"

if (Test-Path $envPath) {
    # Leer .env línea por línea y setear variables
    Get-Content $envPath | ForEach-Object {
        if ($_.Trim() -and $_.Trim()[0] -ne "#") {
            $eqPos = $_.IndexOf("=")
            if ($eqPos -gt 0) {
                $key = $_.Substring(0, $eqPos).Trim()
                $value = $_.Substring($eqPos + 1).Trim()
                Set-Item -Path "Env:$key" -Value $value
            }
        }
    }
} else {
    Write-Host "⚠️ No se encontró $envPath - asegúrate de tener las credenciales de Telegram" -ForegroundColor Yellow
    return
}

# Validar credenciales
if (-not $env:TELEGRAM_BOT_TOKEN -or $env:TELEGRAM_BOT_TOKEN -eq "") {
    Write-Host "⚠️ TELEGRAM_BOT_TOKEN no definido" -ForegroundColor Yellow
    return
}
if (-not $env:TELEGRAM_CHAT_ID -or $env:TELEGRAM_CHAT_ID -eq "") {
    Write-Host "⚠️ TELEGRAM_CHAT_ID no definido" -ForegroundColor Yellow
    return
}

# Construir mensaje de reporte
$timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$message = @"
🤖 **Reporte de sesión SDD - FinanzaPWA**
**Hora**: $timestamp
**Proyecto**: Finanzas_personales_2026
**Estado**: Sesión completada

-- Hechos principales --
- 183 tests passing (multi-currency, input locale, live rates)
- 5 commits this session: c7d2b4b, 1ec902b, e451de4, ca4c91e, 4aea5e4
- Bug fixes: Excel totals currency mix, AI prompt pin bugs
- Features: input locale-aware, live exchange rates

-- Próximos pasos pendientes --
- Definir frecuencia/trigger de reporte (ya configurado: close de sesión, auto)
"@

# Enviar a Telegram
$apiUrl = "https://api.telegram.org/bot$($env:TELEGRAM_BOT_TOKEN)/sendMessage"

$response = Invoke-RestMethod -Method Post -Uri $apiUrl -Body @{
    chat_id = $env:TELEGRAM_CHAT_ID
    text = $message
    parse_mode = "Markdown"
} -ErrorAction Stop

if ($response.ok) {
    Write-Host "✅ Reporte enviado a Telegram exitosamente" -ForegroundColor Green
    Write-Host "   Mensaje ID: $($response.result.message_id)" -ForegroundColor Cyan
} else {
    Write-Host "❌ Error al enviar reporte a Telegram" -ForegroundColor Red
    Write-Host "   Respuesta: $($response)" -ForegroundColor Red
}