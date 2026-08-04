import { isIP } from "node:net";

export const DEFAULT_MCP_LISTEN_HOST = "0.0.0.0";

export function normalizeMCPListenHost(value: unknown): string {
  const host = typeof value === "string" ? value.trim() : "";
  if (!host) return DEFAULT_MCP_LISTEN_HOST;
  if (isIP(host) === 0) {
    throw new Error(`MCP Server 监听 IP 无效: ${host}`);
  }
  return host;
}

export function formatMCPServerUrl(hostInput: unknown, port: number): string {
  const host = normalizeMCPListenHost(hostInput);
  const urlHost = isIP(host) === 6 ? `[${host}]` : host;
  return `http://${urlHost}:${port}/mcp`;
}
