import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import { klifsTabular } from "./lib/tabular";

export class KlifsDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    return klifsTabular(value);
  }
}
