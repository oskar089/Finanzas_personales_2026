// =====================================================================
// Tests para src/ai-providers.js
// =====================================================================
// Corre con: npx vitest run src/ai-providers.test.js
// =====================================================================

import 'fake-indexeddb/auto';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { webcrypto } from 'node:crypto';
import * as storage from './storage.js';
import * as aiProviders from './ai-providers.js';

// El storage ahora es key-gated (almacenes cifrados), así que exponemos
// webcrypto de Node y abrimos una clave antes de persistir (PR #2 data-encryption).
Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true
});

const TEST_PASSPHRASE = 'contraseña-de-prueba-2026';

// --- Helpers -----------------------------------------------------------

const mockFetch = (response) => {
    const fn = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: () => Promise.resolve(response)
    });
    globalThis.fetch = fn;
    return fn;
};

const mockFetchError = (status, statusText = 'Error') => {
    const fn = vi.fn().mockResolvedValue({
        ok: false,
        status,
        statusText,
        json: () => Promise.resolve({})
    });
    globalThis.fetch = fn;
    return fn;
};

const mockFetchNetworkError = () => {
    const fn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    globalThis.fetch = fn;
    return fn;
};

const defaultSettings = {
    id: 'active',
    provider: 'local',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    model: 'gemma3:4b',
    updatedAt: Date.now()
};

const openaiSettings = {
    ...defaultSettings,
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    apiKey: 'sk-test-key',
    model: 'gpt-4o'
};

const geminiSettings = {
    ...defaultSettings,
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com',
    apiKey: 'gemini-key',
    model: 'gemini-2.0-flash'
};

const claudeSettings = {
    ...defaultSettings,
    provider: 'claude',
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'claude-key',
    model: 'claude-sonnet-4-20250514'
};

const sampleMessages = [
    { role: 'system', content: 'You are a helpful assistant.' },
    { role: 'user', content: 'Hello!' }
];

// --- Setup -------------------------------------------------------------

