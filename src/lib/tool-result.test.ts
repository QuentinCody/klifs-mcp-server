import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stage: vi.fn(), citation: vi.fn() }));
vi.mock("@bio-mcp/shared", () => ({ buildCitation: mocks.citation }));
vi.mock("@bio-mcp/shared/staging/utils", () => ({ shouldStage: (size: number) => size > 30 * 1024, stageToDoAndRespond: mocks.stage }));
import { klifsResponse } from "./tool-result";

beforeEach(() => {
  mocks.stage.mockReset(); mocks.citation.mockReset();
  mocks.citation.mockResolvedValue({ source: "klifs", result_hash: "test-hash" });
  mocks.stage.mockResolvedValue({ dataAccessId: "fixture-id", _staging: { data_access_id: "fixture-id", tables: ["documents"],
    primary_table: "documents", total_rows: 1, payload_size_bytes: 40000, query_tool: "klifs_query_data", schema_tool: "klifs_get_schema" } });
});

describe("KLIFS response contract", () => {
  it("cites ordinary results and keeps both response fields", async () => {
    const result = await klifsResponse(async () => ({ content: [{ type: "text", text: "ok" }], structuredContent: { data: [{ kinase_ID: 392 }] } }), {}, "klifs_execute", {});
    expect(result.content).toHaveLength(1);
    expect(result.structuredContent).toMatchObject({ success: true, data: [{ kinase_ID: 392 }], _meta: { citation: { result_hash: "test-hash" } } });
    expect(mocks.stage).not.toHaveBeenCalled();
  });
  it("stages by UTF-8 bytes and omits the full payload", async () => {
    const result = await klifsResponse(async () => ({ content: [], structuredContent: { data: { text: "é".repeat(17000) } } }),
      { KLIFS_DATA_DO: {} }, "klifs_execute", {});
    expect(mocks.stage).toHaveBeenCalledTimes(1);
    expect(result.structuredContent).toMatchObject({ success: true, _staging: { data_access_id: "fixture-id" }, staged: true });
    expect(result.structuredContent?.data).toBeUndefined();
    expect(new TextEncoder().encode(JSON.stringify(result.structuredContent)).length).toBeLessThan(100000);
  });
  it("surfaces API error values and partial programs as tool errors", async () => {
    for (const data of [{ data: { __api_error: true, status: 429 } }, { disposition: "partial", data: [] }, { program_error: "timeout" }]) {
      const result = await klifsResponse(async () => ({ content: [], structuredContent: data }), {}, "klifs_execute", {});
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.success).toBe(false);
    }
  });
  it("keeps the error flag when an error response must be staged", async () => {
    const result = await klifsResponse(async () => ({ content: [], isError: true, structuredContent: { error: "x".repeat(40000) } }),
      { KLIFS_DATA_DO: {} }, "klifs_execute", {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ success: false, staged: true });
  });
  it("fails explicitly when large data cannot be staged", async () => {
    const result = await klifsResponse(async () => ({ content: [], structuredContent: { data: "x".repeat(40000) } }), {}, "klifs_execute", {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ success: false, error: { message: "KLIFS staging storage is unavailable" } });
    expect(result.content[0].text).toContain("unavailable");
  });
  it("does not return staging metadata over the transport limit", async () => {
    mocks.stage.mockResolvedValue({ dataAccessId: "fixture-id", _staging: { excess: "x".repeat(110000) } });
    const result = await klifsResponse(async () => ({ content: [], structuredContent: { data: "x".repeat(40000) } }),
      { KLIFS_DATA_DO: {} }, "klifs_execute", {});
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.structuredContent).length).toBeLessThan(100000);
  });
});
