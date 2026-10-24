/// <reference types="@cloudflare/workers-types/experimental" />
// Minimal development bindings; Wrangler writes worker-configuration.d.ts separately.
declare namespace Cloudflare {
  interface Env {
    KLIFS_DATA_DO: DurableObjectNamespace<import("./src/do").KlifsDataDO>;
    CODE_MODE_LOADER: WorkerLoader;
  }
}
interface Env extends Cloudflare.Env {}
