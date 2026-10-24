import { buildCitation } from "@bio-mcp/shared";
import { shouldStage, stageToDoAndRespond } from "@bio-mcp/shared/staging/utils";

export const KLIFS_SOURCE = { id: "klifs", name: "KLIFS structural kinase database", url: "https://klifs.net" };
export type KlifsToolResult = { content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>; isError?: boolean; [key: string]: unknown };
export type KlifsDataEnv = { KLIFS_DATA_DO?: unknown };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

async function cite(data: Record<string, unknown>, tool: string, query: unknown) {
  const meta = record(data._meta) ? data._meta : {};
  if (record(meta.citation)) return data;
  const { _meta: _metadata, ...result } = data;
  const citation = await buildCitation({ source: KLIFS_SOURCE, server: "klifs", tool: tool.replace(/^mcp_/, ""),
    query, queryScope: "tool_arguments", result, resultScope: "structured_content:root_without_meta", retrievedAt: new Date().toISOString() });
  return { ...data, _meta: { ...meta, citation } };
}

/** Enforce the transport contract for search, execution and staged-data queries. */
export async function klifsResponse(work: () => Promise<KlifsToolResult>, env: KlifsDataEnv,
  tool: string, extra: unknown, query: unknown = {}): Promise<KlifsToolResult> {
  try {
    const original = await work();
    const structured = original.structuredContent ?? { success: original.isError !== true };
    const failed = original.isError === true || structured.success === false || Boolean(structured.program_error)
      || structured.disposition === "partial" || (record(structured.data) && structured.data.__api_error === true);
    const result = { ...original, structuredContent: await cite({ ...structured, success: !failed }, tool, query),
      ...(failed ? { isError: true } : {}) };
    if (!shouldStage(bytes(result))) return result;
    if (!env.KLIFS_DATA_DO) throw new Error("KLIFS staging storage is unavailable");
    const staged = await stageToDoAndRespond(result, env.KLIFS_DATA_DO as Parameters<typeof stageToDoAndRespond>[1],
      "klifs", undefined, { toolName: tool, serverName: "klifs" }, "klifs", extra as Parameters<typeof stageToDoAndRespond>[6]);
    const citation = await buildCitation({ source: KLIFS_SOURCE, server: "klifs", tool: tool.replace(/^mcp_/, ""),
      query, queryScope: "tool_arguments", result, resultScope: "staged:full_result", retrievedAt: new Date().toISOString(), dataAccessId: staged.dataAccessId });
    const structuredContent = { success: !failed, staged: true, data: undefined,
      data_access_id: staged.dataAccessId, _staging: staged._staging, _meta: { citation } };
    if (bytes(structuredContent) > 100_000) throw new Error("KLIFS staging metadata exceeds transport limit");
    return { content: [{ type: "text", text: "Response staged. Use klifs_get_schema and klifs_query_data with data_access_id; payloads retains the original response." }],
      structuredContent, ...(failed ? { isError: true } : {}) };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "KLIFS response failed";
    return { content: [{ type: "text", text: message }], isError: true,
      structuredContent: await cite({ success: false, error: { code: "KLIFS_RESPONSE_ERROR", message } }, tool, query) };
  }
}
