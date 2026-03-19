# hilma-mcp

MCP (Model Context Protocol) server for Finnish public procurement notices — [hankintailmoitukset.fi](https://hankintailmoitukset.fi) (Hilma).

Allows Claude and other MCP-compatible AI assistants to search and retrieve Finnish public procurement notices directly.

## Tools

### `search_notices`

Search procurement notices with flexible filters:

| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Free text search in title and description. Use `"*"` for all. |
| `cpv_codes` | string[] | CPV code filter, e.g. `["71200000", "72000000"]`. Multiple codes use OR logic. |
| `notice_type` | string | `ContractNotices` \| `ContractAwardNotices` \| `PlanNotices` |
| `procurement_type` | string | `services` \| `works` \| `supplies` |
| `procedure_type` | string | `open` \| `restricted` \| `negotiated` |
| `days` | number | Limit to notices published in the last N days |
| `hours` | number | Limit to notices published in the last N hours |
| `top` | number | Max results to return (1–100, default 20) |
| `skip` | number | Skip first N results (pagination) |
| `order_by` | string | Sort order, e.g. `"datePublished desc"` |

### `get_notice`

Retrieve full eForms XML data for a single notice by its numeric ID.

| Parameter | Type | Description |
|-----------|------|-------------|
| `notice_id` | number | Numeric notice ID (noticeId) from Hilma |

## Installation

```bash
npm install
npm run build
```

## Running

```bash
npm start
# or directly:
node dist/index.js
```

## Configuration

### API Key

The server uses a default API key for the Hilma AVP API. You can override it with an environment variable:

```bash
HILMA_API_KEY=your_key_here node dist/index.js
```

Get your own API key at: https://hns-hilma-prod-apim.developer.azure-api.net/

## Adding to Claude Desktop / Claude Code

Add this to your MCP config (`claude_desktop_config.json` or `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "hilma": {
      "command": "node",
      "args": ["/absolute/path/to/hilma-mcp/dist/index.js"],
      "env": {
        "HILMA_API_KEY": "your_key_here"
      }
    }
  }
}
```

Or with `npx` if published to npm:

```json
{
  "mcpServers": {
    "hilma": {
      "command": "npx",
      "args": ["hilma-mcp"]
    }
  }
}
```

## API Reference

Based on the [Hilma API](https://github.com/Hankintailmoitukset/hilma-api).

- Search endpoint: `POST https://api.hankintailmoitukset.fi/avp/eformnotices/docs/search`
- Notice endpoint: `GET https://api.hankintailmoitukset.fi/avp/eformnotices/docs/{noticeId}`
- Authentication: `Ocp-Apim-Subscription-Key` header

## License

MIT
