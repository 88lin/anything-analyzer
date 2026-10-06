import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import { BrowserWindow, WebContentsView } from "electron";
import type { WebContents, Session as ElectronSession } from "electron";
import { join } from "path";

interface TabInfo {
  id: string;
  view: WebContentsView;
  url: string;
  title: string;
  isLoading: boolean;
}

/** Snapshot of a session's tab group state (kept alive while hidden). */
interface SessionTabGroup {
  tabs: Map<string, TabInfo>;
  activeTabId: string | null;
  electronSession: ElectronSession;
}

/**
 * TabManager — Manages multiple browser tabs as WebContentsView instances.
 * Each tab gets its own WebContentsView, only the active tab is displayed.
 * Popup windows (window.open) are intercepted and opened as new tabs.
 *
 * Supports per-session tab groups: each app session owns an isolated set of
 * tabs. Switching sessions hides the old group and restores (or creates) the
 * new group — WebContentsView instances stay alive so page state is preserved.
 */
export class TabManager extends EventEmitter {
  /** Tabs for the currently visible session group. */
  private tabs = new Map<string, TabInfo>();
  private activeTabId: string | null = null;
  private mainWindow: BrowserWindow | null = null;
  private boundsCalculator: (() => Electron.Rectangle) | null = null;
  private visibilityChecker: (() => boolean) | null = null;
  /** Track destroyed tabs to avoid double-close */
  private destroyedTabs = new Set<string>();
  /** True when app is quitting: no tab recreation/new tabs allowed */
  private isShuttingDown = false;
  /** Electron session for the active app session (partition isolation) */
  private activeElectronSession: ElectronSession | null = null;

  // ---- Per-session tab groups ----
  /** Stored tab groups for sessions that are not currently visible. */
  private sessionGroups = new Map<string, SessionTabGroup>();
  /** The session group ID currently driving `this.tabs`. */
  private currentGroupId: string | null = null;

  /**
   * Initialize with the main window and a bounds calculator callback.
   */
  init(
    mainWindow: BrowserWindow,
    boundsCalculator: () => Electron.Rectangle,
    visibilityChecker?: () => boolean,
  ): void {
    this.mainWindow = mainWindow;
    this.boundsCalculator = boundsCalculator;
    this.visibilityChecker = visibilityChecker ?? null;
  }

  /**
   * Switch the visible tab group to a different session.
   * - Hides (but keeps alive) the current session's tabs.
   * - Restores a previously stored group, or creates a blank tab if first visit.
   * - Emits tab events so the renderer UI stays in sync.
   *
   * Returns true if a new blank tab was created (caller may want to navigate).
   */
  switchSessionGroup(groupId: string, elSession: ElectronSession): boolean {
    if (this.currentGroupId === groupId) return false;

    // 1. Stash current group ---------------------------------------------------
    if (this.currentGroupId !== null) {
      // Remove ALL tab views from the window (stashing this group)
      this.detachAllViews();

      this.sessionGroups.set(this.currentGroupId, {
        tabs: this.tabs,
        activeTabId: this.activeTabId,
        electronSession: this.activeElectronSession!,
      });

      // Tell renderer to clear its tab list (emit close for every visible tab)
      for (const [, tab] of this.tabs) {
        this.emit("tab-closed", { tabId: tab.id });
      }
    } else if (this.tabs.size > 0) {
      // First-ever switch: there may be initial default-session tabs.
      // Stash them under a special key so they don't leak.
      this.detachAllViews();
      for (const [, tab] of this.tabs) {
        this.emit("tab-closed", { tabId: tab.id });
      }
      // Destroy default-session tabs — they can't be reused in a partition
      for (const [tabId, tab] of this.tabs) {
        try { tab.view.webContents.close(); } catch { /* ignore */ }
        this.destroyedTabs.add(tabId);
      }
    }

    // Reset working state
    this.tabs = new Map();
    this.activeTabId = null;
    this.activeElectronSession = elSession;
    this.currentGroupId = groupId;

    // 2. Restore or create group -----------------------------------------------
    const existing = this.sessionGroups.get(groupId);
    let createdNew = false;

    if (existing && existing.tabs.size > 0) {
      // Restore previously stashed tabs
      this.tabs = existing.tabs;
      this.activeElectronSession = existing.electronSession;
      this.sessionGroups.delete(groupId);

      // Re-add all views as children (hidden) — they were detached when stashed
      if (this.mainWindow) {
        for (const [, tab] of this.tabs) {
          try {
            tab.view.setBounds(TabManager.HIDDEN_BOUNDS);
            this.mainWindow.contentView.addChildView(tab.view);
          } catch { /* view may have been destroyed */ }
        }
      }

      // Notify renderer about restored tabs
      for (const [, tab] of this.tabs) {
        this.emit("tab-created", { id: tab.id, url: tab.url, title: tab.title });
      }

      // Activate the tab that was active before
      const restoreId =
        existing.activeTabId && this.tabs.has(existing.activeTabId)
          ? existing.activeTabId
          : this.tabs.keys().next().value;
      if (restoreId) {
        this.activateTab(restoreId);
      }
    } else {
      // First visit to this session — create a blank tab
      this.sessionGroups.delete(groupId); // remove stale empty entry if any
      this.createTab();
      createdNew = true;
    }

    return createdNew;
  }

