import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ userDataPath: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => electronState.userDataPath),
  },
}));

async function importCalibrationModules() {
  const store = await import("../../../src/main/ai/token-calibration-store");
  const estimate = await import("../../../src/shared/token-estimate");
  return { store, estimate };
}

function calibrationPath(): string {
  return join(electronState.userDataPath, "token-calibration.json");
}

describe("token-calibration-store", () => {
  beforeEach(() => {
    electronState.userDataPath = mkdtempSync(join(tmpdir(), "anything-calibration-"));
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("损坏文件加载失败后保持默认值并允许重试", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    writeFileSync(calibrationPath(), "{broken", "utf-8");
    const { store } = await importCalibrationModules();
    const scope = { provider: "openai", model: "gpt-test", apiType: "responses" };

    expect(store.loadTokenCalibration(scope)).toEqual({ ratio: 1, samples: 0 });

    writeFileSync(
      calibrationPath(),
      JSON.stringify({
        version: 2,
        calibrations: [{ ...scope, ratio: 1.6, samples: 4 }],
      }),
      "utf-8",
    );

    expect(store.loadTokenCalibration(scope)).toEqual({ ratio: 1.6, samples: 4 });
    expect(warning).toHaveBeenCalledTimes(1);
  });

  it("兼容旧单校准格式并在保存时迁移", async () => {
    writeFileSync(calibrationPath(), JSON.stringify({ ratio: 1.4, samples: 3 }), "utf-8");
    const { store } = await importCalibrationModules();

    expect(store.loadTokenCalibration()).toEqual({ ratio: 1.4, samples: 3 });
    store.saveTokenCalibration(true);

    const persisted = JSON.parse(readFileSync(calibrationPath(), "utf-8"));
    expect(persisted.version).toBe(2);
    expect(persisted.calibrations).toEqual([
      {
        provider: "default",
        model: "default",
        apiType: "default",
        ratio: 1.4,
        samples: 3,
      },
    ]);
  });

  it("按 provider model apiType 隔离并原子替换存储文件", async () => {
    const scopeA = { provider: "openai", model: "gpt-a", apiType: "responses" };
    const scopeB = { provider: "openai", model: "gpt-b", apiType: "completions" };
    let modules = await importCalibrationModules();

    modules.store.loadTokenCalibration(scopeA);
    modules.estimate.setTokenEstimateCalibration({ ratio: 1.25, samples: 2 });
    modules.store.saveTokenCalibration(scopeA, true);
    modules.estimate.setTokenEstimateCalibration({ ratio: 1.75, samples: 5 });
    modules.store.saveTokenCalibration(scopeB, true);

    expect(
      readdirSync(electronState.userDataPath).filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);

    vi.resetModules();
    modules = await importCalibrationModules();
    expect(modules.store.loadTokenCalibration(scopeA)).toEqual({ ratio: 1.25, samples: 2 });
    expect(modules.store.loadTokenCalibration(scopeB)).toEqual({ ratio: 1.75, samples: 5 });
  });

  it("flush 会同步写入尚未触发的延迟保存", async () => {
    const { store, estimate } = await importCalibrationModules();
    store.loadTokenCalibration();
    estimate.setTokenEstimateCalibration({ ratio: 1.3, samples: 1 });

    store.saveTokenCalibration();
    expect(existsSync(calibrationPath())).toBe(false);

    store.flushTokenCalibration();
    expect(existsSync(calibrationPath())).toBe(true);
    const persisted = JSON.parse(readFileSync(calibrationPath(), "utf-8"));
    expect(persisted.calibrations[0]).toMatchObject({ ratio: 1.3, samples: 1 });
  });
});
