# Connector development

Add a row to `connectors` and a branch in `backend/src/services/runtime.js`. Do not give workflow authors a free-form query or script field.

Each connector defines:

- `id` and display name
- `config_schema_json` for non-secret settings
- `permissions_json`
- input and output format
- `timeout_ms`
- availability: `available`, `requires_robot`, or `disabled`

Connection instances live in `connections`. Put passwords and tokens in the `secret` object on create. The API encrypts that object and later responses only return `hasSecret`.

Implement `testConnection` so a failed test stores `unavailable` and a short error. A successful test stores `available`.

The MySQL connector builds SQL from an allow list. A new operation must keep identifiers quoted and values parameterized. Do not add a raw SQL operation.

Browser automation uses connector `browser_uipath` and stays unavailable until an authorized robot heartbeat is fresh.

Register the step type in `workflow/constants.js`, reject invalid config in `workflow/validate.js`, and execute it in `workflow/steps.js` through the runtime service.