  /**
   * Destroy all tabs belonging to a specific session group.
   * Used when deleting a session.
   */
  destroySessionGroup(groupId: string): void {
    // If it's the current group, clear visible tabs
    if (this.currentGroupId === groupId) {
      this.destroyAllTabs();
      this.currentGroupId = null;
      return;
    }
    // Otherwise destroy the stashed group
    const group = this.sessionGroups.get(groupId);
    if (group) {
      for (const [tabId, tab] of group.tabs) {
        try { tab.view.webContents.close(); } catch { /* ignore */ }
        this.destroyedTabs.add(tabId);
      }
      this.sessionGroups.delete(groupId);
    }
  }

  /** Zero-size rectangle used to hide inactive tabs (avoids removeChildView). */
  private static readonly HIDDEN_BOUNDS = { x: 0, y: 0, width: 0, height: 0 };

  /**
   * Create a new tab. Optionally navigate to a URL.
   * The new tab becomes the active tab.
   */
  createTab(url?: string): TabInfo {
    if (!this.mainWindow) throw new Error("TabManager not initialized");

    const id = uuidv4();
    const view = new WebContentsView({
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        preload: join(__dirname, "../preload/target-preload.js"),
        ...(this.activeElectronSession
          ? { session: this.activeElectronSession }
          : {}),
      },
    });

    // Set dark background to avoid white flash while loading
    view.setBackgroundColor("#1a1a2e");

    const tab: TabInfo = { id, view, url: url || "", title: "New Tab", isLoading: false };
    this.tabs.set(id, tab);

    // Raise max listeners — our code + stealth/capture/injector + Electron internals
    // easily exceed the default 10 for a single WebContents.
    view.webContents.setMaxListeners(30);

    // Add view as a child immediately (hidden). activateTab will show it.
    // We keep ALL tab views as children to avoid native widget detach/reattach
    // which triggers blink.mojom.WidgetHost crashes.
    view.setBounds(TabManager.HIDDEN_BOUNDS);
    try {
      this.mainWindow.contentView.addChildView(view);
    } catch { /* window may be destroyed */ }

    this.setupTabListeners(tab);
    this.activateTab(id);

    if (url) {
      view.webContents.loadURL(url).catch(() => {
        // Navigation might fail for invalid URLs
      });
    }

