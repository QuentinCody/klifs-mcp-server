# KLIFS MCP server

Read-only access to the [KLIFS structural kinase database](https://klifs.net), using
the official [v2 Swagger schema](https://dev.klifs.net/swagger_v2/swagger.json).
No credentials are required. This server retrieves existing evidence; it does not
run docking or molecular simulation.

Archetype: catalog-only REST, based on the current HPA/OpenBind stateless and shared
Code Mode patterns. Prefix: `klifs`. Standalone repository intended name:
`QuentinCody/klifs-mcp-server`. Local port: **8908**. Deployment is a separate step.

Four tools are each registered under both `<name>` and `mcp_<name>`:

- `klifs_search`: discover the 18 supported structural endpoints and examples.
- `klifs_execute`: run JavaScript using `api.get` against the catalog.
- `klifs_query_data`: read staged results with SQL.
- `klifs_get_schema`: inspect staged tables, or list this session's datasets.

Resources: `resource://klifs/catalog`, `resource://klifs/query-notes`,
`resource://klifs/pagination-rate-limits`, and `resource://klifs/identifier-cheatsheet`.
The v1 catalog deliberately excludes bioactivity/ChEMBL and ligand similarity
search endpoints; it exposes kinase identity, structures, conformations, native
IFPs, modified residues, ligands and processed molecular files. Published schema
coverage is broader than this supported subset. `kinase_information` and
`ligands_list` require explicit IDs locally, even though the upstream permits
unfiltered requests.

## Scientific boundaries

KLIFS aligns 85 pocket residues. Retain the kinase ID, structure ID, species,
PDB code, chain, alternate model, pocket sequence, quality, curation and missing
residue/atom fields. The endpoints use differing native spellings (`aC_helix` in
structure records and `ac_helix` in conformation records); these are not rewritten.
Sentinel values such as an unassessable distance of -1 are preserved.

A co-crystal structure or IFP of a held-out drug–target pair reveals experimental
binding evidence. Keep those out of prospective prediction features. Freeze
template eligibility and structure-selection rules before inspecting test labels.
Missing structural coverage is unknown, not biochemical inactivity. Structures
and interaction fingerprints do not establish clinical safety or affinity.

Protein, pocket, ligand and full-complex endpoints return **MOL2**; only
`structure_get_pdb_complex` returns PDB. The adapter preserves the exact UTF-8 file
as `{documents:[{structure_ID, format, content_type, source_url, text}]}`. It validates
the expected file signature but does not calculate atom-level properties or alter
coordinates. SQL staging exposes `documents`; the shared `payloads` table retains
the full original response.

## Bounds and error behavior

Only body-free GET requests to the fixed `https://klifs.net/api_v2` origin and
cataloged paths are accepted. Unknown parameters fail before any network call.
Batches are at most 25 IDs/names; a molecular file request accepts one structure.
Each response has a 4 MiB streaming cap and 15-second total deadline, with no
automatic retries or redirects. Upstream pagination and rate limits are undocumented;
use small batches, cache results and respect 429/Retry-After. This adapter does not
certify exhaustive database coverage. Narrow requests after a size error.

HTTP failures, JSON error envelopes (including HTTP 200), malformed JSON, HTML
maintenance pages and empty/invalid molecular files remain errors. Results above
30 KiB stage through `shouldStage`/`stageToDoAndRespond`; full data is omitted from
the compact response, canonical `_staging` is retained, and 100 KB transport limits
are checked. Both success and error paths include `content`, `structuredContent`
and citation metadata; errors also set `isError`.

## Verification and maintenance

On 2026-10-23 bounded direct upstream probes verified:

| Query | Observed result |
| --- | --- |
| `kinase_ID?kinase_name=ABL1&species=HUMAN` | ID 392, UniProt P00519, 85-residue pocket |
| `structures_pdb_list?pdb-codes=1iep` | **Mouse** ABL1, IDs 5703 / 5727, chains A / B |
| `structure_conformation?structure_ID=5703` | Native DFG, alpha-C and geometry JSON |
| `interactions_get_IFP?structure_ID=5703` | Native IFP string JSON |
| `structure_get_protein?structure_ID=5703` | MOL2, 440,946 bytes |
| `structure_get_pocket?structure_ID=5703` | MOL2, 136,650 bytes (staging acceptance case) |
| `structure_get_ligand?structure_ID=5703` | MOL2, 5,905 bytes |
| `structure_get_pdb_complex?structure_ID=5703` | PDB, 195,301 bytes |

These are upstream probes, not proof of deployed MCP runtime behavior. Additional
cataloged routes were schema-verified, not individually live-probed. The server
has not been deployed by this implementation step.

Focused behavioral tests are in `src/lib/api-adapter.test.ts` and
`src/lib/tool-result.test.ts`; the static contract check is
`node servers/klifs-mcp-server/test/structured-content-regression.mjs` from repo root.
Run the focused suites with the root Vitest configuration, then type-check and run
`node scripts/verify-server.mjs klifs --local` against a locally running endpoint. Live
acceptance should cover searches for "ABL1 pocket", "DFG conformation" and
"interaction fingerprint", a simple kinase lookup, a structure→conformation flow,
and the pocket download followed by `_get_schema` and SQL querying the staged row.
No generated test or type-check verdict is implied by the source files.

Drift risk is medium; review the published Swagger monthly. Refresh the supported
catalog, bounds and examples after upstream changes, then repeat the probes and
contract tests. Promote to a committed resolved OpenAPI/hybrid artifact if broader
endpoint coverage is needed; keep the explicit safe route/parameter boundary.