beforeEach(async () => {
    // Clear IndexedDB and localStorage
    await storage.clear();
    // Abrimos la clave de cifrado para poder persistir (storage key-gated, PR #2)
    await storage.initKey(TEST_PASSPHRASE);
    // Clear AI settings directly
    try {
        const db = await new Promise((resolve, reject) => {
            const req = indexedDB.open('finanzas_personales_2026', 5);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        const tx = db.transaction('aiSettings', 'readwrite');
        tx.objectStore('aiSettings').delete('active');
    } catch {
        // ignore
    }
    localStorage.removeItem('finanzas:ai-settings:v1');

    // Restore original fetch after each test
    if (globalThis._originalFetch) {
        globalThis.fetch = globalThis._originalFetch;
    }
});

// -------------------------------------------------------------------
// PROVIDERS config
// -------------------------------------------------------------------
describe('PROVIDERS config', () => {
    it('has 4 providers defined', () => {
        expect(Object.keys(aiProviders.PROVIDERS)).toHaveLength(4);
    });

    it('local provider has correct defaults', () => {
        const local = aiProviders.PROVIDERS.local;
        expect(local.baseUrl).toBe('http://localhost:11434');
        expect(local.chatEndpoint).toBe('/v1/chat/completions');
        expect(local.modelsEndpoint).toBe('/v1/models');
    });

    it('openai provider points to api.openai.com', () => {
        expect(aiProviders.PROVIDERS.openai.baseUrl).toBe('https://api.openai.com');
    });

    it('gemini provider has null chatEndpoint (custom format)', () => {
        expect(aiProviders.PROVIDERS.gemini.chatEndpoint).toBeNull();
    });

    it('claude provider uses /v1/messages', () => {
        expect(aiProviders.PROVIDERS.claude.chatEndpoint).toBe('/v1/messages');
    });
});

// -------------------------------------------------------------------
// DEFAULT_SETTINGS
// -------------------------------------------------------------------
describe('DEFAULT_SETTINGS', () => {
    it('defaults to local provider', () => {
        expect(aiProviders.DEFAULT_SETTINGS.provider).toBe('local');
    });

    it('defaults to localhost:11434', () => {
        expect(aiProviders.DEFAULT_SETTINGS.baseUrl).toBe('http://localhost:11434');
    });

    it('defaults to gemma3:4b model', () => {
        expect(aiProviders.DEFAULT_SETTINGS.model).toBe('gemma3:4b');
    });

    it('has empty apiKey', () => {
        expect(aiProviders.DEFAULT_SETTINGS.apiKey).toBe('');
    });
});

// -------------------------------------------------------------------
// getActiveProvider()
// -------------------------------------------------------------------
describe('getActiveProvider()', () => {
    it('returns defaults when no settings are saved', async () => {
        const result = await aiProviders.getActiveProvider();
        expect(result.provider).toBe('local');
        expect(result.baseUrl).toBe('http://localhost:11434');
        expect(result.model).toBe('gemma3:4b');
    });

    it('returns saved settings when they exist', async () => {
        await storage.saveAiSettings(openaiSettings);
        const result = await aiProviders.getActiveProvider();
        expect(result.provider).toBe('openai');
        expect(result.apiKey).toBe('sk-test-key');
        expect(result.model).toBe('gpt-4o');
    });
});

// -------------------------------------------------------------------
// openaiCompatibleFetch() — local provider
// -------------------------------------------------------------------
describe('openaiCompatibleFetch()', () => {
    it('POSTs to /v1/chat/completions with correct body for local', async () => {
        const fetchFn = mockFetch({
            choices: [{ message: { content: 'Hello world' } }]
        });

        const result = await aiProviders.openaiCompatibleFetch(
            defaultSettings,
            sampleMessages,
            { temperature: 0.1, max_tokens: 20 }
        );

        expect(fetchFn).toHaveBeenCalledOnce();
        const [url, opts] = fetchFn.mock.calls[0];
        expect(url).toBe('http://localhost:11434/v1/chat/completions');
        expect(opts.method).toBe('POST');

        const body = JSON.parse(opts.body);
        expect(body.model).toBe('gemma3:4b');
        expect(body.messages).toEqual(sampleMessages);
        expect(body.stream).toBe(false);
        expect(body.temperature).toBe(0.1);
        expect(body.max_tokens).toBe(20);

        expect(result.text).toBe('Hello world');
    });

    it('includes Authorization header when apiKey is set', async () => {
        mockFetch({ choices: [{ message: { content: 'ok' } }] });

        await aiProviders.openaiCompatibleFetch(
            openaiSettings,
            [{ role: 'user', content: 'Hi' }]
        );

        const [, opts] = globalThis.fetch.mock.calls[0];
        expect(opts.headers['Authorization']).toBe('Bearer sk-test-key');
    });

    it('does not include Authorization header when apiKey is empty', async () => {
        mockFetch({ choices: [{ message: { content: 'ok' } }] });

        await aiProviders.openaiCompatibleFetch(
            defaultSettings,
            [{ role: 'user', content: 'Hi' }]
        );

        const [, opts] = globalThis.fetch.mock.calls[0];
        expect(opts.headers['Authorization']).toBeUndefined();
    });

    it('throws on non-200 response', async () => {
        mockFetchError(401, 'Unauthorized');

        await expect(
            aiProviders.openaiCompatibleFetch(defaultSettings, sampleMessages)
        ).rejects.toThrow('OpenAI-compatible request failed: 401 Unauthorized');
    });
});

// -------------------------------------------------------------------
// geminiTranslateMessages()
// -------------------------------------------------------------------
describe('geminiTranslateMessages()', () => {
    it('translates user/assistant messages to Gemini format', () => {
        const messages = [
            { role: 'user', content: 'Hello' },
            { role: 'assistant', content: 'Hi there' },
            { role: 'user', content: 'How are you?' }
        ];

        const result = aiProviders.geminiTranslateMessages(messages);

        expect(result.systemInstruction).toBeNull();
        expect(result.contents).toHaveLength(3);
        expect(result.contents[0]).toEqual({ role: 'user', parts: [{ text: 'Hello' }] });
        expect(result.contents[1]).toEqual({ role: 'model', parts: [{ text: 'Hi there' }] });
        expect(result.contents[2]).toEqual({ role: 'user', parts: [{ text: 'How are you?' }] });
    });

    it('extracts system message as systemInstruction', () => {
        const messages = [
            { role: 'system', content: 'You are helpful.' },
            { role: 'user', content: 'Hi' }
        ];

        const result = aiProviders.geminiTranslateMessages(messages);

        expect(result.systemInstruction).toEqual({ parts: [{ text: 'You are helpful.' }] });
        expect(result.contents).toHaveLength(1);
        expect(result.contents[0].role).toBe('user');
    });

    it('handles messages without system prompt', () => {
        const messages = [{ role: 'user', content: 'Hi' }];
        const result = aiProviders.geminiTranslateMessages(messages);

        expect(result.systemInstruction).toBeNull();
        expect(result.contents).toHaveLength(1);
    });
});

// -------------------------------------------------------------------
// geminiFetch()
// -------------------------------------------------------------------
describe('geminiFetch()', () => {
    it('POSTs to Gemini generateContent endpoint with correct format', async () => {
        const fetchFn = mockFetch({
            candidates: [{ content: { parts: [{ text: 'Gemini response' }] } }]
        });

        const result = await aiProviders.geminiFetch(
            geminiSettings,
            sampleMessages,
            { temperature: 0.2, max_tokens: 100 }
        );

        expect(fetchFn).toHaveBeenCalledOnce();
        const [url, opts] = fetchFn.mock.calls[0];
        expect(url).toContain('generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
        // La API key viaja en el header (x-goog-api-key), nunca en la URL
        // (la URL puede quedar en logs/proxies).
        expect(url).not.toContain('key=');
        expect(opts.headers['x-goog-api-key']).toBe('gemini-key');

        const body = JSON.parse(opts.body);
        expect(body.contents).toBeDefined();
        expect(body.generationConfig.temperature).toBe(0.2);
        expect(body.generationConfig.maxOutputTokens).toBe(100);
        expect(body.systemInstruction).toBeDefined();

        expect(result.text).toBe('Gemini response');
    });

    it('handles response without system instruction', async () => {
        mockFetch({
            candidates: [{ content: { parts: [{ text: 'No system' }] } }]
        });

        const result = await aiProviders.geminiFetch(
            geminiSettings,
            [{ role: 'user', content: 'Hi' }]
        );

        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.systemInstruction).toBeUndefined();
        expect(result.text).toBe('No system');
    });

    it('throws on non-200 response', async () => {
        mockFetchError(403, 'Forbidden');

        await expect(
            aiProviders.geminiFetch(geminiSettings, sampleMessages)
        ).rejects.toThrow('Gemini request failed: 403 Forbidden');
    });
});

// -------------------------------------------------------------------
// claudeFetch()
// -------------------------------------------------------------------
describe('claudeFetch()', () => {
    it('POSTs to /v1/messages with correct headers and body', async () => {
        const fetchFn = mockFetch({
            content: [{ text: 'Claude response' }]
        });

        const result = await aiProviders.claudeFetch(
            claudeSettings,
            sampleMessages,
            { temperature: 0.5, max_tokens: 200 }
        );

        expect(fetchFn).toHaveBeenCalledOnce();
        const [url, opts] = fetchFn.mock.calls[0];
        expect(url).toBe('https://api.anthropic.com/v1/messages');
        expect(opts.headers['x-api-key']).toBe('claude-key');
        expect(opts.headers['anthropic-version']).toBe('2023-06-01');

        const body = JSON.parse(opts.body);
        expect(body.model).toBe('claude-sonnet-4-20250514');
        expect(body.messages).toEqual([{ role: 'user', content: 'Hello!' }]);
        expect(body.system).toBe('You are a helpful assistant.');
        expect(body.max_tokens).toBe(200);
        expect(body.temperature).toBe(0.5);

        expect(result.text).toBe('Claude response');
    });

    it('omits system param when no system message', async () => {
        mockFetch({ content: [{ text: 'ok' }] });

        await aiProviders.claudeFetch(
            claudeSettings,
            [{ role: 'user', content: 'Hi' }]
        );

        const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
        expect(body.system).toBeUndefined();
        expect(body.messages).toEqual([{ role: 'user', content: 'Hi' }]);
    });

    it('throws on non-200 response', async () => {
        mockFetchError(401, 'Unauthorized');

        await expect(
            aiProviders.claudeFetch(claudeSettings, sampleMessages)
        ).rejects.toThrow('Claude request failed: 401 Unauthorized');
    });
});

// -------------------------------------------------------------------
// chatCompletion() — routing
// -------------------------------------------------------------------
describe('chatCompletion() routing', () => {
    it('routes to openaiCompatibleFetch for local provider', async () => {
        await storage.saveAiSettings(defaultSettings);
        const fetchFn = mockFetch({
            choices: [{ message: { content: 'local response' } }]
        });

        const result = await aiProviders.chatCompletion(sampleMessages);

        expect(fetchFn).toHaveBeenCalledOnce();
        const [url] = fetchFn.mock.calls[0];
        expect(url).toContain('/v1/chat/completions');
        expect(result.text).toBe('local response');
    });

    it('routes to openaiCompatibleFetch for openai provider', async () => {
        await storage.saveAiSettings(openaiSettings);
        mockFetch({ choices: [{ message: { content: 'openai response' } }] });

        const result = await aiProviders.chatCompletion(sampleMessages);

        const [url] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('api.openai.com');
        expect(result.text).toBe('openai response');
    });

    it('routes to geminiFetch for gemini provider', async () => {
        await storage.saveAiSettings(geminiSettings);
        mockFetch({
            candidates: [{ content: { parts: [{ text: 'gemini response' }] } }]
        });

        const result = await aiProviders.chatCompletion(sampleMessages);

        const [url] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('generativelanguage.googleapis.com');
        expect(result.text).toBe('gemini response');
    });

    it('routes to claudeFetch for claude provider', async () => {
        await storage.saveAiSettings(claudeSettings);
        mockFetch({ content: [{ text: 'claude response' }] });

        const result = await aiProviders.chatCompletion(sampleMessages);

        const [url] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('api.anthropic.com/v1/messages');
        expect(result.text).toBe('claude response');
    });

    it('throws for unknown provider', async () => {
        await storage.saveAiSettings({ ...defaultSettings, provider: 'unknown' });

        await expect(
            aiProviders.chatCompletion(sampleMessages)
        ).rejects.toThrow('Unknown provider: unknown');
    });
});

// -------------------------------------------------------------------
// discoverModels()
// -------------------------------------------------------------------
describe('discoverModels()', () => {
    it('returns model list for local provider', async () => {
        mockFetch({
            data: [
                { id: 'gemma3:4b' },
                { id: 'llama3.1:8b' },
                { id: 'mistral:7b' }
            ]
        });

        const models = await aiProviders.discoverModels(defaultSettings);

        expect(models).toEqual(['gemma3:4b', 'llama3.1:8b', 'mistral:7b']);
        const [url] = globalThis.fetch.mock.calls[0];
        expect(url).toBe('http://localhost:11434/v1/models');
    });

    it('returns model list for openai provider', async () => {
        mockFetch({
            data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }]
        });

        const models = await aiProviders.discoverModels(openaiSettings);

        expect(models).toEqual(['gpt-4o', 'gpt-4o-mini']);
        const [url] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('api.openai.com/v1/models');
    });

    it('returns empty array for gemini (no modelsEndpoint)', async () => {
        const models = await aiProviders.discoverModels(geminiSettings);
        expect(models).toEqual([]);
    });

    it('returns empty array for claude (no modelsEndpoint)', async () => {
        const models = await aiProviders.discoverModels(claudeSettings);
        expect(models).toEqual([]);
    });

    it('returns empty array on network error', async () => {
        mockFetchNetworkError();

        const models = await aiProviders.discoverModels(defaultSettings);

        expect(models).toEqual([]);
    });

    it('returns empty array on non-200 response', async () => {
        mockFetchError(500);

        const models = await aiProviders.discoverModels(defaultSettings);

        expect(models).toEqual([]);
    });

    it('includes Authorization header when apiKey is set', async () => {
        mockFetch({ data: [{ id: 'gpt-4o' }] });

        await aiProviders.discoverModels(openaiSettings);

        const [, opts] = globalThis.fetch.mock.calls[0];
        expect(opts.headers['Authorization']).toBe('Bearer sk-test-key');
    });

    it('handles "models" key in response (alternative format)', async () => {
        mockFetch({
            models: [{ id: 'model-a' }, { id: 'model-b' }]
        });

        const models = await aiProviders.discoverModels(defaultSettings);

        expect(models).toEqual(['model-a', 'model-b']);
    });
});

