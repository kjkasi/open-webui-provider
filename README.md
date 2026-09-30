# pi-open-webui-provider

A Pi package that discovers the models available from one Open WebUI instance and exposes them in Pi's `/model` picker.

## Installation

Install the package through Pi:

```bash
pi install npm:pi-open-webui-provider
```

For local development, run Pi's installer from the cloned repository:

```bash
cd /path/to/pi-open-webui-provider
pi install .
```

Use `pi install --local .` to register the package only for the current project in `.pi/settings.json`.

Set the environment variables **before Pi starts**:

```bash
OPEN_WEBUI_BASE_URL=http://localhost:3000 \
OPEN_WEBUI_API_KEY=... \
pi
```

`OPEN_WEBUI_BASE_URL` is the Open WebUI origin, and `OPEN_WEBUI_API_KEY` is a Bearer API key created by Open WebUI. The variables are read at startup and again when the model catalog is refreshed.

Open `/model` to refresh the live catalog and select a discovered chat model. Use `/reload` after changing extension code or the runtime configuration.

## What it supports

- One Open WebUI instance per Pi process.
- Live discovery from `GET <base>/api/models`.
- Chat requests through Pi's built-in `openai-completions` implementation at `<base>/api`.
- Vision and reasoning metadata when Open WebUI reports those capabilities.
- Models use zero cost metadata by default; Open WebUI billing is not inferred by this package.

Models without usable optional metadata still appear with a 32,000-token context window and a 4,096-token output limit. Duplicate IDs keep the first catalog entry.

## Security and data handling

The API key is passed as a Bearer credential. The package does not log the API key or include it in package errors. Error response excerpts are sanitized, redacted, and limited to 500 characters. Requests are made only to the explicitly configured base URL.

The package does not persist credentials or the live model catalog in `auth.json`, `models.json`, project settings, or another package store. A failed refresh is reported as an error rather than silently replacing the catalog with an empty list.

## Scope

This first version does not support multiple profiles, OAuth login, anonymous authentication, allowlists, persistent/offline catalogs, custom streaming, retries, or Open WebUI server-side `tool_ids` configuration.
