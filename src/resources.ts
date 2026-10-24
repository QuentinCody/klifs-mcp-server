import type { McpServer } from "@bio-mcp/shared/mcp";
import { klifsCatalog } from "./spec/catalog";

export function registerResources(server: McpServer): void {
  const resources: Record<string, unknown> = {
    catalog: klifsCatalog,
    "query-notes": { notes: klifsCatalog.notes, examples: [
      "return await api.get('/kinase_ID', {kinase_name:'ABL1',species:'HUMAN'});",
      "return await api.get('/structures_pdb_list', {'pdb-codes':'1iep'}); // mouse ABL1; do not label human",
      "return await api.get('/structure_conformation', {structure_ID:5703});",
      "return await api.get('/interactions_get_IFP', {structure_ID:5703});",
      "return await api.get('/structure_get_pocket', {structure_ID:5703}); // MOL2; stages above 30 KiB",
    ] },
    "pagination-rate-limits": { max_ids_per_query: 25, max_response_bytes: 4 * 1024 * 1024,
      total_request_timeout_ms: 15000, retries: 0, redirects: false,
      pagination: "No pagination contract is documented for these routes. Narrow by IDs; oversized responses fail explicitly without returning a truncated biological result.",
      rate_limits: "Undocumented; use sequential or small batches and respect upstream HTTP 429 / Retry-After.",
      staging: "Responses over 30 KiB stage to SQLite. Read _staging and use klifs_get_schema / klifs_query_data. The payloads table retains the complete response." },
    "identifier-cheatsheet": { kinase: "KLIFS kinase_ID, e.g. 392 = human ABL1", structure: "KLIFS structure_ID identifies a chain/model; 5703 = mouse ABL1, PDB 1iep chain A",
      ligand: "KLIFS ligand_ID differs from PDB ligand code", pocket: "85 aligned KLIFS pocket positions; not full-protein residue numbering" },
  };
  for (const [name, data] of Object.entries(resources)) {
    const uri = `resource://klifs/${name}`;
    server.registerResource(name, uri, { mimeType: "application/json", description: `KLIFS ${name}` },
      async () => ({ contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }] }));
  }
}
