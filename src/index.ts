import { buildHealthResponse, configureCitationSigning } from "@bio-mcp/shared";
import { McpServer, StatelessMcpWorker } from "@bio-mcp/shared/mcp";
import { registerCodeMode, type KlifsEnv } from "./tools/code-mode";
import { registerResources } from "./resources";
export { KlifsDataDO } from "./do";

export class KlifsMcp extends StatelessMcpWorker<KlifsEnv> {
  server = new McpServer({ name: "klifs", version: "0.1.0" });
  async init() {
    configureCitationSigning(this.env);
    registerCodeMode(this.server, this.env);
    registerResources(this.server);
  }
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path === "/health") return buildHealthResponse("klifs");
    if (path === "/readyz") return KlifsMcp.readiness(env, "klifs");
    if (path === "/mcp") return KlifsMcp.serve("/mcp").fetch(request, env, ctx);
    return new Response("Not found", { status: 404 });
  },
};
