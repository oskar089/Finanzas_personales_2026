// =====================================================================
// Smoke test E2E — ciclo real del usuario:
// setup de passphrase → alta de gasto → persistencia tras recargar
// =====================================================================
const { test, expect } = require('@playwright/test');

const PASSPHRASE = 'e2e-passphrase-2026';

test('setup cifrado, alta de gasto y persistencia tras recargar', async ({ page }) => {
    // Diagnóstico: capturar errores de consola/página para el CI
    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
    });
    page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));

    // 1) Primer uso: el gate de cifrado pide configurar la contraseña
    await page.goto('/');
    await expect(page.locator('#passphraseModal')).toBeVisible();
    await page.locator('#newPassphrase').fill(PASSPHRASE);
    await page.locator('#confirmPassphrase').fill(PASSPHRASE);
    await page.locator('#btnSetPassphrase').click();

    // El modal se cierra y la app termina de bootear. El submit listener se
    // registra al final del arranque; `#date` se llena con todayISO() justo
    // antes — su valor no vacío garantiza que la app está lista para aceptar
    // el formulario (si el click llegara antes, el submit nativo recargaría).
    await expect(page.locator('#passphraseModal')).toBeHidden();
    await expect(page.locator('#date')).not.toHaveValue('');

    // 2) Alta de un gasto
    await page.locator('#amount').fill('123.50');
    await page.locator('#category').fill('E2E');
    await page.locator('#description').fill('Movimiento E2E');
    await page.locator('#date').fill('2026-08-15');
    await page.locator('#btnSubmit').click();

    // 3) La fila aparece en la tabla
    await expect(page.locator('#expensesTable')).toContainText('Movimiento E2E');

    // 4) Recarga: vuelve a pedir la contraseña y los datos persisten
    await page.reload();
    await expect(page.locator('#passphraseModal')).toBeVisible();
    await expect(page.locator('#passphraseUnlockFields')).toBeVisible();
    await page.locator('#unlockPassphrase').fill(PASSPHRASE);
    await page.locator('#btnUnlock').click();

    await expect(page.locator('#passphraseModal')).toBeHidden();
    await expect(page.locator('#date')).not.toHaveValue('');
    await expect(page.locator('#expensesTable')).toContainText('Movimiento E2E');

    expect(errors, errors.join('\n')).toEqual([]);
});