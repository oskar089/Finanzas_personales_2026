# AI Provider Configuration Specification

## Purpose

Multi-provider AI settings: UI, persistence, adapter layer, and test-connection flow. Replaces hardcoded Ollama config with a provider-agnostic system supporting Local (OpenAI-compatible), OpenAI, Google Gemini, and Anthropic Claude.

## Requirements

### Requirement: Provider Selection and Configuration

The system MUST present a settings modal allowing users to select an AI provider and enter provider-specific configuration (base URL, API key, model).

#### Scenario: Open settings modal

- GIVEN the app is loaded and the user is authenticated
- WHEN the user clicks the "⚙️ IA" navbar button
- GIVEN NO saved settings exist
- WHEN the settings modal opens
- THEN the provider dropdown shows: "Local (OpenAI-compatible)", "OpenAI", "Google Gemini", "Claude"
- AND the default selection is "Local (OpenAI-compatible)"
- AND the base URL field defaults to "http://localhost:11434"

#### Scenario: Save settings for a cloud provider

- GIVEN the settings modal is open
- WHEN the user selects "OpenAI", enters a valid API key and model name
- AND clicks Save
- THEN settings are persisted to IndexedDB `aiSettings` store AND localStorage fallback
- AND subsequent AI calls use the saved provider configuration

#### Scenario: Close modal without saving

- GIVEN the settings modal is open with unsaved changes
- WHEN the user clicks Cancel or the modal backdrop
- THEN no settings are persisted
- AND the modal closes

### Requirement: Provider Adapter Layer

The system MUST use a unified adapter pattern where each provider implements `chatCompletion()` accepting OpenAI-format messages and returning a normalized `{ text }` wrapper (adapters read provider-native fields internally before wrapping).

#### Scenario: Local provider chat completion

- GIVEN the active provider is "Local (OpenAI-compatible)" with baseUrl "http://localhost:11434"
- WHEN `chatCompletion({ model, messages })` is called
- THEN the system POSTs to `{baseUrl}/v1/chat/completions` with `{ model, messages, stream: false }`
- AND the response is normalized into the `{ text }` wrapper

#### Scenario: Gemini API format translation

- GIVEN the active provider is "Google Gemini"
- WHEN `chatCompletion({ model, messages })` is called
- THEN the system translates messages to Gemini `generateContent` format
- AND sends POST to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}`
- AND translates the response back into the `{ text }` wrapper

#### Scenario: Claude API format translation

- GIVEN the active provider is "Claude"
- WHEN `chatCompletion({ model, messages })` is called
- THEN the system sends POST to `https://api.anthropic.com/v1/messages` with headers `x-api-key` and `anthropic-version`
- AND translates the response back into the `{ text }` wrapper

### Requirement: Model Discovery

The system SHOULD attempt to discover available models for OpenAI-compatible providers via the `/v1/models` endpoint.

#### Scenario: Successful model discovery

- GIVEN the active provider is "Local (OpenAI-compatible)" with a reachable base URL
- WHEN the settings modal requests model list
- THEN the system GETs `{baseUrl}/v1/models`
- AND populates the model dropdown with discovered model IDs
- AND the user can select a discovered model

#### Scenario: Model discovery failure

- GIVEN the active provider is "Local (OpenAI-compatible)"
- WHEN the `/v1/models` endpoint is unreachable or returns an error
- THEN the system shows a text input for manual model name entry
- AND does NOT block saving settings

### Requirement: Test Connection

The system MUST provide a "Test Connection" button that validates provider reachability before saving.

#### Scenario: Successful connection test

- GIVEN the user has entered valid provider credentials
- WHEN the user clicks "Test Connection"
- THEN the system sends a minimal request to the provider endpoint
- AND displays a success indicator (checkmark or green badge)
- AND enables the Save button

#### Scenario: Failed connection test

- GIVEN the user has entered invalid or unreachable provider credentials
- WHEN the user clicks "Test Connection"
- THEN the system displays an error message describing the failure
- AND the Save button remains enabled (user may save anyway)

### Requirement: Settings Persistence

The system MUST persist settings in IndexedDB with a localStorage fallback. Settings MUST survive page reloads and browser restarts.

#### Scenario: IndexedDB persistence

- GIVEN the user saves provider settings
- WHEN the page is reloaded
- THEN `getActiveProvider()` reads settings from IndexedDB `aiSettings` store
- AND the configured provider is active

#### Scenario: localStorage fallback

- GIVEN IndexedDB is unavailable or corrupted
- WHEN the system loads settings
- THEN it reads from localStorage key `finanzas:ai-settings:v1`
- AND the configured provider is active

### Requirement: Backward Compatibility

The system MUST default to Ollama at `localhost:11434` with no API key when no settings have been saved, preserving current behavior.

#### Scenario: Fresh install default

- GIVEN the app is installed fresh with no saved settings
- WHEN auto-categorization or financial analysis runs
- THEN the system uses Ollama at `http://localhost:11434` with the existing default model
- AND behavior is identical to the pre-change application

## Non-Functional Requirements

- All provider API keys MUST remain client-side (never transmitted to any third-party server beyond the provider itself)
- Settings modal MUST be responsive and functional on mobile viewports
- DB migration from v4 to v5 MUST be additive only (new `aiSettings` store) with zero data loss on existing stores
- Provider adapters MUST normalize every provider response into a unified `{ text }` wrapper for downstream consumers (e.g. `app.js` reads `response.text`; adapters read provider-native fields like `choices[0].message.content` internally before wrapping)

## Out of Scope

- Streaming responses (current sync fetch pattern preserved)
- Provider cost tracking or usage metering
- Multi-user profiles or settings export/import
- OAuth flows — all providers use API key authentication
- Model fine-tuning or prompt customization per provider
