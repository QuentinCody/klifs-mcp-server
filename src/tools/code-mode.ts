import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { createGetSchemaHandler, createQueryDataHandler } from "@bio-mcp/shared/staging/utils";
import { z } from "zod";
import { createKlifsApiFetch } from "../lib/api-adapter";
import { klifsCatalog } from "../spec/catalog";
import { klifsResponse, KLIFS_SOURCE, type KlifsToolResult } from "../lib/tool-result";

export interface KlifsEnv {
  KLIFS_DATA_DO: DurableObjectNamespace;
  CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(server: McpServer, env: KlifsEnv): void {
  const registrar = { tool: (name: unknown, ...args: unknown[]) => {
    const handler = args.pop() as (input: unknown, extra: unknown) => Promise<KlifsToolResult>;
    const register = server.tool.bind(server) as (...values: unknown[]) => void;
    for (const alias of [String(name), `mcp_${String(name)}`]) {
      register(alias, ...args, (input: unknown, extra: unknown) => klifsResponse(() => handler(input, extra), env, alias, extra, input));
    }
  } };
  createSearchTool({ prefix: "klifs", catalog: klifsCatalog }).register(registrar);
  createExecuteTool({ prefix: "klifs", catalog: klifsCatalog, apiFetch: createKlifsApiFetch(), source: KLIFS_SOURCE,
    preserveApiErrors: true, maxInlineBytes: 30 * 1024, stagingThreshold: 30 * 1024, timeout: 60_000,
    doNamespace: env.KLIFS_DATA_DO, loader: env.CODE_MODE_LOADER }).register(registrar);
  const query = createQueryDataHandler("KLIFS_DATA_DO", "klifs");
  const schema = createGetSchemaHandler("KLIFS_DATA_DO", "klifs");
  registrar.tool("klifs_query_data", "Query staged KLIFS structures, pockets, files and interaction fingerprints with read-only SQL", {
    data_access_id: z.string().min(1), sql: z.string().min(1), limit: z.number().int().min(1).max(10000).optional(),
  }, (input: Record<string, unknown>) => query(input, { ...env }));
  registrar.tool("klifs_get_schema", "Inspect staged KLIFS tables; omit data_access_id to list this session's staged datasets", {
    data_access_id: z.string().min(1).optional(),
  }, (input: Record<string, unknown>, extra: Record<string, unknown>) => schema(input, { ...env }, extra));
}
