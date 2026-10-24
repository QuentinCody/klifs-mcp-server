import type { ApiCatalog, ApiEndpoint, ParamDef } from "@bio-mcp/shared/codemode/catalog";

const ids = (name: string, required = true): ParamDef => ({ name, type: "array", required,
  description: "One or up to 25 positive integer KLIFS IDs, supplied as an array or comma-separated string." });
const names = (name: string, required = false): ParamDef => ({ name, type: "array", required,
  description: "One or up to 25 names, supplied as an array or comma-separated string." });
const species: ParamDef = { name: "species", type: "string", required: false,
  description: "Species filter; HUMAN or MOUSE. Preserve species returned by KLIFS." };
const endpoint = (path: string, summary: string, category: string, queryParams: ParamDef[] = []): ApiEndpoint =>
  ({ method: "GET", path, summary, category, queryParams });

export const downloadFormats: Readonly<Record<string, "mol2" | "pdb">> = {
  "/structure_get_complex": "mol2", "/structure_get_pdb_complex": "pdb",
  "/structure_get_protein": "mol2", "/structure_get_pocket": "mol2", "/structure_get_ligand": "mol2",
};

export const klifsCatalog: ApiCatalog = {
  name: "KLIFS structural kinase database", baseUrl: "https://klifs.net/api_v2", version: "0.3.1", auth: "none",
  notes: [
    "Curated read-only structural subset verified against https://dev.klifs.net/swagger_v2/swagger.json on 2026-10-23.",
    "Kinase IDs, structure IDs, ligand IDs and PDB codes are different namespaces. Resolve ABL1 with kinase_ID and species=HUMAN first.",
    "Keep species, chain, alternate model, pocket sequence, curation flag, missing residues/atoms, resolution and quality score. Human and mouse are distinct assay targets.",
    "KLIFS aligns 85 pocket residues. structure_conformation returns ac_helix; structure lists use aC_helix. Native fields and sentinel values are retained without renaming.",
    "Downloads return {documents:[{structure_ID,format,content_type,source_url,text}]}; text is the exact UTF-8 MOL2 or PDB file, not parsed coordinates. Protein/pocket/ligand use MOL2, not JSON or PDB.",
    "IFP strings describe crystallographic ligand interactions; absence of a structure or interaction is not a negative affinity measurement, and a bound test-drug structure can leak benchmark labels.",
    "No affinity/ChEMBL endpoints are exposed. Freeze structure eligibility before inspecting held-out outcomes; do not use co-crystal IFPs of held-out drug-target pairs as predictive features.",
    "Arrays are serialized as comma-separated values. At most 25 IDs/names per query, 4 MiB response, 15 seconds total; no retries or redirects. Narrow requests after size errors.",
    "Upstream pagination/rate limits are undocumented; no automatic exhaustive enumeration. Responses above 30 KiB are staged; inspect klifs_get_schema then query klifs_query_data.",
  ].join("\n"),
  endpoints: [
    endpoint("/kinase_groups", "List kinase groups", "kinases"),
    endpoint("/kinase_families", "List kinase families, optionally filtered by kinase group", "kinases", [names("kinase_group")]),
    endpoint("/kinase_names", "List kinase names and IDs by group, family or species", "kinases", [names("kinase_group"), names("kinase_family"), species]),
    endpoint("/kinase_ID", "Resolve ABL1 or other kinase names to KLIFS ID, UniProt accession and 85-residue pocket sequence", "kinases", [names("kinase_name", true), species]),
    endpoint("/kinase_information", "Get kinase identity, group, family, species, UniProt and pocket sequence", "kinases", [ids("kinase_ID"), species]),
    endpoint("/structures_list", "Get structures by kinase ID, with PDB code, chain, alternate model, quality and pocket conformation", "structures", [ids("kinase_ID")]),
    endpoint("/structure_list", "Get structure details by KLIFS structure ID", "structures", [ids("structure_ID")]),
    endpoint("/structures_pdb_list", "Find all KLIFS structures/chains/models for PDB codes", "structures", [names("pdb-codes", true)]),
    endpoint("/structure_conformation", "Get DFG and alpha-C helix conformation plus pocket geometry; retain sentinel values", "conformations", [ids("structure_ID")]),
    endpoint("/structure_modified_residues", "Get modified residues for one KLIFS structure", "structures", [{ ...ids("structure_ID"), type: "number", description: "One positive integer KLIFS structure ID." }]),
    endpoint("/ligands_list", "List co-crystallized ligands for kinase IDs", "ligands", [ids("kinase_ID")]),
    endpoint("/ligands_list_structures", "Get structures containing specified KLIFS ligand IDs", "ligands", [ids("ligand_ID")]),
    endpoint("/interactions_get_IFP", "Retrieve native ligand interaction fingerprint (IFP) bit strings by structure ID", "interactions", [ids("structure_ID")]),
    ...Object.entries(downloadFormats).map(([path, format]) => endpoint(path,
      `Download ${path.replace("/structure_get_", "").replaceAll("_", " ")} as exact ${format.toUpperCase()} text in a documents row`,
      "downloads", [{ name: "structure_ID", type: "number", required: true, description: "One positive integer KLIFS structure ID." }])),
  ],
  workflows: [{
    title: "Resolve a human kinase and inspect its structures",
    description: "Discover ABL1 identity before selecting a structure by species, quality, chain and conformation.",
    keywords: ["ABL1", "kinase", "pocket", "structure"],
    code: "const kinases = await api.get('/kinase_ID', {kinase_name:'ABL1',species:'HUMAN'}); return {kinases, structures: await api.get('/structures_list', {kinase_ID:392})};",
  }],
};
