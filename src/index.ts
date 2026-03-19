#!/usr/bin/env node
/**
 * Hilma MCP Server
 * MCP server for Finnish public procurement notices (hankintailmoitukset.fi)
 *
 * Tools:
 *  - search_notices: Search procurement notices with filters
 *  - get_notice: Get full details for a single notice by ID
 */

import * as dotenv from "dotenv";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

dotenv.config();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const HILMA_SEARCH_URL =
  "https://api.hankintailmoitukset.fi/avp/eformnotices/docs/search";
const HILMA_NOTICE_URL =
  "https://api.hankintailmoitukset.fi/avp/eformnotices/docs";

const API_KEY = process.env.HILMA_API_KEY;
if (!API_KEY) {
  process.stderr.write(
    "Virhe: HILMA_API_KEY puuttuu. Lisää se .env-tiedostoon tai ympäristömuuttujana.\n" +
    "Rekisteröi avain: https://hns-hilma-prod-apim.developer.azure-api.net/\n"
  );
  process.exit(1);
}

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
      `**Tarjousaika päättyy:** ${new Date(n.expirationDate).toLocaleDateString("fi-FI")}`
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
  if (n.descriptionFi) {
    const desc =
      n.descriptionFi.length > 500
        ? n.descriptionFi.slice(0, 500) + "…"
        : n.descriptionFi;
    lines.push(`**Kuvaus:** ${desc}`);
  }
  lines.push(
    `**Linkki:** https://hankintailmoitukset.fi/fi/notice/${n.eFormsId ?? n.noticeId}`
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

async function getNotice(noticeId: number): Promise<string> {
  const res = await fetch(`${HILMA_NOTICE_URL}/${noticeId}`, {
    headers: {
      "Ocp-Apim-Subscription-Key": API_KEY!,
      Accept: "application/xml",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Hilma API error: ${res.status} ${res.statusText} — ilmoitusta ${noticeId} ei löydy tai API-avain ei ole voimassa.`
    );
  }

  const xml = await res.text();

  // Extract key fields from XML for a readable summary
  const extract = (tag: string): string => {
    const patterns = [
      new RegExp(`<cbc:${tag}[^>]*>([^<]+)<\/cbc:${tag}>`, "i"),
      new RegExp(`<cac:${tag}[^>]*>([^<]+)<\/cac:${tag}>`, "i"),
    ];
    for (const p of patterns) {
      const m = xml.match(p);
      if (m) return m[1].trim();
    }
    return "";
  };

  // Extract document URLs
  const urlMatches = xml.matchAll(/<cbc:URI>([^<]+)<\/cbc:URI>/g);
  const urls = [...urlMatches].map((m) => m[1]).filter((u) => u.startsWith("http"));

  const lines: string[] = [
    `## Ilmoitus ${noticeId}`,
    "",
    `**Linkki:** https://hankintailmoitukset.fi/fi/notice/${noticeId}`,
    "",
    "### Raakadata (eForms XML) haettu onnistuneesti",
    `XML-tiedoston koko: ${Math.round(xml.length / 1024)} kt`,
  ];

  if (urls.length > 0) {
    lines.push("", "### Tarjousportaalin linkit");
    urls.slice(0, 5).forEach((u) => lines.push(`- ${u}`));
  }

  lines.push("", "### XML (ensimmäiset 3000 merkkiä)");
  lines.push("```xml");
  lines.push(xml.slice(0, 3000));
  lines.push("```");

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new Server(
  {
    name: "hilma-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "search_notices",
        description:
          "Hae hankintailmoituksia Hilmasta (hankintailmoitukset.fi). " +
          "Tukee vapaatekstihakua, CPV-koodisuodatusta, aikarajausta, ilmoitustyypin valintaa ja menettelytyypin valintaa. " +
          "Palauttaa listauksen ilmoituksista otsikoineen, hankintayksikköineen ja määräaikoineen.",
        inputSchema: {
          type: "object",
          properties: {
            search: {
              type: "string",
              description:
                'Vapaatekstihaku ilmoituksen otsikosta ja kuvauksesta. Käytä "*" kaikkien hakemiseen.',
            },
            cpv_codes: {
              type: "array",
              items: { type: "string" },
              description:
                'CPV-koodit suodatukseen, esim. ["71200000", "72000000"]. Useampi koodi OR-logiikalla.',
            },
            notice_type: {
              type: "string",
              enum: ["ContractNotices", "ContractAwardNotices", "PlanNotices"],
              description:
                "Ilmoitustyyppi: ContractNotices=hankintailmoitukset, ContractAwardNotices=jälki-ilmoitukset, PlanNotices=ennakkoilmoitukset",
            },
            procurement_type: {
              type: "string",
              enum: ["services", "works", "supplies"],
              description: "Hankintalaji: services=palvelut, works=urakat, supplies=tavarat",
            },
            procedure_type: {
              type: "string",
              enum: ["open", "restricted", "negotiated"],
              description:
                "Menettelytyyppi: open=avoin, restricted=rajoitettu, negotiated=neuvottelu",
            },
            days: {
              type: "number",
              description: "Rajaa ilmoitukset viimeiseen N päivään (esim. 7, 30, 90)",
            },
            hours: {
              type: "number",
              description: "Rajaa ilmoitukset viimeiseen N tuntiin (esim. 24, 48). Ohittaa days-parametrin.",
            },
            top: {
              type: "number",
              description: "Palautettavien tulosten maksimimäärä (1–100, oletus 20)",
            },
            skip: {
              type: "number",
              description: "Ohita N ensimmäistä tulosta (sivutus)",
            },
            order_by: {
              type: "string",
              description:
                'Lajittelujärjestys, esim. "datePublished desc" tai "expirationDate asc"',
            },
          },
        },
      },
      {
        name: "get_notice",
        description:
          "Hae yksittäisen hankintailmoituksen täydet tiedot Hilmasta ilmoituksen ID:llä (noticeId). " +
          "Palauttaa eForms XML -datan ja tarjousportaalin linkit.",
        inputSchema: {
          type: "object",
          properties: {
            notice_id: {
              type: "number",
              description: "Ilmoituksen numeerinen ID (noticeId) Hilmasta",
            },
          },
          required: ["notice_id"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    if (name === "search_notices") {
      const result = await searchNotices(args as SearchParams);
      return { content: [{ type: "text", text: result }] };
    }

    if (name === "get_notice") {
      const { notice_id } = args as { notice_id: number };
      const result = await getNotice(notice_id);
      return { content: [{ type: "text", text: result }] };
    }

    throw new Error(`Tuntematon työkalu: ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `Virhe: ${message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // MCP servers communicate over stdio — no console.log here
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err}\n`);
  process.exit(1);
});
