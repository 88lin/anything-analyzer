import { BrowserWindow, nativeImage } from "electron";
import { join } from "path";
import { TabManager } from "./tab-manager";
import { clampBoundsToContent } from "./window-bounds";

/** Custom titlebar height in renderer (px) */
const TITLEBAR_HEIGHT = 40;
/** Tab bar height in renderer (px) */
const TAB_BAR_HEIGHT = 33; // 32px height + 1px border-bottom

/**
 * WindowManager — Creates and manages the main BrowserWindow
 * and delegates embedded browser tabs to TabManager.
 */
export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private tabManager: TabManager | null = null;
  /** Browser area height ratio (0.0 ~ 1.0), default 70% */
  private browserRatio = 0.7;
  /**
   * Whether the browser view should be visible. Starts `false` so the native
   * view can only ever appear after the renderer explicitly asks for it: the
   * WebContentsView paints above the renderer DOM, so showing it too early
   * covers whatever page the renderer is displaying.
   */
  private targetViewVisible = false;
  /**
   * Last placeholder rectangle measured by the renderer. Kept even while the
   * view is hidden, because on the way back to the Browser page the renderer
   * reports bounds before `browser:setVisible` is handled.
   */
  private lastReportedBounds: Electron.Rectangle | null = null;

  /**
   * Create the main application window.
   */
  createMainWindow(): BrowserWindow {
    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      title: "Anything Analyzer",
      icon: nativeImage.createFromPath(join(__dirname, "../../resources/icon.png")),
      frame: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, "../preload/index.js"),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (process.env["ELECTRON_RENDERER_URL"]) {
      this.mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]).catch(() => {});
    } else {
      this.mainWindow.loadFile(join(__dirname, "../renderer/index.html")).catch(() => {});
    }

    return this.mainWindow;
  }

  /**
   * Initialize the tab manager and create the first (default) tab.
   */
  initTabs(): TabManager {
    if (!this.mainWindow) throw new Error("Main window not created");

    this.tabManager = new TabManager();
    this.tabManager.init(
      this.mainWindow,
      () => this.calculateTargetBounds(),
      () => this.targetViewVisible,
    );

    // Create the first tab
    this.tabManager.createTab();

    // Update bounds when window resizes
    this.mainWindow.on("resize", () => {
      this.tabManager?.updateBounds();
    });

    return this.tabManager;
  }

  /**
   * Navigate the active tab to a URL.
   */
  async navigateTo(url: string): Promise<void> {
    const wc = this.tabManager?.getActiveWebContents();
    if (!wc || wc.isDestroyed()) return;
    let normalizedUrl = url;
    if (!/^https?:\/\//i.test(url)) {
      normalizedUrl = `https://${url}`;
    }
    try {
      await wc.loadURL(normalizedUrl);
    } catch (err) {
      console.warn('[WindowManager] navigateTo failed:', (err as Error).message);
    }
  }

  /**
   * Go back in the active tab.
   */
  goBack(): void {
    const wc = this.tabManager?.getActiveWebContents();
    if (wc && !wc.isDestroyed() && wc.canGoBack()) wc.goBack();
  }

  /**
   * Go forward in the active tab.
   */
  goForward(): void {
    const wc = this.tabManager?.getActiveWebContents();
    if (wc && !wc.isDestroyed() && wc.canGoForward()) wc.goForward();
  }

  /**
   * Reload the active tab.
   */
  reload(): void {
    const wc = this.tabManager?.getActiveWebContents();
    if (wc && !wc.isDestroyed()) wc.reload();
  }

  /**
   * Get the main window instance.
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  /**
   * Get the TabManager instance.
   */
  getTabManager(): TabManager | null {
    return this.tabManager;
  }

  /** Propagate app shutdown state to tab manager. */
  setShuttingDown(shuttingDown: boolean): void {
    this.tabManager?.setShuttingDown(shuttingDown);
  }

  /**
   * Get the active tab's WebContents (for backward compatibility).
   */
  getTargetWebContents() {
    return this.tabManager?.getActiveWebContents() || null;
  }

  /**
   * Show or hide the active tab's browser view using bounds (not add/remove).
   */
  setTargetViewVisible(visible: boolean): void {
    this.targetViewVisible = visible;
    if (!this.mainWindow || !this.tabManager) return;

    if (!visible) {
      // Hide EVERY tab view, not just the active one. The native view always
      // paints above the renderer, so one stale view left visible by an earlier
      // race completely covers the Inspector / Report pages.
      this.tabManager.hideAllTabs();
      return;
    }

    this.applyBrowserBounds();
  }

  /**
   * Apply the best known bounds to the active tab view.
   * Prefers the renderer-measured placeholder rectangle over the fixed layout
   * fallback, which is only an estimate of the toolbar/tab-bar heights.
   */
  private applyBrowserBounds(): void {
    const tab = this.tabManager?.getActiveTab();
    if (!tab || !this.mainWindow) return;

    const contentBounds = this.mainWindow.getContentBounds();
    const target = clampBoundsToContent(
      this.lastReportedBounds ?? this.calculateTargetBounds(),
      contentBounds,
    );

    try {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.setBounds(target);
      }
    } catch { /* view destroyed */ }
  }

  /**
   * Whether the browser view is currently meant to be visible.
   */
  isTargetViewVisible(): boolean {
    return this.targetViewVisible;
  }

  /**
   * Calculate bounds for the target browser view area.
   * Browser view fills all remaining space below the tab bar + browser panel.
   * Sidebar (221px) is on the left.
   */
  private calculateTargetBounds(): Electron.Rectangle {
    if (!this.mainWindow) return { x: 0, y: 0, width: 0, height: 0 };

    const contentBounds = this.mainWindow.getContentBounds();
    const width = contentBounds.width;
    const height = contentBounds.height;
    const sidebarWidth = 221; // 220px sidebar + 1px border-right
    const browserPanelHeight = 49; // padding 8+8 + Input 32 + borderBottom 1
    const statusBarHeight = 26;
    const topOffset = TITLEBAR_HEIGHT + TAB_BAR_HEIGHT + browserPanelHeight;
    const browserHeight = Math.max(0, height - topOffset - statusBarHeight);

    return {
      x: sidebarWidth,
      y: topOffset,
      width: width - sidebarWidth,
      height: browserHeight,
    };
  }

  /**
   * Set the browser area height ratio and update bounds.
   * @param ratio 0.0 ~ 1.0
   */
  setBrowserRatio(ratio: number): void {
    this.browserRatio = Math.max(0.15, Math.min(0.85, ratio));
    // Don't call updateBounds here — the renderer will report exact bounds
    // via syncBrowserBounds after its layout updates.
  }

  /**
   * Set exact bounds for the active browser tab view.
   * Called by the renderer which measures the actual placeholder position.
   * Bounds are in DIP and must be clamped to the content area.  Without this,
   * Windows can preserve a stale oversized native WebContentsView after the
   * renderer changes layout; the native view then sits above the React toolbar
   * and consumes Start / Pause / Stop mouse input.
   *
   * The measurement is remembered even while the view is hidden: the renderer
   * reports bounds before `browser:setVisible(true)` is handled (it uses `send`
   * while visibility uses `invoke`), and dropping the report used to leave the
   * view at the guessed fallback bounds when returning to the Browser page.
   */
  syncBrowserBounds(bounds: Electron.Rectangle): void {
    const tab = this.tabManager?.getActiveTab();
    if (!tab || !this.mainWindow) return;

    const contentBounds = this.mainWindow.getContentBounds();
    this.lastReportedBounds = clampBoundsToContent(bounds, contentBounds);

    if (!this.targetViewVisible) return;

    try {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.setBounds(this.lastReportedBounds);
      }
    } catch { /* view destroyed */ }
  }

  /**
   * Get current browser area height ratio.
   */
  getBrowserRatio(): number {
    return this.browserRatio;
  }

  /**
   * Destroy all tabs and clean up.
   */
  destroyTargetView(): void {
    this.tabManager?.destroyEverything();
    this.tabManager = null;
    this.lastReportedBounds = null;
    this.targetViewVisible = false;
  }
}
