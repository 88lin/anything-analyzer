import { app } from "electron";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import {
  getTokenEstimateCalibration,
  setTokenEstimateCalibration,
  type TokenEstimateCalibration,
} from "@shared/token-estimate";

export interface TokenCalibrationScope {
  provider?: string;
  name?: string;
  model?: string;
  apiType?: string;
}

interface StoredCalibration extends TokenEstimateCalibration {
  provider: string;
  model: string;
  apiType: string;
}

interface TokenCalibrationStoreData {
  version: 2;
  calibrations: StoredCalibration[];
}

const DEFAULT_SCOPE: Required<Pick<TokenCalibrationScope, "provider" | "model" | "apiType">> = {
  provider: "default",
  model: "default",
  apiType: "default",
};
const DEFAULT_CALIBRATION: TokenEstimateCalibration = { ratio: 1, samples: 0 };
const SAVE_DELAY_MS = 500;

let loaded = false;
let dirty = false;
let activeScope = DEFAULT_SCOPE;
let calibrations = new Map<string, StoredCalibration>();
let saveTimer: NodeJS.Timeout | null = null;

function storePath(): string {
  return join(app.getPath("userData"), "token-calibration.json");
}

function normalizeScope(scope?: TokenCalibrationScope): typeof DEFAULT_SCOPE {
  return {
    provider: scope?.provider?.trim() || scope?.name?.trim() || DEFAULT_SCOPE.provider,
    model: scope?.model?.trim() || DEFAULT_SCOPE.model,
    apiType: scope?.apiType?.trim() || DEFAULT_SCOPE.apiType,
  };
}

function scopeKey(scope: typeof DEFAULT_SCOPE): string {
  return JSON.stringify([scope.provider, scope.model, scope.apiType]);
}

function normalizeCalibration(value: unknown): TokenEstimateCalibration | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<TokenEstimateCalibration>;
  if (!Number.isFinite(candidate.ratio) || (candidate.ratio ?? 0) <= 0) return null;
  return {
    ratio: Math.min(3, Math.max(0.3, candidate.ratio as number)),
    samples: Number.isFinite(candidate.samples)
      ? Math.max(0, Math.floor(candidate.samples as number))
      : 0,
  };
}

function parseStore(raw: unknown): Map<string, StoredCalibration> {
  const parsed = new Map<string, StoredCalibration>();
  const legacyCalibration = normalizeCalibration(raw);
  if (legacyCalibration) {
    const entry = { ...DEFAULT_SCOPE, ...legacyCalibration };
    parsed.set(scopeKey(DEFAULT_SCOPE), entry);
    return parsed;
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("invalid calibration store root");
  }
  const data = raw as Partial<TokenCalibrationStoreData>;
  if (data.version !== 2 || !Array.isArray(data.calibrations)) {
    throw new Error("unsupported calibration store format");
  }

  for (const value of data.calibrations) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Partial<StoredCalibration>;
    const calibration = normalizeCalibration(candidate);
    if (
      !calibration ||
      typeof candidate.provider !== "string" ||
      typeof candidate.model !== "string" ||
      typeof candidate.apiType !== "string"
    ) {
      continue;
    }
    const scope = normalizeScope(candidate);
    parsed.set(scopeKey(scope), { ...scope, ...calibration });
  }
  return parsed;
}

function loadStore(): boolean {
  if (loaded) return true;
  try {
    const path = storePath();
    calibrations = existsSync(path)
      ? parseStore(JSON.parse(readFileSync(path, "utf-8")))
      : new Map<string, StoredCalibration>();
    loaded = true;
    return true;
  } catch (error) {
    calibrations = new Map<string, StoredCalibration>();
    setTokenEstimateCalibration(DEFAULT_CALIBRATION);
    console.warn("[token-calibration] load failed:", error);
    return false;
  }
}

function applyScope(scope: typeof DEFAULT_SCOPE): TokenEstimateCalibration {
  activeScope = scope;
  const entry = calibrations.get(scopeKey(scope));
  const calibration = entry
    ? { ratio: entry.ratio, samples: entry.samples }
    : DEFAULT_CALIBRATION;
  setTokenEstimateCalibration(calibration);
  return getTokenEstimateCalibration();
}

function serializeStore(): TokenCalibrationStoreData {
  return {
    version: 2,
    calibrations: Array.from(calibrations.values()).sort((left, right) =>
      scopeKey(left).localeCompare(scopeKey(right)),
    ),
  };
}

function persistStore(): void {
  if (!loaded || !dirty) return;
  const path = storePath();
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tempPath, JSON.stringify(serializeStore(), null, 2), "utf-8");
    renameSync(tempPath, path);
    dirty = false;
  } catch (error) {
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // 保留原始写入错误，临时文件清理失败不覆盖根因。
      }
    }
    console.warn("[token-calibration] save failed:", error);
  }
}

export function loadTokenCalibration(scope?: TokenCalibrationScope): TokenEstimateCalibration {
  const nextScope = scope ? normalizeScope(scope) : activeScope;
  if (!loadStore()) return getTokenEstimateCalibration();
  return applyScope(nextScope);
}

export function saveTokenCalibration(immediate?: boolean): void;
export function saveTokenCalibration(scope?: TokenCalibrationScope, immediate?: boolean): void;
export function saveTokenCalibration(
  scopeOrImmediate: TokenCalibrationScope | boolean = false,
  immediate = false,
): void {
  const nextScope =
    typeof scopeOrImmediate === "boolean" ? activeScope : normalizeScope(scopeOrImmediate);
  const shouldFlush = typeof scopeOrImmediate === "boolean" ? scopeOrImmediate : immediate;
  if (!loadStore()) return;

  activeScope = nextScope;
  calibrations.set(scopeKey(nextScope), {
    ...nextScope,
    ...getTokenEstimateCalibration(),
  });
  dirty = true;

  if (shouldFlush) {
    flushTokenCalibration();
    return;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistStore();
  }, SAVE_DELAY_MS);
}

export function flushTokenCalibration(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  persistStore();
}

/** 确保启动时完成一次可重试加载。 */
export function ensureTokenCalibrationLoaded(scope?: TokenCalibrationScope): void {
  loadTokenCalibration(scope);
}