// -------------------------------------------------------------------
// testConnection()
// -------------------------------------------------------------------
describe('testConnection()', () => {
    it('returns ok: true on successful connection', async () => {
        mockFetch({ choices: [{ message: { content: 'Hi!' } }] });

        const result = await aiProviders.testConnection(defaultSettings);

        expect(result.ok).toBe(true);
        expect(result.error).toBeUndefined();
    });

    it('returns ok: false with error on failure', async () => {
        mockFetchError(401, 'Unauthorized');

        const result = await aiProviders.testConnection(openaiSettings);

        expect(result.ok).toBe(false);
        expect(result.error).toContain('401');
    });

    it('returns ok: false with error on network error', async () => {
        mockFetchNetworkError();

        const result = await aiProviders.testConnection(defaultSettings);

        expect(result.ok).toBe(false);
        expect(result.error).toBeDefined();
    });

    it('tests with the provided settings, not from storage', async () => {
        // Save a different provider in storage
        await storage.saveAiSettings(geminiSettings);

        // Test with local settings directly
        mockFetch({ choices: [{ message: { content: 'ok' } }] });
        const result = await aiProviders.testConnection(defaultSettings);

        expect(result.ok).toBe(true);
        const [url] = globalThis.fetch.mock.calls[0];
        expect(url).toContain('localhost:11434');
    });
});

