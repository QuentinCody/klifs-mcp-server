const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** Keep downloaded files in SQL rows and unwrap an outer transport envelope. */
export function klifsTabular(value: unknown): unknown {
  const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
    ? value.structuredContent.data : value;
  if (record(data) && Array.isArray(data.documents)) return { documents: data.documents };
  if (!Array.isArray(data) || data.length === 0) return data;
  if (data.every(row => typeof row === "string")) return { values: data.map((value, index) => ({ index, value })) };
  if (data.every(row => record(row) && "IFP" in row)) return { interactions: data };
  if (data.every(row => record(row) && "structure_ID" in row)) return { structures: data };
  if (data.every(row => record(row) && "kinase_ID" in row)) return { kinases: data };
  return { records: data };
}
