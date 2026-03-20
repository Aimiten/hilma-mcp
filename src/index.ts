#!/usr/bin/env node
/**
 * Hilma MCP Server
 * MCP server for Finnish public procurement notices (hankintailmoitukset.fi)
 *
 * Tools:
 *  - search_notices:     Search procurement notices with filters
 *  - get_notice_summary: Get a formatted summary of a single notice by ID (search API)
 *  - get_notice_full:    Get full eForms XML incl. BT-502/503 contacts (requires avp-read-eforms-api)
 *  - get_expiring_soon:  Get notices whose deadline falls within N days
 */

// MCP stdio -yhteensopivuus: dotenv v17 tulostaa stdoutiin joka rikkoo JSON-protokollan
const _origWrite = process.stdout.write.bind(process.stdout);
(process.stdout as any).write = function(chunk: any, enc?: any, cb?: any): boolean {
  const s = Buffer.isBuffer(chunk) ? chunk.toString() : String(chunk);
  if (s.startsWith("[dotenv")) { if (typeof enc === "function") enc(); else if (typeof cb === "function") cb(); return true; }
  return _origWrite(chunk, enc, cb);
};

import * as dotenv from "dotenv";
import * as path from "path";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Etsi .env suhteessa tähän tiedostoon — toimii riippumatta siitä mistä Claude käynnistää serverin
dotenv.config({ path: path.join(__dirname, "..", ".env") });

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HILMA_SEARCH_URL =
  "https://api.hankintailmoitukset.fi/avp/eformnotices/docs/search";
// get_notice_full käyttää EForms Read API:a — sama avp-read -tilaus kattaa tämän.
// Endpoint: GET /avp-eforms/external-read/v1/notice/{noticeId}
// Palauttaa JSON:ia jossa eForm-kenttä on Base64-enkoodattu XML.
const HILMA_EFORMS_URL =
  "https://api.hankintailmoitukset.fi/avp-eforms/external-read/v1/notice";

const API_KEY = process.env.HILMA_API_KEY;
if (!API_KEY) {
  process.stderr.write(
    "Virhe: HILMA_API_KEY puuttuu. Lisää se .env-tiedostoon tai ympäristömuuttujana.\n" +
    "Rekisteröi avain: https://hns-hilma-prod-apim.developer.azure-api.net/\n"
  );
  process.exit(1);
}

// Erillinen avain get_notice_full:lle — valinnainen, toimii ilmankin (antaa selkeän virheen)
const READ_API_KEY = process.env.HILMA_READ_API_KEY;