// -------------------------------------------------------------------
// fetchWithTimeout() — cancela peticiones colgadas
// -------------------------------------------------------------------
describe('fetchWithTimeout()', () => {
    it('resuelve normalmente si el proveedor responde a tiempo', async () => {
        const fetchFn = mockFetch({ choices: [{ message: { content: 'ok' } }] });

        const res = await aiProviders.fetchWithTimeout(
            'http://localhost:11434/v1/chat/completions',
            { method: 'POST' },
            100
        );

        expect(res.ok).toBe(true);
        expect(fetchFn).toHaveBeenCalledOnce();
    });

    it('aborta y rechaza si el proveedor no responde dentro del timeout', async () => {
        vi.useFakeTimers();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = (_url, opts) => new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError'))
            );
        });
        try {
            const promise = aiProviders.fetchWithTimeout('http://proveedor-colgado', {}, 50);
            const assertion = promise.then(() => 'resolved', (err) => `rejected: ${err.message}`);
            await vi.advanceTimersByTimeAsync(100);
            const outcome = await assertion;
            expect(outcome).toContain('tardó más de');
        } finally {
            globalThis.fetch = originalFetch;
            vi.useRealTimers();
        }
    });

    it('pasa un AbortSignal al fetch options', async () => {
        const fetchFn = mockFetch({ choices: [{ message: { content: 'ok' } }] });

        await aiProviders.fetchWithTimeout('http://x', {}, 100);

        const [, opts] = fetchFn.mock.calls[0];
        expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('openaiCompatibleFetch usa el timeout del helper', async () => {
        const fetchFn = mockFetch({ choices: [{ message: { content: 'ok' } }] });

        await aiProviders.openaiCompatibleFetch(
            defaultSettings,
            [{ role: 'user', content: 'Hi' }],
            { timeout: 100 }
        );

        const [, opts] = fetchFn.mock.calls[0];
        expect(opts.signal).toBeInstanceOf(AbortSignal);
    });

    it('cancelación del usuario propaga AbortError (no el mensaje de timeout)', async () => {
        const controller = new AbortController();
        globalThis.fetch = (_url, opts) => new Promise((_resolve, reject) => {
            if (opts.signal.aborted) {
                reject(new DOMException('Aborted', 'AbortError'));
                return;
            }
            opts.signal.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError'))
            );
        });

        const promise = aiProviders.fetchWithTimeout('http://proveedor-lento', { signal: controller.signal }, 1000);
        const assertion = promise.then(() => 'resolved', err => `rejected:${err.name}`);
        controller.abort();
        const outcome = await assertion;

        expect(outcome).toBe('rejected:AbortError');
    });

    it('señal ya abortada rechaza sin esperar el timeout', async () => {
        const controller = new AbortController();
        controller.abort();
        const fetchFn = vi.fn((_url, opts) => new Promise((_resolve, reject) => {
            if (opts.signal.aborted) reject(new DOMException('Aborted', 'AbortError'));
        })); 
        globalThis.fetch = fetchFn;

        const outcome = await aiProviders.fetchWithTimeout('http://x', { signal: controller.signal }, 5000)
            .then(() => 'resolved', err => `rejected:${err.name}`);

        expect(outcome).toBe('rejected:AbortError');
        expect(fetchFn).toHaveBeenCalledOnce();
    });

    it('openaiCompatibleFetch combina la señal del usuario con el timeout', async () => {
        const controller = new AbortController();
        let receivedSignal;
        globalThis.fetch = (_url, opts) => new Promise((_resolve, reject) => {
            receivedSignal = opts.signal;
            opts.signal.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError'))
            );
        });

        const promise = aiProviders.openaiCompatibleFetch(
            defaultSettings,
            [{ role: 'user', content: 'Hi' }],
            { timeout: 5000, signal: controller.signal }
        );
        const assertion = promise.then(() => 'resolved', err => `rejected:${err.name}`);

        // La petición se lanza con un signal combinado (no abortado todavía)
        expect(receivedSignal).toBeDefined();
        expect(receivedSignal.aborted).toBe(false);

        // Abortar desde afuera cancela el fetch en vuelo
        controller.abort();
        expect(await assertion).toBe('rejected:AbortError');
    });
});
