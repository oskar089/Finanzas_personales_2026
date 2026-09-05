// =====================================================================
// FINANZAS PERSONALES 2026 - AI Provider Adapters
// =====================================================================
// Unified adapter layer for multi-provider AI chat completion.
// All providers normalize to OpenAI chat format internally.
// API: chatCompletion(), discoverModels(), testConnection(), getActiveProvider()
// =====================================================================

// --- Provider config map -----------------------------------------------

const PROVIDERS = {
    local: {
        name: 'Local (OpenAI-compatible)',
        baseUrl: 'http://localhost:11434',
        chatEndpoint: '/v1/chat/completions',
        modelsEndpoint: '/v1/models'
    },
    openai: {
        name: 'OpenAI',
        baseUrl: 'https://api.openai.com',
        chatEndpoint: '/v1/chat/completions',
        modelsEndpoint: '/v1/models'
    },
    gemini: {
        name: 'Google Gemini',
        baseUrl: 'https://generativelanguage.googleapis.com',
        chatEndpoint: null,
        modelsEndpoint: null
    },
    claude: {
        name: 'Claude',
        baseUrl: 'https://api.anthropic.com',
        chatEndpoint: '/v1/messages',
        modelsEndpoint: null
    }
};

const DEFAULT_SETTINGS = {
    provider: 'local',
    baseUrl: 'http://localhost:11434',
    apiKey: '',
    model: 'gemma3:4b'
};

// --- Storage dependency (injected or auto-resolved) ---------------------

let _storage = null;

function getStorage() {
    if (_storage) return _storage;
    if (typeof require === 'function') {
        _storage = require('./storage.js');
    } else if (typeof window !== 'undefined' && window.storage) {
        _storage = window.storage;
    }
    return _storage;
}

// --- Core: getActiveProvider -------------------------------------------

async function getActiveProvider() {
    const storage = getStorage();
    if (!storage || !storage.loadAiSettings) {
        return { ...DEFAULT_SETTINGS };
    }
    const settings = await storage.loadAiSettings();
    if (!settings) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...settings };
}

// --- Timeout -----------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15000;

// Fetch con AbortController: si el proveedor no responde en `timeoutMs`,
// aborta la petición y rechaza con un error accionable (evita cuelgues de minutos).
async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
        if (controller.signal.aborted) {
            throw new Error(`La petición a la IA tardó más de ${Math.round(timeoutMs / 1000)}s y se canceló.`);
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}

// --- Adapter: OpenAI-compatible (local + openai) -----------------------

async function openaiCompatibleFetch(settings, messages, opts = {}) {
    const { temperature = 0.3, max_tokens = 500, timeout = DEFAULT_TIMEOUT_MS } = opts;
    const url = `${settings.baseUrl}/v1/chat/completions`;
    const headers = { 'Content-Type': 'application/json' };
    if (settings.apiKey) {
        headers['Authorization'] = `Bearer ${settings.apiKey}`;
    }

    const body = {
        model: settings.model,
        messages,
        stream: false,
        temperature,
        max_tokens
    };

    const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    }, timeout);

    if (!res.ok) {
        throw new Error(`OpenAI-compatible request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    return { text: data.choices[0].message.content };
}

// --- Adapter: Gemini ---------------------------------------------------

function geminiTranslateMessages(messages) {
    const contents = [];
    let systemInstruction = null;

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemInstruction = { parts: [{ text: msg.content }] };
        } else {
            contents.push({
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content }]
            });
        }
    }

    return { contents, systemInstruction };
}

async function geminiFetch(settings, messages, opts = {}) {
    const { temperature = 0.3, max_tokens = 500, timeout = DEFAULT_TIMEOUT_MS } = opts;
    const { contents, systemInstruction } = geminiTranslateMessages(messages);

    const url = `${settings.baseUrl}/v1beta/models/${settings.model}:generateContent?key=${settings.apiKey}`;

    const body = {
        contents,
        generationConfig: {
            temperature,
            maxOutputTokens: max_tokens
        }
    };

    if (systemInstruction) {
        body.systemInstruction = systemInstruction;
    }

    const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    }, timeout);

    if (!res.ok) {
        throw new Error(`Gemini request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { text };
}

// --- Adapter: Claude ---------------------------------------------------

async function claudeFetch(settings, messages, opts = {}) {
    const { temperature = 0.3, max_tokens = 500, timeout = DEFAULT_TIMEOUT_MS } = opts;

    let systemPrompt = null;
    const claudeMessages = [];

    for (const msg of messages) {
        if (msg.role === 'system') {
            systemPrompt = msg.content;
        } else {
            claudeMessages.push({ role: msg.role, content: msg.content });
        }
    }

    const headers = {
        'Content-Type': 'application/json',
        'x-api-key': settings.apiKey,
        'anthropic-version': '2023-06-01'
    };

    const body = {
        model: settings.model,
        messages: claudeMessages,
        max_tokens,
        temperature
    };

    if (systemPrompt) {
        body.system = systemPrompt;
    }

    const res = await fetchWithTimeout(`${settings.baseUrl}/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    }, timeout);

    if (!res.ok) {
        throw new Error(`Claude request failed: ${res.status} ${res.statusText}`);
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    return { text };
}

// --- Internal: dispatch with explicit settings -------------------------

async function _dispatchWithSettings(settings, messages, opts) {
    switch (settings.provider) {
        case 'local':
        case 'openai':
            return openaiCompatibleFetch(settings, messages, opts);
        case 'gemini':
            return geminiFetch(settings, messages, opts);
        case 'claude':
            return claudeFetch(settings, messages, opts);
        default:
            throw new Error(`Unknown provider: ${settings.provider}`);
    }
}

// --- Public: chatCompletion --------------------------------------------

async function chatCompletion(messages, opts = {}) {
    const settings = await getActiveProvider();
    return _dispatchWithSettings(settings, messages, opts);
}

// --- Public: discoverModels --------------------------------------------

async function discoverModels(settings) {
    const providerConfig = PROVIDERS[settings.provider];
    if (!providerConfig || !providerConfig.modelsEndpoint) {
        return [];
    }

    try {
        const url = `${settings.baseUrl}${providerConfig.modelsEndpoint}`;
        const headers = {};
        if (settings.apiKey) {
            headers['Authorization'] = `Bearer ${settings.apiKey}`;
        }

        const res = await fetchWithTimeout(url, { headers }, 8000);
        if (!res.ok) return [];

        const data = await res.json();
        const models = data.data || data.models || [];
        return models.map(m => m.id || m.name).filter(Boolean);
    } catch {
        return [];
    }
}

// --- Public: testConnection --------------------------------------------

async function testConnection(settings) {
    try {
        const testMessages = [{ role: 'user', content: 'Hi' }];
        await _dispatchWithSettings(settings, testMessages, { max_tokens: 5, timeout: 10000 });
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

// --- Exports ------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        PROVIDERS,
        DEFAULT_SETTINGS,
        DEFAULT_TIMEOUT_MS,
        fetchWithTimeout,
        getActiveProvider,
        chatCompletion,
        openaiCompatibleFetch,
        geminiTranslateMessages,
        geminiFetch,
        claudeFetch,
        discoverModels,
        testConnection
    };
}

if (typeof window !== 'undefined') {
    window.aiProviders = {
        PROVIDERS,
        DEFAULT_SETTINGS,
        getActiveProvider,
        chatCompletion,
        discoverModels,
        testConnection
    };
}