const HEADERS: Record<string, string> = {
  "Ocp-Apim-Subscription-Key": API_KEY!,
  "Content-Type": "application/json",
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchParams {
  search?: string;
  cpv_codes?: string[];
  notice_type?: "ContractNotices" | "ContractAwardNotices" | "PlanNotices";
  procurement_type?: "services" | "works" | "supplies";
  procedure_type?: "open" | "restricted" | "negotiated";
  days?: number;
  hours?: number;
  top?: number;
  skip?: number;
  order_by?: string;
}

interface HilmaNotice {
  noticeId: number;
  titleFi?: string;
  titleSv?: string;
  titleEn?: string;
  organisationNameFi?: string;
  organisationNationalRegistrationNumber?: string;
  descriptionFi?: string;
  cpvCodes?: string;
  mainType?: string;
  datePublished?: string;
  expirationDate?: string;
  nutsCodes?: string[];
  procedureType?: string;
  procurementTypeCode?: string;
  estimatedValue?: number;
  eFormsId?: string;
  procedureId?: number;
  procurementDocumentsUrl?: string;
  sendingSystem?: string;
}

interface SearchResponse {
  "@odata.count"?: number;
  value: HilmaNotice[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildFilter(params: SearchParams): string {
  const parts: string[] = [];

  if (params.cpv_codes && params.cpv_codes.length > 0) {
    const cpvParts = params.cpv_codes.map(
      (code) => `search.ismatch('${code}', 'cpvCodes')`
    );
    parts.push(
      cpvParts.length === 1 ? cpvParts[0] : `(${cpvParts.join(" or ")})`
    );
  }

  if (params.notice_type) {
    parts.push(`mainType eq '${params.notice_type}'`);
  }

  if (params.procurement_type) {
    parts.push(`procurementTypeCode eq '${params.procurement_type}'`);
  }

  if (params.procedure_type) {
    parts.push(`procedureType eq '${params.procedure_type}'`);
  }

  if (params.hours && params.hours > 0) {
    const cutoff = new Date(Date.now() - params.hours * 60 * 60 * 1000);
    parts.push(`datePublished ge ${cutoff.toISOString()}`);
  } else if (params.days && params.days > 0) {
    const cutoff = new Date(Date.now() - params.days * 24 * 60 * 60 * 1000);
    parts.push(`datePublished ge ${cutoff.toISOString()}`);
  }

  return parts.join(" and ");
}

function formatNotice(n: HilmaNotice): string {
  const lines: string[] = [];
  lines.push(`### ${n.noticeId}: ${n.titleFi ?? n.titleEn ?? "(no title)"}`);
  if (n.organisationNameFi)
    lines.push(`**Hankintayksikkö:** ${n.organisationNameFi}`);
  if (n.organisationNationalRegistrationNumber)
    lines.push(`**Y-tunnus:** ${n.organisationNationalRegistrationNumber}`);
  if (n.datePublished)
    lines.push(
      `**Julkaistu:** ${new Date(n.datePublished).toLocaleDateString("fi-FI")}`
    );
  if (n.expirationDate)
    lines.push(
      `**Deadline:** ${new Date(n.expirationDate).toLocaleDateString("fi-FI")}`
    );
  if (n.mainType) lines.push(`**Tyyppi:** ${n.mainType}`);
  if (n.procurementTypeCode)
    lines.push(`**Hankintalaji:** ${n.procurementTypeCode}`);
  if (n.procedureType) lines.push(`**Menettely:** ${n.procedureType}`);
  if (n.cpvCodes) lines.push(`**CPV-koodit:** ${n.cpvCodes}`);
  if (n.nutsCodes && n.nutsCodes.length > 0)
    lines.push(`**Alue (NUTS):** ${n.nutsCodes.join(", ")}`);
  if (n.estimatedValue)
    lines.push(
      `**Arvioitu arvo:** ${n.estimatedValue.toLocaleString("fi-FI")} €`
    );
  if (n.procurementDocumentsUrl)
    lines.push(`**Tarjousportaali:** ${n.procurementDocumentsUrl}`);
  if (n.descriptionFi) {
    const desc =
      n.descriptionFi.length > 500
        ? n.descriptionFi.slice(0, 500) + "…"
        : n.descriptionFi;
    lines.push(`**Kuvaus:** ${desc}`);
  }
  lines.push(
    `**Hilma-linkki:** https://hankintailmoitukset.fi/fi/notice/${n.eFormsId ?? n.noticeId}`
  );
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// API calls
// ---------------------------------------------------------------------------

async function searchNotices(params: SearchParams): Promise<string> {
  const filter = buildFilter(params);
  const body: Record<string, unknown> = {
    search: params.search && params.search.trim() ? params.search.trim() : "*",
    top: params.top ?? 20,
    count: true,
    orderby: params.order_by ?? "datePublished desc",
    searchMode: "any",
    queryType: "simple",
    select: "noticeId,titleFi,organisationNameFi,organisationNationalRegistrationNumber,cpvCodes,nutsCodes,datePublished,expirationDate,estimatedValue,procedureType,procurementTypeCode,mainType,eFormsId,procurementDocumentsUrl,sendingSystem,descriptionFi",
  };
  if (filter) body.filter = filter;
  if (params.skip) body.skip = params.skip;

  const res = await fetch(HILMA_SEARCH_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Hilma API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as SearchResponse;
  const total = data["@odata.count"] ?? data.value.length;
  const notices = data.value;

  if (notices.length === 0) {
    return "Ei tuloksia annetuilla hakuehdoilla.";
  }

  const summary = [`**Löydettiin ${total} ilmoitusta** (näytetään ${notices.length})`, ""];
  notices.forEach((n) => {
    summary.push(formatNotice(n));
    summary.push("");
  });

  return summary.join("\n");
}

async function getNoticeSummary(noticeId: number): Promise<string> {
  // Hakee yksittäisen ilmoituksen search-API:n kautta (ei vaadi erillistä tilausta)
  const body = {
    search: "*",
    filter: `noticeId eq ${noticeId}`,
    top: 1,
    select: "noticeId,titleFi,organisationNameFi,organisationNationalRegistrationNumber,cpvCodes,nutsCodes,datePublished,expirationDate,estimatedValue,procedureType,procurementTypeCode,mainType,eFormsId,procurementDocumentsUrl,sendingSystem,descriptionFi",
  };

  const res = await fetch(HILMA_SEARCH_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Hilma API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as SearchResponse;

  if (data.value.length === 0) {
    return `Ilmoitusta noticeId=${noticeId} ei löydy Hilmasta.`;
  }

  return formatNotice(data.value[0]);
}

async function getNoticeFullXml(noticeId: number): Promise<string> {
  const key = READ_API_KEY || API_KEY;

  // EForms Read API: GET /avp-eforms/external-read/v1/notice/{noticeId}
  // Palauttaa JSON:n jossa eForm-kenttä on Base64-enkoodattu eForms XML
  const res = await fetch(`${HILMA_EFORMS_URL}/${noticeId}`, {
    headers: {
      "Ocp-Apim-Subscription-Key": key!,
      "Accept": "application/json",
    },
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `Hilma API 403: Tarkista että HILMA_API_KEY on voimassa ja tilauksesi kattaa avp-read-eforms-api:n. ` +
        `Rekisteröi: https://hns-hilma-prod-apim.developer.azure-api.net/ → Products → avp-read-eforms`
      );
    }
    if (res.status === 404) {
      throw new Error(`Ilmoitusta noticeId=${noticeId} ei löydy EForms API:sta (404).`);
    }
    throw new Error(`Hilma EForms API error: ${res.status} ${res.statusText}`);
  }

  const data = await res.json() as { id: number; procedureId?: number; eForm?: string };

  if (!data.eForm) {
    throw new Error(`Ilmoituksella ${noticeId} ei ole eForm XML:ää (kenttä puuttuu).`);
  }

  // Dekoodaa Base64 → XML
  const xml = Buffer.from(data.eForm, "base64").toString("utf-8");

  // Poimii yhteystiedot BT-502 / BT-503 / BT-506 XML:stä
  const extractAll = (tag: string): string[] => {
    const matches = xml.matchAll(new RegExp(`<cbc:${tag}[^>]*>([^<]+)<\\/cbc:${tag}>`, "gi"));
    return [...matches].map(m => m[1].trim());
  };

  const contactNames  = extractAll("ContactName");
  const contactEmails = extractAll("ElectronicMail");
  const contactPhones = extractAll("Telephone");

  // Tarjousportaalin URL:t
  const urlMatches = xml.matchAll(/<cbc:URI>([^<]+)<\/cbc:URI>/g);
  const urls = [...urlMatches].map(m => m[1]).filter(u => u.startsWith("http"));

  const lines: string[] = [
    `## Ilmoitus ${noticeId} — täydet tiedot (eForms XML)`,
    "",
    `**Hilma-linkki:** https://hankintailmoitukset.fi/fi/notice/${data.id}`,
    `**ProcedureId:** ${data.procedureId ?? "?"}`,
    `**XML-koko:** ${Math.round(xml.length / 1024)} kt`,
    "",
  ];

  if (contactNames.length > 0 || contactEmails.length > 0) {
    lines.push("### Yhteystiedot (BT-502/503/506)");
    contactNames.forEach((n, i) => {
      lines.push(`- **Nimi:** ${n}`);
      if (contactEmails[i]) lines.push(`  **Sähköposti:** ${contactEmails[i]}`);
      if (contactPhones[i]) lines.push(`  **Puhelin:** ${contactPhones[i]}`);
    });
    lines.push("");
  }

  if (urls.length > 0) {
    lines.push("### Tarjousportaalin linkit");
    urls.slice(0, 5).forEach(u => lines.push(`- ${u}`));
    lines.push("");
  }

  lines.push("### XML (ensimmäiset 4000 merkkiä)");
  lines.push("```xml");
  lines.push(xml.slice(0, 4000));
  lines.push("```");

  return lines.join("\n");
}

async function getExpiringSoon(days: number, cpv_codes?: string[]): Promise<string> {
  const now = new Date();
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

  const filterParts: string[] = [
    `expirationDate ge ${now.toISOString()}`,
    `expirationDate le ${future.toISOString()}`,
    `mainType eq 'ContractNotices'`,
  ];

  if (cpv_codes && cpv_codes.length > 0) {
    const cpvPart = cpv_codes
      .map(c => `search.ismatch('${c}', 'cpvCodes')`)
      .join(" or ");
    filterParts.push(`(${cpvPart})`);
  }

  const body = {
    search: "*",
    filter: filterParts.join(" and "),
    top: 50,
    count: true,
    orderby: "expirationDate asc",
    select: "noticeId,titleFi,organisationNameFi,cpvCodes,nutsCodes,datePublished,expirationDate,estimatedValue,procedureType,procurementTypeCode,mainType,eFormsId,procurementDocumentsUrl",
  };

  const res = await fetch(HILMA_SEARCH_URL, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`Hilma API error: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as SearchResponse;
  const total = data["@odata.count"] ?? data.value.length;
  const notices = data.value;

  if (notices.length === 0) {
    return `Ei ilmoituksia joiden deadline on seuraavan ${days} päivän sisällä.`;
  }

  const header = [
    `## Deadlinet seuraavan ${days} päivän sisällä`,
    `**${total} ilmoitusta** — järjestetty deadlinen mukaan`,
    "",
  ];

  const rows = notices.map(n => {
    const dl = n.expirationDate
      ? new Date(n.expirationDate).toLocaleDateString("fi-FI")
      : "?";
    const daysLeft = n.expirationDate
      ? Math.ceil((new Date(n.expirationDate).getTime() - now.getTime()) / 86400000)
      : "?";
    const arvo = n.estimatedValue
      ? `€${Math.round(n.estimatedValue).toLocaleString("fi-FI")}`
      : "";
    return [
      `### ${n.noticeId}: ${n.titleFi ?? "(ei nimeä)"}`,
      `**Tilaaja:** ${n.organisationNameFi ?? "?"} | **Deadline:** ${dl} (${daysLeft} pv) ${arvo}`,
      `**Portaali:** ${n.procurementDocumentsUrl ?? "—"}`,
      `**Hilma:** https://hankintailmoitukset.fi/fi/notice/${n.eFormsId ?? n.noticeId}`,
      "",
    ].join("\n");
  });

  return [...header, ...rows].join("\n");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: "hilma-mcp", version: "1.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_notices",
        description:
          "Hae hankintailmoituksia Hilmasta. Tukee vapaatekstihakua, CPV-koodisuodatusta, " +
          "aikarajausta, ilmoitustyypin ja menettelytyypin valintaa. " +
          "Palauttaa listauksen ilmoituksista otsikoineen, hankintayksikköineen ja määräaikoineen.",
        inputSchema: {
          type: "object",
          properties: {
            search: { type: "string", description: 'Vapaatekstihaku. Käytä "*" kaikkien hakemiseen.' },
            cpv_codes: { type: "array", items: { type: "string" }, description: 'CPV-koodit, esim. ["71200000"]. OR-logiikalla.' },
            notice_type: { type: "string", enum: ["ContractNotices", "ContractAwardNotices", "PlanNotices"], description: "Ilmoitustyyppi" },
            procurement_type: { type: "string", enum: ["services", "works", "supplies"], description: "Hankintalaji" },
            procedure_type: { type: "string", enum: ["open", "restricted", "negotiated"], description: "Menettelytyyppi" },
            days: { type: "number", description: "Rajaa viimeiseen N päivään" },
            hours: { type: "number", description: "Rajaa viimeiseen N tuntiin" },
            top: { type: "number", description: "Max tulosmäärä (1–100, oletus 20)" },
            skip: { type: "number", description: "Ohita N ensimmäistä (sivutus)" },
            order_by: { type: "string", description: 'Lajittelu, esim. "expirationDate asc"' },
          },
        },
      },
      {
        name: "get_notice_summary",
        description:
          "Hae yksittäisen ilmoituksen yhteenveto noticeId:llä. " +
          "Käyttää search-APIa — ei vaadi erillistä tilausta. " +
          "Palauttaa kaikki metatiedot: tilaaja, deadline, arvo, CPV, portaali-URL.",
        inputSchema: {
          type: "object",
          properties: {
            notice_id: { type: "number", description: "Ilmoituksen noticeId" },
          },
          required: ["notice_id"],
        },
      },
      {
        name: "get_notice_full",
        description:
          "Hae ilmoituksen täydet tiedot eForms XML -muodossa, mukaan lukien yhteystiedot " +
          "(BT-502 nimi, BT-503 sähköposti, BT-506 puhelin) ja tarjousportaalin linkit. " +
          "VAATII erillisen avp-read-eforms-api -tilauksen ja HILMA_READ_API_KEY .env:ssä. " +
          "Rekisteröi: https://hns-hilma-prod-apim.developer.azure-api.net/ → avp-read-eforms",
        inputSchema: {
          type: "object",
          properties: {
            notice_id: { description: "Ilmoituksen noticeId (numero)" },
          },
          required: ["notice_id"],
        },
      },
      {
        name: "get_expiring_soon",
        description:
          "Hae ilmoitukset joiden tarjousaika päättyy seuraavan N päivän sisällä. " +
          "Järjestää deadlinen mukaan nousevaan järjestykseen. " +
          "Hyödyllinen: 'mitä deadlineja on ensi viikolla', 'kiireellisimmät hankkeet'.",
        inputSchema: {
          type: "object",
          properties: {
            days: { description: "Hae deadlinet seuraavan N päivän sisällä (esim. 7, 14, 30)" },
            cpv_codes: { type: "array", items: { type: "string" }, description: "Rajaa CPV-koodeilla (valinnainen)" },
          },
          required: ["days"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "search_notices") {
      return { content: [{ type: "text", text: await searchNotices(args as SearchParams) }] };
    }
    if (name === "get_notice_summary") {
      const notice_id = Number((args as any).notice_id);
      return { content: [{ type: "text", text: await getNoticeSummary(notice_id) }] };
    }
    if (name === "get_notice_full") {
      const notice_id = Number((args as any).notice_id);
      return { content: [{ type: "text", text: await getNoticeFullXml(notice_id) }] };
    }
    if (name === "get_expiring_soon") {
      const days = Number((args as any).days);
      const cpv_codes = (args as any).cpv_codes;
      return { content: [{ type: "text", text: await getExpiringSoon(days, cpv_codes) }] };
    }

    throw new Error(`Tuntematon työkalu: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { content: [{ type: "text", text: `Virhe: ${message}` }], isError: true };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
