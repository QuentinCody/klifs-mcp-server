import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { decodeResponseText, readResponseBytes } from "@bio-mcp/shared/http/response-reader";
import { downloadFormats, klifsCatalog } from "../spec/catalog";

export const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const fail = (message: string, status = 400, data: unknown = { incomplete: true }): never => {
  throw Object.assign(new Error(message), { status, data });
};

function parameterValue(name: string, value: unknown, array: boolean): string {
  const values = Array.isArray(value) ? value : typeof value === "string" && array ? value.split(",") : [value];
  if (!values.length || values.length > (array ? 25 : 1)) fail(`${name}: supply ${array ? "1–25 values" : "one value"}`);
  return values.map(item => {
    if (typeof item !== "string" && typeof item !== "number") fail(`${name}: expected string or number`);
    const text = String(item).trim();
    if (!text || text.length > 100 || /[\r\n,]/.test(text) || text.includes("\0")) fail(`${name}: invalid value`);
    if (name.endsWith("_ID") && (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(Number(text)))) fail(`${name}: expected positive integer ID`);
    if (name === "pdb-codes" && !/^[A-Za-z0-9]{4}$/.test(text)) fail("pdb-codes: expected four-character PDB code");
    if (name === "species" && !/^(HUMAN|MOUSE)$/i.test(text)) fail("species: use HUMAN or MOUSE");
    return text;
  }).join(",");
}

export function buildKlifsUrl(request: Parameters<ApiFetchFn>[0]): URL {
  if (request.method !== "GET" || request.body !== undefined) fail("KLIFS supports body-free GET requests only");
  const endpoint = klifsCatalog.endpoints.find(item => item.path === request.path);
  if (!endpoint) return fail("Unknown KLIFS path; use klifs_search to discover supported structural endpoints");
  const params = request.params ?? {};
  const definitions = endpoint.queryParams ?? [];
  if (Object.keys(params).some(key => !definitions.some(item => item.name === key))) fail("Unknown KLIFS query parameter; consult klifs_search");
  const url = new URL(`${klifsCatalog.baseUrl}${endpoint.path}`);
  for (const definition of definitions) {
    const value = params[definition.name];
    if (value === undefined) { if (definition.required) fail(`Missing ${definition.name}`); continue; }
    url.searchParams.set(definition.name, parameterValue(definition.name, value, definition.type === "array"));
  }
  return url;
}

function parsePayload(text: string, path: string, url: URL, response: Response): unknown {
  const format = downloadFormats[path];
  const jsonLike = /^[\s\uFEFF]*[\[{]/.test(text);
  if (!format || jsonLike) {
    let data: unknown;
    try { data = JSON.parse(text.replace(/^\uFEFF/, "")); }
    catch { return fail("KLIFS returned malformed JSON", 502); }
    if (data && typeof data === "object" && !Array.isArray(data) && ("error" in data || "message" in data)) {
      return fail("KLIFS reported an upstream error", 502, data);
    }
    if (format) return fail("KLIFS returned JSON instead of a molecular file", 502, data);
    if (!Array.isArray(data)) return fail("KLIFS returned an unexpected JSON response shape", 502);
    return data;
  }
  const valid = format === "mol2" ? /^\s*@<TRIPOS>MOLECULE\b/.test(text) : /^(ATOM  |HETATM)/m.test(text);
  if (!valid) return fail(`KLIFS returned an invalid or empty ${format.toUpperCase()} file`, 502);
  return { documents: [{ structure_ID: Number(url.searchParams.get("structure_ID")), format,
    content_type: response.headers.get("content-type"), source_url: url.toString(), text }] };
}

function networkDiagnostic(error: unknown): string {
  if (!(error instanceof Error)) return "Unknown network error";
  // Keep host-runtime/TLS diagnostics, never stacks, URLs, credential fields or causes.
  return error.message
    .replace(/https?:\/\/\S+/gi, "[upstream URL]")
    .replace(/\b(?:authorization|cookie|api[-_]?key|token|secret)\s*[:=]\s*[^,;\n]+/gi, "[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .replace(/[\r\n\t]/g, " ").slice(0, 200);
}

// Worker host functions can require their global receiver; do not detach `fetch`.
export function createKlifsApiFetch(fetcher: typeof fetch = (input, init) => globalThis.fetch(input, init)): ApiFetchFn {
  return async request => {
    const url = buildKlifsUrl(request);
    const controller = new AbortController();
    const deadline = Date.now() + 15_000;
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      // workerd supports manual/follow, not redirect:error. Manual 3xx fails below.
      const response = await fetcher(url.toString(), { method: "GET", redirect: "manual", signal: controller.signal,
        headers: { Accept: downloadFormats[request.path] ? "chemical/x-mol2, chemical/x-pdb, application/json" : "application/json" } });
      const text = decodeResponseText(await readResponseBytes(response, { label: "KLIFS", maxBytes: MAX_RESPONSE_BYTES,
        timeoutMs: deadline - Date.now() }), "KLIFS");
      if (!response.ok) fail(`KLIFS HTTP ${response.status}`, response.status,
        { incomplete: true, http_status: response.status, retry_after: response.headers.get("retry-after"), message: text.slice(0, 500) });
      return { status: response.status, data: parsePayload(text, request.path, url, response), upstreamTotal: null };
    } catch (error) {
      if (error && typeof error === "object" && "status" in error) throw error;
      const diagnostic = networkDiagnostic(error);
      return fail(controller.signal.aborted ? "KLIFS request timed out" : `KLIFS network request failed: ${diagnostic}`,
        controller.signal.aborted ? 504 : 502, { incomplete: true, network_error: diagnostic });
    } finally { clearTimeout(timer); }
  };
}
