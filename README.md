# pi-open-webui-provider

A Pi package that discovers the models available from one Open WebUI instance and exposes them in Pi's `/model` picker.

## Installation

Install the package directly from Git:

```bash
pi install git:github.com/kjkasi/open-webui-provider
```

For local development, run Pi's installer from the cloned repository:

```bash
cd /path/to/pi-open-webui-provider
pi install .
```

Use `pi install --local .` to register the package only for the current project in `.pi/settings.json`.

## Setup

Start Pi and run:

```text
/login open-webui
```

Enter the **Open WebUI base URL** and **Open WebUI API token** when prompted. The URL should point to the Open WebUI server, for example `http://localhost:3000` or `https://example.com/open-webui`; do not append `/api`.

Pi stores the credential in its own authentication store. Use `/logout` to remove it. Open `/model` to refresh the live catalog and select a discovered chat model; refreshing queries Open WebUI again, so newly available models appear without restarting Pi. Use `/reload` after changing extension code.

For CI or other non-interactive use, set both environment variables before starting Pi:

```bash
OPEN_WEBUI_BASE_URL=https://example.com/open-webui \
OPEN_WEBUI_API_KEY=... \
pi
```

The environment values are used when no valid `/login` credential is available. A partial environment configuration reports the missing variable. OAuth credentials from `/login` take precedence over environment values.

## URL and connection rules

Use an `http://` or `https://` Open WebUI server URL, including a reverse-proxy path when needed. Whitespace and trailing slashes are normalized. Do not append `/api`; the provider adds that path for model discovery and chat. URLs with embedded username or password credentials are rejected.

## What it supports

- One Open WebUI instance per Pi process.
- Live discovery from `GET <base>/api/models`.
- Chat requests through Pi's built-in `openai-completions` implementation at `<base>/api`.
- Vision and reasoning metadata when Open WebUI reports those capabilities.
- Models use zero cost metadata by default; Open WebUI billing is not inferred by this package.

Models without usable optional metadata still appear with a 32,000-token context window and a 4,096-token output limit. Duplicate IDs keep the first catalog entry.

## Security and data handling

The API token is passed as a Bearer credential. Pi handles interactive credential storage; the package does not log the token or include it in package errors. Error response excerpts are sanitized, redacted, and limited to 500 characters. Requests are made only to the configured Open WebUI URL.

## Troubleshooting

- **401/403:** Open WebUI rejected the API token; check the token and its permissions.
- **404:** Check that the configured URL is the Open WebUI server URL and does not already end in `/api`.
- **Connection or HTTPS errors:** Check the URL, server availability, DNS/TLS setup, and reverse-proxy configuration.
- **429:** Open WebUI rate limiting is active; try again later.
- **5xx:** Open WebUI reported a server failure; check its server logs.

Diagnostics never include the API token. Response excerpts are control-character-stripped and bounded.

The package does not persist the live model catalog in `models.json`, project settings, or another package store. A failed refresh is reported as an error rather than silently replacing the catalog with an empty list.

## Scope

This first version does not support multiple profiles, anonymous authentication, allowlists, persistent/offline catalogs, custom streaming, retries, or Open WebUI server-side `tool_ids` configuration.
