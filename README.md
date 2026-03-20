# hilma-mcp

MCP (Model Context Protocol) -serveri Suomen julkisille hankintailmoituksille — [hankintailmoitukset.fi](https://hankintailmoitukset.fi) (Hilma).

Mahdollistaa hankintailmoitusten haun suoraan Claude-assistentista ilman erillistä selainta.

> **Kieliversio:** Ohjeet suomeksi alla. English instructions further down.

---

## Vaatimukset

- [Node.js](https://nodejs.org/) versio 18 tai uudempi
- Claude Desktop tai Claude Cowork (MCP-tuki)
- Hilma AVP API -avain (ks. alla)

---

## Asennus

### 1. Kloonaa repo

```bash
git clone https://github.com/Aimiten/hilma-mcp.git
cd hilma-mcp
```

### 2. Asenna riippuvuudet ja buildaa

```bash
npm install
npm run build
```

Tämä luo `dist/index.js`-tiedoston, jota Claude ajaa.

### 3. Luo .env-tiedosto

```bash
cp .env.example .env
```

Avaa `.env` tekstieditorissa ja lisää API-avaimesi:

```
HILMA_API_KEY=oma-avp-read-avain-tähän
HILMA_READ_API_KEY=oma-avp-read-avain-tähän
```

> **Huom:** Molemmat kentät käyttävät **samaa avainta** — `avp-read`-tuote sisältää jo Read API (EForms) -rajapinnan, joten erillistä tilausta ei tarvita.

Hanki avain ilmaiseksi:
1. Mene osoitteeseen https://hns-hilma-prod-apim.developer.azure-api.net/
2. Rekisteröidy tai kirjaudu → **Products → avp-read → Subscribe**
3. Kopioi Primary key Profile-sivulta

> **Huom:** `.env`-tiedostoa ei koskaan commitoida GitHubiin — se on jo `.gitignore`:ssa.

### 4. Lisää Claude-konfiguraatioon

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

Serveri **vaatii** oman API-avaimen — sitä ei ole bundlattu koodiin tietoturvasyistä.

1. Rekisteröidy ilmaiseksi: https://hns-hilma-prod-apim.developer.azure-api.net/
2. Lisää avain `.env`-tiedostoon (suositeltu):
   ```
   HILMA_API_KEY=oma-avaimesi-tähän
   ```
3. Tai anna se suoraan Claude-konfiguraatiossa:
   ```json
   {
     "mcpServers": {
       "hilma": {
         "command": "node",
         "args": ["/polku/hilma-mcp/dist/index.js"],
         "env": {
           "HILMA_API_KEY": "oma-avaimesi-tähän"
         }
       }
     }
   }
   ```

---

## Työkalut

| Työkalu | Kuvaus | Vaatii |
|---------|--------|--------|
| `search_notices` | Hae ilmoituksia CPV-koodeilla, hakusanalla, päivämäärällä | HILMA_API_KEY |
| `get_notice_summary` | Yksittäisen ilmoituksen metatiedot noticeId:llä | HILMA_API_KEY |
| `get_expiring_soon` | Ilmoitukset joiden deadline on N päivän sisällä | HILMA_API_KEY |
| `get_notice_full` | Täysi eForms XML + yhteystiedot (BT-502/503/506) | HILMA_READ_API_KEY |

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

### `get_notice_summary` — Yksittäisen ilmoituksen yhteenveto

| Parametri | Tyyppi | Kuvaus |
|-----------|--------|--------|
| `notice_id` | number | Ilmoituksen numeerinen ID |

Käyttää search-APIa — ei vaadi erillistä tilausta. Palauttaa kaikki metatiedot: tilaaja, deadline, arvo, CPV, portaali-URL.

### `get_expiring_soon` — Lähestyvät deadlinet

| Parametri | Tyyppi | Kuvaus |
|-----------|--------|--------|
| `days` | number | Hae deadlinet seuraavan N päivän sisällä |
| `cpv_codes` | string[] | Rajaa CPV-koodeilla (valinnainen) |

Järjestää tulokset deadlinen mukaan nousevaan järjestykseen.

### `get_notice_full` — Täydet tiedot eForms XML:stä

| Parametri | Tyyppi | Kuvaus |
|-----------|--------|--------|
| `notice_id` | number | Ilmoituksen numeerinen ID |

**Vaatii HILMA_READ_API_KEY** (sama avain kuin HILMA_API_KEY — sisältyy `avp-read`-tilaukseen). Palauttaa:
- Yhteystiedot: BT-502 (nimi), BT-503 (sähköposti), BT-506 (puhelin)
- Tarjousportaalin URL:t
- Koko eForms XML -raakadata

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
git clone https://github.com/Aimiten/hilma-mcp.git
cd hilma-mcp
npm install && npm run build
cp .env.example .env   # then add your API key to .env
```

Get a free API key at: https://hns-hilma-prod-apim.developer.azure-api.net/

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

---

## Lisenssi / License

MIT