    this.emit("tab-created", { id: tab.id, url: tab.url, title: tab.title });
    return tab;
  }

  /**
   * Close a tab. If closing the last tab, create a new blank tab first.
   */
  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    const isLastTab = this.tabs.size <= 1;

    // If this is the last tab, create a replacement before closing
    if (isLastTab) {
      this.createTab();
    }

    // If closing the active tab, activate another one first
    if (this.activeTabId === tabId) {
      const tabIds = Array.from(this.tabs.keys());
      const idx = tabIds.indexOf(tabId);
      const nextId = tabIds[idx + 1] || tabIds[idx - 1];
      if (nextId) {
        this.activateTab(nextId);
      }
    }

    this.tabs.delete(tabId);
    this.destroyedTabs.add(tabId);

    // Now remove from window and destroy (only removeChildView on actual destruction)
    if (this.mainWindow) {
      try {
        this.mainWindow.contentView.removeChildView(tab.view);
      } catch { /* already removed */ }
    }
    try {
      tab.view.webContents.close();
    } catch { /* already destroyed */ }

    this.emit("tab-closed", { tabId });
  }

  /**
   * Switch the active tab. Hides the other tabs (zero bounds) and shows the new one.
   * Views are never removed/re-added — only bounds change — to avoid
   * blink.mojom.WidgetHost Mojo IPC crashes.
   */
  activateTab(tabId: string): void {
    if (!this.mainWindow) return;
    const tab = this.tabs.get(tabId);
    if (!tab) return;

    // Hide every other view in the group — not only the previously active one.
    // A single stale visible native view is enough to cover the whole renderer,
    // so "at most one visible view" is enforced here rather than at each caller.
    for (const [id, other] of this.tabs) {
      if (id !== tabId) this.setTabBounds(other, TabManager.HIDDEN_BOUNDS);
    }

    this.activeTabId = tabId;

    // Show the new tab with proper bounds (or hide if browser area is invisible)
    if (this.isBrowserAreaVisible() && this.boundsCalculator) {
      this.setTabBounds(tab, this.boundsCalculator());
    } else {
      this.setTabBounds(tab, TabManager.HIDDEN_BOUNDS);
    }

    this.emit("tab-activated", { tabId, url: tab.url, title: tab.title });
  }

  /**
   * Update bounds on the active tab (e.g., on window resize).
   *
   * MUST respect the visibility checker. WebContentsView always paints above the
   * renderer DOM, so a resize while the Inspector / Report page is on screen used
   * to re-expand the hidden native view to full size and cover that entire page.
   */
  updateBounds(): void {
    if (!this.boundsCalculator) return;
    const tab = this.activeTabId ? this.tabs.get(this.activeTabId) : null;
    if (!tab) return;

    if (!this.isBrowserAreaVisible()) {
      this.setTabBounds(tab, TabManager.HIDDEN_BOUNDS);
      return;
    }
    this.setTabBounds(tab, this.boundsCalculator());
  }

  /**
   * Move every tab view in the current group to the hidden rectangle.
   *
   * Hiding all of them — not just the active one — makes "hidden" an invariant:
   * any single view left with stale visible bounds covers the renderer entirely.
   */
  hideAllTabs(): void {
    for (const [, tab] of this.tabs) {
      this.setTabBounds(tab, TabManager.HIDDEN_BOUNDS);
    }
  }

  /** Whether the native browser area is currently meant to be visible. */
  private isBrowserAreaVisible(): boolean {
    return this.visibilityChecker ? this.visibilityChecker() : true;
  }

  /** Apply bounds to a tab view, tolerating a destroyed webContents. */
  private setTabBounds(tab: TabInfo, bounds: Electron.Rectangle): void {
    try {
      if (!tab.view.webContents.isDestroyed()) {
        tab.view.setBounds(bounds);
      }
    } catch { /* view destroyed */ }
  }

  getActiveTab(): TabInfo | null {
    if (!this.activeTabId) return null;
    return this.tabs.get(this.activeTabId) || null;
  }

  getActiveWebContents(): WebContents | null {
    return this.getActiveTab()?.view.webContents || null;
  }

  getAllTabs(): TabInfo[] {
    return Array.from(this.tabs.values());
  }

  /** Mark manager as shutting down (disables tab auto-recreation paths). */
  setShuttingDown(shuttingDown: boolean): void {
    this.isShuttingDown = shuttingDown;
  }

  /** Set the Electron session used for new tabs (partition isolation). */
  setActiveElectronSession(s: ElectronSession | null): void {
    this.activeElectronSession = s;
  }

  /** Get the current session group ID. */
  getCurrentGroupId(): string | null {
    return this.currentGroupId;
  }

  /**
   * Destroy all tabs and clean up (current visible group only).
   */
  destroyAllTabs(): void {
    for (const [tabId, tab] of this.tabs) {
      if (this.mainWindow) {
        try { this.mainWindow.contentView.removeChildView(tab.view); } catch { /* ignore */ }
      }
      try { tab.view.webContents.close(); } catch { /* ignore */ }
      this.destroyedTabs.add(tabId);
    }
    this.tabs.clear();
    this.activeTabId = null;
  }

  /**
   * Destroy ALL tabs across ALL session groups (used on app quit).
   */
  destroyEverything(): void {
    this.destroyAllTabs();
    for (const [, group] of this.sessionGroups) {
      for (const [tabId, tab] of group.tabs) {
        try { tab.view.webContents.close(); } catch { /* ignore */ }
        this.destroyedTabs.add(tabId);
      }
    }
    this.sessionGroups.clear();
  }

  // ---- Internal helpers ----

  /**
   * Remove ALL current-group tab views from the window.
   * Used when stashing a session group — those views will sit dormant and
   * must not remain as children (they belong to a different partition).
   */
  private detachAllViews(): void {
    if (!this.mainWindow) return;
    for (const [, tab] of this.tabs) {
      try {
        this.mainWindow.contentView.removeChildView(tab.view);
      } catch { /* not in view */ }
    }
  }

  /**
   * Set up event listeners on a tab's WebContents.
   */
  private setupTabListeners(tab: TabInfo): void {
    const wc = tab.view.webContents;

    // Prevent page scripts from closing the window via window.close()
    // This avoids crashes when the WebContentsView is destroyed unexpectedly.
    wc.on("will-prevent-unload", (event) => {
      // Always prevent the close — do not show the "Leave site?" dialog
      event.preventDefault();
    });

    // Track loading state
    wc.on("did-start-loading", () => {
      if (wc.isDestroyed()) return;
      tab.isLoading = true;
      this.emit("tab-updated", {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        isLoading: true,
      });
    });
    wc.on("did-stop-loading", () => {
      if (wc.isDestroyed()) return;
      tab.isLoading = false;
      this.emit("tab-updated", {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
        isLoading: false,
      });
    });

    // Handle page load failures — show inline error instead of white screen
    wc.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (wc.isDestroyed()) return;
      if (!isMainFrame) return; // Ignore sub-frame failures
      if (errorCode === -3) return; // ERR_ABORTED — user navigated away, not a real error

      // Sanitize values to prevent XSS in the error page
      const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const safeDesc = esc(errorDescription || "");
      const safeUrl = esc(validatedURL || "");
      // Encode the original URL for the retry button (safe inside a JS string literal)
      const retryUrl = JSON.stringify(validatedURL || "");

      const errorPage = `data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html><html><head><style>
          body { background: #1a1a2e; color: #a0a0b8; font-family: -apple-system, system-ui, sans-serif;
            display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .box { text-align: center; max-width: 420px; }
          h2 { color: #e0e0f0; margin-bottom: 8px; }
          code { background: #2a2a4a; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
          .url { word-break: break-all; color: #7a7a9a; font-size: 13px; margin-top: 12px; }
          button { margin-top: 16px; background: #3a3a6a; border: none; color: #e0e0f0; padding: 8px 20px;
            border-radius: 6px; cursor: pointer; font-size: 13px; }
          button:hover { background: #4a4a8a; }
        </style></head><body><div class="box">
          <h2>\u65E0\u6CD5\u52A0\u8F7D\u6B64\u9875\u9762</h2>
          <p><code>${errorCode}</code> ${safeDesc}</p>
          <p class="url">${safeUrl}</p>
          <button onclick="location.href=${retryUrl.replace(/"/g, '&quot;')}">\u91CD\u8BD5</button>
        </div></body></html>
      `)}`;
      wc.loadURL(errorPage).catch(() => {});
    });

    // Override window.close() in page context to make it a no-op
    wc.on("did-finish-load", () => {
      if (wc.isDestroyed()) return;
      wc.executeJavaScript("window.close = function() {};").catch(() => {});
    });
    wc.on("did-navigate-in-page", () => {
      if (wc.isDestroyed()) return;
      wc.executeJavaScript("window.close = function() {};").catch(() => {});
    });

    // Intercept window.open / target="_blank" — open as new internal tab
    wc.setWindowOpenHandler((details) => {
      // Create a new tab with the popup URL
      this.createTab(details.url);
      return { action: "deny" };
    });

    // Track URL changes
    const onNavigate = (): void => {
      if (wc.isDestroyed()) return;
      tab.url = wc.getURL();
      this.emit("tab-updated", {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
      });
    };
    wc.on("did-navigate", onNavigate);
    wc.on("did-navigate-in-page", onNavigate);

    // Track title changes
    wc.on("page-title-updated", (_event, title) => {
      if (wc.isDestroyed()) return;
      tab.title = title;
      this.emit("tab-updated", {
        tabId: tab.id,
        url: tab.url,
        title: tab.title,
      });
    });

    // Handle renderer process crash (GPU OOM, heavy WebGL, etc.)
    // Without this, the dead webContents stays in the view tree and any
    // subsequent operation on it crashes the main process.
    wc.on("render-process-gone", (_event, details) => {
      if (this.destroyedTabs.has(tab.id) || !this.tabs.has(tab.id)) return;
      if (this.isShuttingDown) return;

      console.warn(`[TabManager] Renderer process gone for tab ${tab.id}: ${details.reason}`);

      // Show a crash recovery page by replacing the tab
      const crashUrl = tab.url;
      const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const safeUrl = esc(crashUrl);

      // Remove the crashed view from the window and destroy it
      if (this.mainWindow) {
        try { this.mainWindow.contentView.removeChildView(tab.view); } catch { /* already removed */ }
      }
      try { tab.view.webContents.close(); } catch { /* already dead */ }
      this.tabs.delete(tab.id);
      this.destroyedTabs.add(tab.id);
      if (this.activeTabId === tab.id) this.activeTabId = null;
      this.emit("tab-closed", { tabId: tab.id });

      // Create a new tab with crash info page
      const crashPage = `data:text/html;charset=utf-8,${encodeURIComponent(`
        <!DOCTYPE html><html><head><style>
          body { background: #1a1a2e; color: #a0a0b8; font-family: -apple-system, system-ui, sans-serif;
            display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          .box { text-align: center; max-width: 420px; }
          h2 { color: #e0e0f0; margin-bottom: 8px; }
          code { background: #2a2a4a; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
          .url { word-break: break-all; color: #7a7a9a; font-size: 13px; margin-top: 12px; }
          button { margin-top: 16px; background: #3a3a6a; border: none; color: #e0e0f0; padding: 8px 20px;
            border-radius: 6px; cursor: pointer; font-size: 13px; }
          button:hover { background: #4a4a8a; }
        </style></head><body><div class="box">
          <h2>\\u9875\\u9762\\u5D29\\u6E83\\u4E86</h2>
          <p>\\u8BE5\\u9875\\u9762\\u7684\\u6E32\\u67D3\\u8FDB\\u7A0B\\u5DF2\\u7EC8\\u6B62</p>
          <p class="url">${safeUrl}</p>
          <button onclick="location.href=${JSON.stringify(crashUrl).replace(/"/g, '&quot;')}">\\u91CD\\u65B0\\u52A0\\u8F7D</button>
        </div></body></html>
      `)}`;
      this.createTab(crashPage);
    });

    // Handle unexpected WebContents destruction (e.g., window.close()
    // bypassed our safeguards). Clean up gracefully instead of crashing.
    wc.on("destroyed", () => {
      if (this.destroyedTabs.has(tab.id) || !this.tabs.has(tab.id)) return;

      // During app quit, WebContents are expected to be destroyed; do not recreate tabs.
      if (this.isShuttingDown) {
        this.tabs.delete(tab.id);
        this.destroyedTabs.add(tab.id);
        if (this.activeTabId === tab.id) this.activeTabId = null;
        this.emit("tab-closed", { tabId: tab.id });
        return;
      }

      // If this is the last tab, replace it with a new blank tab
      // instead of letting the app crash with no view.
      if (this.tabs.size <= 1) {
        this.tabs.delete(tab.id);
        this.destroyedTabs.add(tab.id);
        this.activeTabId = null;
        // Remove destroyed view from window
        if (this.mainWindow) {
          try { this.mainWindow.contentView.removeChildView(tab.view); } catch { /* already removed */ }
        }
        // Create a replacement tab
        this.createTab();
        this.emit("tab-closed", { tabId: tab.id });
      } else {
        this.closeTab(tab.id);
      }
    });
  }
}
