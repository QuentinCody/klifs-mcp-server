import { describe, expect, it, vi } from "vitest";
import { buildKlifsUrl, createKlifsApiFetch, MAX_RESPONSE_BYTES } from "./api-adapter";
import { klifsTabular } from "./tabular";

const request = (path: string, params?: Record<string, unknown>) => ({ method: "GET", path, params });
const fetchResponse = (body: string, headers: Record<string, string> = {}, status = 200) =>
  vi.fn().mockResolvedValue(new Response(body, { status, headers })) as unknown as typeof fetch;

describe("KLIFS bounded read-only transport", () => {
  it("serializes lists without changing the fixed upstream origin", () => {
    const url = buildKlifsUrl(request("/kinase_ID", { kinase_name: ["ABL1", "SRC"], species: "HUMAN" }));
    expect(url.origin).toBe("https://klifs.net");
    expect(url.pathname).toBe("/api_v2/kinase_ID");
    expect(url.searchParams.get("kinase_name")).toBe("ABL1,SRC");
    expect(buildKlifsUrl(request("/structure_list", { structure_ID: "5703,5727" })).searchParams.get("structure_ID")).toBe("5703,5727");
  });
  it.each([
    { method: "POST", path: "/kinase_ID", params: { kinase_name: "ABL1" } },
    { method: "GET", path: "/kinase_ID", params: { kinase_name: "ABL1" }, body: {} },
    request("https://example.org/kinase_ID"), request("//example.org/kinase_ID"),
    request("/../kinase_ID"), request("/kinase_ID?kinase_name=ABL1"),
    request("/kinase_ID", {}), request("/kinase_ID", { kinase_name: "ABL1", limit: 1 }),
    request("/structure_list", { structure_ID: "1,0" }), request("/structure_list", { structure_ID: "1e2" }),
    request("/structure_list", { structure_ID: Array.from({ length: 26 }, (_, i) => i + 1) }),
    request("/structure_get_pocket", { structure_ID: [5703, 5727] }),
    request("/structures_pdb_list", { "pdb-codes": "1iep/download" }),
    request("/kinase_ID", { kinase_name: "ABL1\n", species: "CHIMPANZEE" }),
    request("/kinase_ID", { kinase_name: {} }),
  ])("rejects unsafe or unbounded input before fetching: %j", async input => {
    const fetcher = vi.fn();
    await expect(createKlifsApiFetch(fetcher as typeof fetch)(input)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves native identifiers, alternate models and sentinel values", async () => {
    const data = [{ structure_ID: 5703, species: "Mouse", alt: "B", ac_helix: "in", salt_bridge_17_24: -1, future_field: true }];
    const fetcher = fetchResponse(JSON.stringify(data), { "content-type": "application/json" });
    const result = await createKlifsApiFetch(fetcher)(request("/structure_conformation", { structure_ID: 5703 }));
    expect(result.data).toEqual(data);
    expect(result.upstreamTotal).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: "GET", redirect: "manual" }));
  });
  it("retains a zero-filled IFP as an exact string", async () => {
    const data = [{ structure_ID: 5703, IFP: "000000010010000" }];
    const result = await createKlifsApiFetch(fetchResponse(JSON.stringify(data)))(request("/interactions_get_IFP", { structure_ID: 5703 }));
    expect(result.data).toEqual(data);
    expect(klifsTabular(result.data)).toEqual({ interactions: data });
  });
  it("returns exact MOL2 text in a stageable document row, not parsed JSON", async () => {
    const text = "@<TRIPOS>MOLECULE\nMOUSE/ABL1_1iep_chainA\n1 0 1 0 0\n@<TRIPOS>ATOM\n1 C 0 0 0 C.3\n";
    const result = await createKlifsApiFetch(fetchResponse(text, { "content-type": "chemical/x-mol2" }))(
      request("/structure_get_pocket", { structure_ID: 5703 }));
    expect(result.data).toEqual({ documents: [{ structure_ID: 5703, format: "mol2", content_type: "chemical/x-mol2",
      source_url: "https://klifs.net/api_v2/structure_get_pocket?structure_ID=5703", text }] });
    expect(klifsTabular({ content: [], structuredContent: { data: result.data } })).toEqual(result.data);
  });
  it("accepts PDB atom records only on the PDB download route", async () => {
    const text = "HEADER    fixture\nATOM      1  N   ALA A   1      0.000   0.000   0.000\nEND\n";
    const result = await createKlifsApiFetch(fetchResponse(text))(request("/structure_get_pdb_complex", { structure_ID: 5703 }));
    expect(result.data).toMatchObject({ documents: [{ format: "pdb", text }] });
    await expect(createKlifsApiFetch(fetchResponse(text))(request("/structure_get_ligand", { structure_ID: 5703 }))).rejects.toThrow("invalid or empty MOL2");
  });
  it.each(["<html>Maintenance</html>", "", "{broken", "null"])("fails closed on non-JSON metadata: %j", async body => {
    await expect(createKlifsApiFetch(fetchResponse(body))(request("/kinase_ID", { kinase_name: "ABL1" }))).rejects.toMatchObject({ status: 502 });
  });
  it("does not mistake a JSON error delivered as HTTP 200 for a molecular file", async () => {
    const result = createKlifsApiFetch(fetchResponse('{"code":404,"message":"Unknown structure"}', { "content-type": "chemical/x-mol2" }));
    await expect(result(request("/structure_get_ligand", { structure_ID: 999999999 }))).rejects.toMatchObject({ status: 502, data: { code: 404 } });
  });
  it("retains an actual empty JSON array as an empty answer", async () => {
    expect((await createKlifsApiFetch(fetchResponse("[]"))(request("/structure_list", { structure_ID: 999999999 }))).data).toEqual([]);
  });
  it("preserves rate-limit status and retry guidance without retrying", async () => {
    const fetcher = fetchResponse("too many", { "retry-after": "30" }, 429);
    await expect(createKlifsApiFetch(fetcher)(request("/kinase_groups"))).rejects.toMatchObject({ status: 429, data: { retry_after: "30", incomplete: true } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("returns redirects as HTTP errors without following Location", async () => {
    const fetcher = fetchResponse("Moved", { location: "https://example.org/redirect" }, 302);
    await expect(createKlifsApiFetch(fetcher)(request("/kinase_groups"))).rejects.toMatchObject({ status: 302,
      data: { incomplete: true, http_status: 302 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("https://klifs.net/api_v2/kinase_groups", expect.objectContaining({ redirect: "manual" }));
  });
  it("rejects an oversized declared response without treating it as an empty result", async () => {
    await expect(createKlifsApiFetch(fetchResponse("[]", { "content-length": String(MAX_RESPONSE_BYTES + 1) }))(
      request("/kinase_groups"))).rejects.toMatchObject({ status: 413 });
  });
  it("enforces its streaming cap when Content-Length is absent", async () => {
    const stream = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_RESPONSE_BYTES));
      controller.enqueue(new Uint8Array(1)); controller.close();
    } });
    const fetcher = vi.fn().mockResolvedValue(new Response(stream));
    await expect(createKlifsApiFetch(fetcher as typeof fetch)(request("/kinase_groups"))).rejects.toMatchObject({ status: 413 });
  });
  it("rejects invalid UTF-8 without replacement characters", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(new Uint8Array([0xff])));
    await expect(createKlifsApiFetch(fetcher as typeof fetch)(request("/kinase_groups"))).rejects.toThrow("valid UTF-8");
  });
  it("makes network failures explicit", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network"));
    await expect(createKlifsApiFetch(fetcher as typeof fetch)(request("/kinase_groups"))).rejects.toMatchObject({ status: 502, data: { incomplete: true } });
  });
  it("preserves the global receiver required by Worker fetch", async () => {
    vi.stubGlobal("fetch", function(this: unknown) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response("[]"));
    });
    try {
      expect((await createKlifsApiFetch()(request("/kinase_groups"))).data).toEqual([]);
    } finally { vi.unstubAllGlobals(); }
  });
  it("retains useful network diagnostics while redacting URLs and credential fields", async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError("TLS certificate failure https://user:password@example.org/; token=private"));
    const result = createKlifsApiFetch(fetcher as typeof fetch)(request("/kinase_groups"));
    await expect(result).rejects.toMatchObject({ status: 502, data: {
      incomplete: true, network_error: "TLS certificate failure [upstream URL] [redacted]",
    } });
  });
});
