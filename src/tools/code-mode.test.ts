import { describe, expect, it, vi } from "vitest";
import type { McpServer } from "@bio-mcp/shared/mcp";
import { searchEndpoints } from "@bio-mcp/shared/codemode/search-core";
import { klifsCatalog } from "../spec/catalog";

const fixture = vi.hoisted(() => ({ executeOptions: vi.fn() }));
vi.mock("@bio-mcp/shared", () => ({ buildCitation: async () => ({ source: "klifs", result_hash: "fixture-hash" }) }));
vi.mock("@bio-mcp/shared/codemode/search-tool", () => ({ createSearchTool: () => ({ register(server: { tool: (...args: unknown[]) => void }) {
  server.tool("klifs_search", "search", {}, async () => ({ content: [], structuredContent: { success: true, data: [] } }));
} }) }));
vi.mock("@bio-mcp/shared/codemode/execute-tool", () => ({ createExecuteTool: (options: unknown) => {
  fixture.executeOptions(options);
  return { register(server: { tool: (...args: unknown[]) => void }) {
    server.tool("klifs_execute", "execute", {}, async () => ({ content: [], structuredContent: { success: true, data: [] } }));
  } };
} }));
vi.mock("@bio-mcp/shared/staging/utils", () => ({ shouldStage: () => false, stageToDoAndRespond: vi.fn(),
  createQueryDataHandler: () => async () => { throw new Error("Missing staged dataset"); },
  createGetSchemaHandler: () => async () => ({ content: [], structuredContent: { success: true, data: [] } }),
}));
import { registerCodeMode, type KlifsEnv } from "./code-mode";

describe("KLIFS discovery and registration", () => {
  it.each([
    ["ABL1 pocket", "/kinase_ID"], ["DFG conformation", "/structure_conformation"],
    ["interaction fingerprint", "/interactions_get_IFP"],
  ])("finds the relevant endpoint for %s", (query, path) => {
    expect(searchEndpoints(klifsCatalog.endpoints, query, 3).map(endpoint => endpoint.path)).toContain(path);
  });
  it("registers all aliases once and applies the same response boundary to both", async () => {
    type Handler = (input: Record<string, unknown>, extra: Record<string, unknown>) => Promise<Record<string, unknown>>;
    const registrations = new Map<string, Handler>();
    const server = { tool(name: string, ...args: unknown[]) {
      expect(registrations.has(name)).toBe(false);
      registrations.set(name, args.at(-1) as Handler);
    } };
    registerCodeMode(server as unknown as McpServer, {} as KlifsEnv);
    expect([...registrations.keys()].sort()).toEqual(["klifs_search", "klifs_execute", "klifs_query_data", "klifs_get_schema"]
      .flatMap(name => [name, `mcp_${name}`]).sort());
    for (const name of ["klifs_query_data", "mcp_klifs_query_data"]) {
      const result = await registrations.get(name)?.({ data_access_id: "missing", sql: "select 1" }, {});
      expect(result).toMatchObject({ isError: true, content: [{ type: "text" }], structuredContent: { success: false, _meta: { citation: { result_hash: "fixture-hash" } } } });
    }
    expect(fixture.executeOptions).toHaveBeenCalledWith(expect.objectContaining({ preserveApiErrors: true,
      source: { id: "klifs", name: "KLIFS structural kinase database", url: "https://klifs.net" },
      maxInlineBytes: 30 * 1024, stagingThreshold: 30 * 1024 }));
  });
});
