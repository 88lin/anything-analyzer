import { beforeEach, describe, expect, it, vi } from "vitest";
import { TabManager } from "../../src/main/tab-manager";

/**
 * Regression tests for the native browser view covering the renderer.
 *
 * A `WebContentsView` always paints above the renderer DOM, so a single tab view
 * left with non-zero bounds covers whatever page React is showing (Inspector /
 * Report). The invariant under test: while the browser area is not visible, every
 * tab view must stay at HIDDEN_BOUNDS, and at most one view may be visible.
 */

const h = vi.hoisted(() => {
  class FakeWebContents {
    destroyed = false;
    private listeners = new Map<string, Array<(...args: unknown[]) => void>>();

    setMaxListeners(): this {
      return this;
    }
    on(event: string, cb: (...args: unknown[]) => void): this {
      const list = this.listeners.get(event) ?? [];
      list.push(cb);
      this.listeners.set(event, list);
      return this;
    }
    once(event: string, cb: (...args: unknown[]) => void): this {
      return this.on(event, cb);
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
    getContentBounds(): { x: number; y: number; width: number; height: number } {
      return { ...this.contentBounds };
    }
    on(): this {
      return this;
    }
  }

  return { FakeWebContentsView, FakeBrowserWindow };
});

vi.mock("electron", () => ({
  WebContentsView: h.FakeWebContentsView,
  BrowserWindow: h.FakeBrowserWindow,
  nativeImage: { createFromPath: () => ({}) },
}));

const VISIBLE_BOUNDS = { x: 221, y: 122, width: 1179, height: 752 };
const HIDDEN = { x: 0, y: 0, width: 0, height: 0 };

function setup(initiallyVisible: boolean) {
  const visible = { value: initiallyVisible };
  const window = new h.FakeBrowserWindow();
  const manager = new TabManager();
  manager.init(window as never, () => ({ ...VISIBLE_BOUNDS }), () => visible.value);
  return { manager, window, visible };
}

/** Bounds of every tab view in the current group, in creation order. */
function allBounds(manager: TabManager) {
  return manager
    .getAllTabs()
    .map((tab) => (tab.view as unknown as InstanceType<typeof h.FakeWebContentsView>).bounds);
}

function viewBounds(view: unknown) {
  return (view as InstanceType<typeof h.FakeWebContentsView>).bounds;
}

describe("TabManager native-view visibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("创建 tab 时若浏览器区域不可见，视图保持隐藏", () => {
    const { manager } = setup(false);
    manager.createTab();

    expect(allBounds(manager)).toEqual([HIDDEN]);
  });

  it("窗口 resize 时若浏览器区域不可见，不得把隐藏视图撑满（核心回归）", () => {
    const { manager, visible } = setup(true);
    manager.createTab();
    expect(allBounds(manager)).toEqual([VISIBLE_BOUNDS]);

    // Renderer switches to Inspector/Report: the native view is hidden.
    visible.value = false;
    manager.hideAllTabs();
    expect(allBounds(manager)).toEqual([HIDDEN]);

    // User resizes / maximizes / restores the window while on another page.
    // This used to re-expand the hidden view to full size and cover the page.
    manager.updateBounds();
    manager.updateBounds();

    expect(allBounds(manager)).toEqual([HIDDEN]);
  });

  it("可见时 updateBounds 应用 bounds 计算器结果", () => {
    const { manager } = setup(true);
    manager.createTab();

    manager.updateBounds();

    expect(allBounds(manager)).toEqual([VISIBLE_BOUNDS]);
  });

  it("hideAllTabs 隐藏当前分组内的所有视图", () => {
    const { manager } = setup(true);
    manager.createTab();
    manager.createTab();
    manager.createTab();

    expect(allBounds(manager)).toHaveLength(3);
    // activateTab keeps exactly one visible; hideAllTabs must clear all of them.
    manager.hideAllTabs();

    expect(allBounds(manager)).toEqual([HIDDEN, HIDDEN, HIDDEN]);
  });

  it("activateTab 隐藏所有非激活视图（至多一个可见的不变量）", () => {
    const { manager } = setup(true);
    const first = manager.createTab();
    manager.createTab();
    const third = manager.createTab();

    manager.activateTab(first.id);
    const bounds = allBounds(manager);
    const visibleCount = bounds.filter((b) => b.width > 0 && b.height > 0).length;

    expect(visibleCount).toBe(1);
    expect(viewBounds(first.view)).toEqual(VISIBLE_BOUNDS);
    expect(bounds.filter((b) => b.width === 0 && b.height === 0)).toHaveLength(2);

    // Switching to the last tab must also hide the previously active one.
    manager.activateTab(third.id);
    const afterSwitch = allBounds(manager);
    expect(afterSwitch.filter((b) => b.width > 0 && b.height > 0)).toHaveLength(1);
    expect(viewBounds(third.view)).toEqual(VISIBLE_BOUNDS);
  });

  it("不可见状态下激活 tab 不会让视图显示出来", () => {
    const { manager } = setup(false);
    const first = manager.createTab();
    const second = manager.createTab();

    manager.activateTab(first.id);
    manager.activateTab(second.id);

    expect(allBounds(manager)).toEqual([HIDDEN, HIDDEN]);
  });

  it("destroyed webContents 不会被写入 bounds（不抛异常）", () => {
    const { manager } = setup(true);
    const tab = manager.createTab();
    (tab.view as unknown as { webContents: { close: () => void } }).webContents.close();

    expect(() => manager.updateBounds()).not.toThrow();
    expect(() => manager.hideAllTabs()).not.toThrow();
  });
});
