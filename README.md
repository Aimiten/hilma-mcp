# hilma-mcp

MCP (Model Context Protocol) -serveri Suomen julkisille hankintailmoituksille — [hankintailmoitukset.fi](https://hankintailmoitukset.fi) (Hilma).

Mahdollistaa hankintailmoitusten haun suoraan Claude-assistentista ilman erillistä selainta.

> **Kieliversio:** Ohjeet suomeksi alla. English instructions further down.

---

## Vaatimukset

- [Node.js](https://nodejs.org/) versio 18 tai uudempi
- Claude Desktop tai Claude Code (MCP-tuki)
- Hilma AVP API -avain (ks. alla)

---

## Asennus

### 1. Kloonaa repo

```bash
git clone https://github.com/SINUN-ORG/hilma-mcp.git
cd hilma-mcp
```

### 2. Asenna riippuvuudet ja buildaa

```bash
npm install
npm run build
```

Tämä luo `dist/index.js`-tiedoston, jota Claude ajaa.

### 3. Lisää Claude-konfiguraatioon

Avaa Claude Desktopin konfiguraatiotiedosto:

| Käyttöjärjestelmä | Polku |
|-------------------|-------|
| **macOS** | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| **Windows** | `%APPDATA%\Claude\claude_desktop_config.json` |

Lisää tai muokkaa `mcpServers`-osiota:

```json
{
  "mcpServers": {
    "hilma": {
      "command": "node",
      "args": ["/ABSOLUUTTINEN/POLKU/hilma-mcp/dist/index.js"]
    }
  }
}
```

**Tärkeää:** Korvaa `/ABSOLUUTTINEN/POLKU/hilma-mcp` oikealla polulla omalla koneellasi. Esimerkiksi:
- macOS: `/Users/sinunnimesi/hilma-mcp/dist/index.js`
- Windows: `C:\\Users\\sinunnimesi\\hilma-mcp\\dist\\index.js`

### 4. Käynnistä Claude uudelleen

Hilma ilmestyy connectors-listaan uudelleenkäynnistyksen jälkeen.

---

## API-avain

Serverissä on sisäänrakennettu oletusavain testausta varten. **Jos aiot käyttää tuotannossa tai jakaa eteenpäin, hanki oma avain:**

1. Rekisteröidy osoitteessa: https://hns-hilma-prod-apim.developer.azure-api.net/
2. Aseta avain ympäristömuuttujana:

```json
{
  "mcpServers": {
    "hilma": {
      "command": "node",
      "args": ["/polku/hilma-mcp/dist/index.js"],
      "env": {
        "HILMA_API_KEY": "OMA-AVAIMESI-TÄHÄN"
      }
    }
  }
}
```

---

## Työkalut

### `search_notices` — Hankintailmoitusten haku

| Parametri | Tyyppi | Kuvaus |
|-----------|--------|--------|
| `search` | string | Vapaatekstihaku. `"*"` = kaikki. |
| `cpv_codes` | string[] | CPV-koodit, esim. `["71200000", "72000000"]`. OR-logiikka. |
| `notice_type` | string | `ContractNotices` / `ContractAwardNotices` / `PlanNotices` |
| `procurement_type` | string | `services` / `works` / `supplies` |
| `procedure_type` | string | `open` / `restricted` / `negotiated` |
| `days` | number | Viimeiset N päivää |
| `hours` | number | Viimeiset N tuntia |
| `top` | number | Max tuloksia (1–100, oletus 20) |

### `get_notice` — Yksittäinen ilmoitus

| Parametri | Tyyppi | Kuvaus |
|-----------|--------|--------|
| `notice_id` | number | Ilmoituksen numeerinen ID |

---

## API-viite

Perustuu viralliseen [Hilma API](https://github.com/Hankintailmoitukset/hilma-api) -dokumentaatioon.

- Hakuendpoint: `POST https://api.hankintailmoitukset.fi/avp/eformnotices/docs/search`
- Yksittäinen ilmoitus: `GET https://api.hankintailmoitukset.fi/avp/eformnotices/docs/{noticeId}`
- Autentikointi: `Ocp-Apim-Subscription-Key` -header

---

## English

### Quick install

```bash
git clone https://github.com/YOUR-ORG/hilma-mcp.git
cd hilma-mcp
npm install && npm run build
```

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "hilma": {
      "command": "node",
      "args": ["/absolute/path/to/hilma-mcp/dist/index.js"]
    }
  }
}
```

Restart Claude. The Hilma connector will appear in the connectors list.

### Own API key

A default key is bundled for testing. For production use, register at https://hns-hilma-prod-apim.developer.azure-api.net/ and pass your key via the `HILMA_API_KEY` environment variable in the MCP config.

---

## Lisenssi / License

MIT
