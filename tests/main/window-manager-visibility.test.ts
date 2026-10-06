import { beforeEach, describe, expect, it, vi } from "vitest";
import { WindowManager } from "../../src/main/window";

/**
 * Regression tests for WindowManager's control of the native browser view.
 *
 * Two failure modes are covered:
 * 1. Fail-closed start — the view must not be shown until the renderer asks.
 * 2. Remembered bounds — the renderer reports the placeholder rectangle with
 *    `send` while visibility arrives via `invoke`, so the measurement can be
 *    dropped/ignored; showing must then reuse the measured bounds instead of the
 *    hard-coded layout fallback.
 */

const h = vi.hoisted(() => {
  class FakeWebContents {
    destroyed = false;
    setMaxListeners(): this {
      return this;
    }
    on(): this {
      return this;
    }
    once(): this {
      return this;
    }
    removeListener(): this {
      return this;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    close(): void {
      this.destroyed = true;
    }
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
    executeJavaScript(): Promise<unknown> {
      return Promise.resolve(undefined);
    }
    setWindowOpenHandler(): void {
      /* no-op */
    }
    getURL(): string {
      return "";
    }
  }

  class FakeWebContentsView {
    bounds = { x: 0, y: 0, width: 0, height: 0 };
    webContents = new FakeWebContents();
    setBounds(next: { x: number; y: number; width: number; height: number }): void {
      this.bounds = { ...next };
    }
    setBackgroundColor(): void {
      /* no-op */
    }
    setBorderRadius(): void {
      /* no-op */
    }
  }

  class FakeBrowserWindow {
    contentBounds = { x: 0, y: 0, width: 1400, height: 900 };
    contentView = {
      addChildView: vi.fn(),
      removeChildView: vi.fn(),
    };
    handlers = new Map<string, Array<() => void>>();
    getContentBounds(): { x: number; y: number; width: number; height: number } {
      return { ...this.contentBounds };
    }
    on(event: string, cb: () => void): this {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
      return this;
    }
    emit(event: string): void {
      for (const cb of this.handlers.get(event) ?? []) cb();
    }
    loadFile(): Promise<void> {
      return Promise.resolve();
    }
    loadURL(): Promise<void> {
      return Promise.resolve();
    }
  }

  return { FakeWebContentsView, FakeBrowserWindow };
});

vi.mock("electron", () => ({
  WebContentsView: h.FakeWebContentsView,
  BrowserWindow: h.FakeBrowserWindow,
  nativeImage: { createFromPath: () => ({}) },
}));

const HIDDEN = { x: 0, y: 0, width: 0, height: 0 };
/** Result of the hard-coded layout fallback for a 1400x900 content area. */
const FALLBACK = { x: 221, y: 122, width: 1179, height: 752 };

function setup() {
  const wm = new WindowManager();
  const window = wm.createMainWindow() as unknown as InstanceType<typeof h.FakeBrowserWindow>;
  const tabManager = wm.initTabs();
  const tab = tabManager.getActiveTab();
  if (!tab) throw new Error("expected an initial tab");
  const view = tab.view as unknown as InstanceType<typeof h.FakeWebContentsView>;
  return { wm, window, tabManager, view };
}

describe("WindowManager native-view visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("初始状态为隐藏（fail-closed）：原生视图不得在 renderer 请求前出现", () => {
    const { wm, view } = setup();

    expect(wm.isTargetViewVisible()).toBe(false);
    expect(view.bounds).toEqual(HIDDEN);
  });

  it("setTargetViewVisible(false) 隐藏当前分组内的所有 tab 视图", () => {
    const { wm, tabManager } = setup();
    // Creating a tab makes it active, so `second` is the visible one.
    const second = tabManager.createTab();

    wm.setTargetViewVisible(true);
    expect(
      (second.view as unknown as InstanceType<typeof h.FakeWebContentsView>).bounds,
    ).not.toEqual(HIDDEN);

    wm.setTargetViewVisible(false);

    for (const tab of tabManager.getAllTabs()) {
      expect((tab.view as unknown as InstanceType<typeof h.FakeWebContentsView>).bounds).toEqual(
        HIDDEN,
      );
    }
  });

  it("窗口 resize 不会在隐藏状态下把视图撑满（核心回归）", () => {
    const { wm, window, tabManager, view } = setup();

    wm.setTargetViewVisible(true);
    wm.setTargetViewVisible(false);
    expect(view.bounds).toEqual(HIDDEN);

    // Resize / maximize / restore while the Inspector page is on screen.
    window.contentBounds = { x: 0, y: 0, width: 1920, height: 1080 };
    window.emit("resize");
    window.emit("resize");

    expect(view.bounds).toEqual(HIDDEN);
    expect(tabManager.getAllTabs()).toHaveLength(1);
  });

  it("隐藏期间上报的 bounds 被记住，重新显示时优先于布局回退值", () => {
    const { wm, view } = setup();
    const measured = { x: 240, y: 130, width: 900, height: 600 };

    // Renderer reports bounds (send) before visibility (invoke) is handled.
    wm.syncBrowserBounds(measured);
    expect(view.bounds).toEqual(HIDDEN);

    wm.setTargetViewVisible(true);

    expect(view.bounds).toEqual(measured);
    expect(view.bounds).not.toEqual(FALLBACK);
  });

  it("可见时 syncBrowserBounds 立即应用上报的 bounds", () => {
    const { wm, view } = setup();
    const measured = { x: 240, y: 130, width: 900, height: 600 };

    wm.setTargetViewVisible(true);
    wm.syncBrowserBounds(measured);

    expect(view.bounds).toEqual(measured);
  });

  it("上报的 bounds 被夹取到内容区域，避免遮挡工具栏", () => {
    const { wm, view } = setup();

    wm.setTargetViewVisible(true);
    wm.syncBrowserBounds({ x: -50, y: -10, width: 99999, height: 99999 });

    expect(view.bounds).toEqual({ x: 0, y: 0, width: 1400, height: 900 });
  });

  it("destroyTargetView 重置可见状态与记忆的 bounds", () => {
    const { wm } = setup();

    wm.setTargetViewVisible(true);
    wm.syncBrowserBounds({ x: 10, y: 10, width: 100, height: 100 });
    wm.destroyTargetView();

    expect(wm.isTargetViewVisible()).toBe(false);
    expect(wm.getTabManager()).toBeNull();
  });
});
