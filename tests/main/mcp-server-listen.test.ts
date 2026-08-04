import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_MCP_LISTEN_HOST,
  formatMCPServerUrl,
  normalizeMCPListenHost,
} from "../../src/main/mcp/mcp-server-listen";
import {
  initMCPServer,
  isMCPServerRunning,
  stopMCPServer,
} from "../../src/main/mcp/mcp-server";

describe("MCP Server listen host", () => {
  afterEach(async () => {
    await stopMCPServer();
  });

  it("keeps the legacy all-interface binding as the default", () => {
    expect(normalizeMCPListenHost(undefined)).toBe(DEFAULT_MCP_LISTEN_HOST);
    expect(normalizeMCPListenHost(" 0.0.0.0 ")).toBe("0.0.0.0");
  });

  it("supports IPv4 and IPv6 listen addresses", () => {
    expect(normalizeMCPListenHost("192.168.31.133")).toBe("192.168.31.133");
    expect(normalizeMCPListenHost("::1")).toBe("::1");
    expect(formatMCPServerUrl("::1", 23816)).toBe("http://[::1]:23816/mcp");
  });

  it("rejects hostnames and invalid IP addresses", () => {
    expect(() => normalizeMCPListenHost("localhost")).toThrow("监听 IP 无效");
    expect(() => normalizeMCPListenHost("999.1.1.1")).toThrow("监听 IP 无效");
  });

  it("starts the HTTP server on a custom IPv4 address", async () => {
    await initMCPServer({} as never, 0, false, "", "127.0.0.1");

    expect(isMCPServerRunning()).toBe(true);
  });
});
