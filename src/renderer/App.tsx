import React, { useState, useCallback, useRef, useEffect } from 'react'

import Titlebar from './components/Titlebar'
import type { AppView } from './components/Titlebar'
import StatusBar from './components/StatusBar'
import SessionList from './components/SessionList'
import BrowserPanel from './components/BrowserPanel'
import TabBar from './components/TabBar'
import AnalyzeBar from './components/AnalyzeBar'
import SettingsModal from './components/SettingsModal'
import RequestLog from './components/RequestLog'
import RequestDetail from './components/RequestDetail'
import HookLog from './components/HookLog'
import StorageView from './components/StorageView'
import ReportView from './components/ReportView'
import { useSession } from './hooks/useSession'
import { useCapture } from './hooks/useCapture'
import { useTabs } from './hooks/useTabs'
import { useToast } from './ui/Toast'
import { LocaleProvider } from './i18n'
import { zh } from './i18n/zh'
import { en } from './i18n/en'
import type { LocaleKey } from './i18n'

function App(): React.ReactElement {
  const toast = useToast()

  const {
    sessions,
    currentSessionId,
    currentSession,
    loadSessions,
    createSession,
    selectSession,
    deleteSession,
    startCapture,
    resumeCapture,
    pauseCapture,
    stopCapture
  } = useSession()

  const { tabs, activeTabId, activeTabUrl, activateTab, closeTab, createTab } = useTabs()

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [activeView, setActiveView] = useState<AppView>('browser')

  // Theme & locale state (persisted to localStorage)
  const [appTheme, setAppTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('app-theme') as 'dark' | 'light') || 'dark'
  })
  const [appLocale, setAppLocale] = useState<'en' | 'zh'>(() => {
    return (localStorage.getItem('app-locale') as 'en' | 'zh') || 'zh'
  })

  // Simple t() for App-level strings (outside LocaleProvider context)
  const localeMaps: Record<string, Record<string, string>> = { zh, en }
  const t = useCallback((key: LocaleKey, vars?: Record<string, string | number>) => {
    let text = localeMaps[appLocale]?.[key] ?? zh[key] ?? key
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        text = text.replace(`{${k}}`, String(v))
      })
    }
    return text
  }, [appLocale]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleThemeToggle = useCallback(() => {
    setAppTheme(prev => {
      const next = prev === 'dark' ? 'light' : 'dark'
      localStorage.setItem('app-theme', next)
      document.documentElement.setAttribute('data-theme', next)
      return next
    })
  }, [])

  const handleLocaleToggle = useCallback(() => {
    setAppLocale(prev => {
      const next = prev === 'zh' ? 'en' : 'zh'
      localStorage.setItem('app-locale', next)
      return next
    })
  }, [])

  // Apply theme attribute on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', appTheme)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openSettings = useCallback(() => {
    setSettingsOpen(true)
    window.electronAPI.setTargetViewVisible(false)
  }, [])

  const closeSettings = useCallback(() => {
    setSettingsOpen(false)
    if (activeView === 'browser') {
      window.electronAPI.setTargetViewVisible(true)
    }
  }, [activeView])

  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null)
  const [selectedSeqs, setSelectedSeqs] = useState<number[]>([])
  const [activeTab, setActiveTab] = useState('requests')

  /** Ref to browser placeholder for reporting exact bounds to main process */
  const placeholderRef = useRef<HTMLDivElement>(null)

  const { requests, hooks, snapshots, reports, isAnalyzing, analysisError, streamingContent, startAnalysis, cancelAnalysis, chatHistory, isChatting, chatError, sendFollowUp, clearCaptureData } = useCapture(currentSessionId)

  const selectedRequest = requests.find(r => r.id === selectedRequestId) || null

  // Navigate browser to session URL when session changes
  useEffect(() => {
    setSelectedSeqs([])
    setSelectedRequestId(null)
    if (currentSession?.target_url) {
      window.electronAPI.navigate(currentSession.target_url).catch((err) => {
        console.error('Session navigation failed:', err)
      })
    }
  }, [currentSessionId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Report exact browser placeholder bounds to main process via ResizeObserver
  useEffect(() => {
    const el = placeholderRef.current
    if (!el) return

    const reportBounds = () => {
      const rect = el.getBoundingClientRect()
      window.electronAPI.syncBrowserBounds({
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    }

    const observer = new ResizeObserver(reportBounds)
    observer.observe(el)
    reportBounds()

    return () => observer.disconnect()
  }, [])

  // Hide/show browser view based on active view
  useEffect(() => {
    if (activeView === 'browser') {
      window.electronAPI.setTargetViewVisible(true)
    } else {
      window.electronAPI.setTargetViewVisible(false)
    }
  }, [activeView])

  // Browser navigation handlers
  const handleNavigate = useCallback(async (url: string) => {
    try { await window.electronAPI.navigate(url) } catch (err) { console.error('Navigation failed:', err) }
  }, [])

  const handleBack = useCallback(async () => {
    try { await window.electronAPI.goBack() } catch (err) { console.error('Go back failed:', err) }
  }, [])

  const handleForward = useCallback(async () => {
    try { await window.electronAPI.goForward() } catch (err) { console.error('Go forward failed:', err) }
  }, [])

  const handleReload = useCallback(async () => {
    try { await window.electronAPI.reload() } catch (err) { console.error('Reload failed:', err) }
  }, [])

  // Analyze handler
  const handleAnalyze = useCallback(async (purpose?: string) => {
    if (!currentSessionId) return
    setActiveView('report')
    await startAnalysis(currentSessionId, purpose, selectedSeqs.length > 0 ? selectedSeqs : undefined)
  }, [currentSessionId, startAnalysis, selectedSeqs])

  // Cancel analysis handler
  const handleCancelAnalysis = useCallback(async () => {
    if (!currentSessionId) return
    await cancelAnalysis(currentSessionId)
  }, [currentSessionId, cancelAnalysis])

  // Export requests handler
  const handleExport = useCallback(async () => {
    if (!currentSessionId) return
    try {
      await window.electronAPI.exportRequests(currentSessionId)
    } catch (err) {
      console.error('Export failed:', err)
    }
  }, [currentSessionId])

  // Clear browser environment
  const handleClearEnv = useCallback(async () => {
    try {
      await window.electronAPI.clearBrowserEnv()
      toast.success(t('toast.envCleared'))
    } catch (err) {
      console.error('Clear env failed:', err)
      toast.error(t('toast.envClearFailed'))
    }
  }, [toast])

  // Clear capture data for re-analysis
  const handleClearData = useCallback(async () => {
    if (!currentSessionId) return
    try {
      await clearCaptureData(currentSessionId)
      setSelectedRequestId(null)
      setSelectedSeqs([])
      toast.success(t('toast.dataCleared'))
    } catch (err) {
      console.error('Clear data failed:', err)
      toast.error(t('toast.dataClearFailed'))
    }
  }, [currentSessionId, clearCaptureData, toast])

  const handleFollowUp = useCallback(async (msg: string) => {
    if (!currentSessionId) return
    await sendFollowUp(currentSessionId, msg)
  }, [currentSessionId, sendFollowUp])

  // Pill button style for capture controls in browser address bar
  const pillStyle: React.CSSProperties = {
    padding: '5px 14px',
    borderRadius: 6,
    fontSize: 'var(--font-size-2xs)',
    cursor: 'pointer',
    border: 'none',
    whiteSpace: 'nowrap',
    lineHeight: 1.2,
    fontWeight: 600,
    fontFamily: 'var(--font-sans)',
  }
  const pillActive: React.CSSProperties = { ...pillStyle, background: 'var(--color-success-bg)', color: 'var(--color-success)', border: '1px solid var(--color-success-border)' }
  const pillDefault: React.CSSProperties = { ...pillStyle, background: 'var(--color-active)', color: 'var(--text-muted)' }
  const pillStart: React.CSSProperties = { ...pillStyle, background: 'var(--color-success)', color: '#000', padding: '5px 18px' }

  // Build capture slot for BrowserPanel
  const buildCaptureSlot = () => {
    if (!currentSessionId) return null
    if (!currentSession?.status || currentSession.status === 'stopped') {
      return <button style={pillStart} onClick={startCapture}>● {t('browser.start')}</button>
    }
    if (currentSession.status === 'running') {
      return (
        <>
          <button style={pillActive}>● {t('browser.start')}</button>
          <button style={pillDefault} onClick={pauseCapture}>⏸ {t('browser.pause')}</button>
          <button style={pillDefault} onClick={stopCapture}>■ {t('browser.stop')}</button>
        </>
      )
    }
    if (currentSession.status === 'paused') {
      return (
        <>
          <button style={{ ...pillDefault, background: 'var(--color-warning-bg)', color: 'var(--color-warning)' }}>⏸ {t('browser.pause')}</button>
          <button style={pillStart} onClick={resumeCapture}>▶ {t('browser.resume')}</button>
          <button style={pillDefault} onClick={stopCapture}>■ {t('browser.stop')}</button>
        </>
      )
    }
    return null
  }

  // Render the Browser view — ONLY browser, no data panel
  const renderBrowserView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      {/* Browser tab bar */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onActivate={activateTab}
        onClose={closeTab}
        onCreate={() => createTab()}
      />

      {/* Browser panel - address bar + nav buttons + capture pills */}
      <BrowserPanel
        currentUrl={activeTabUrl}
        onNavigate={handleNavigate}
        onBack={handleBack}
        onForward={handleForward}
        onReload={handleReload}
        captureSlot={buildCaptureSlot()}
      />

      {/* Browser view placeholder — native WebContentsView overlays this area */}
      <div
        ref={placeholderRef}
        style={{
          flex: 1,
          position: 'relative',
          minHeight: 80
        }}
      />
    </div>
  )

  // Inspector sub-tab styles
  const inspectorTabStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-2xs)',
    color: 'var(--text-muted)',
    display: 'flex',
    alignItems: 'center',
    position: 'relative',
    cursor: 'pointer',
    letterSpacing: '0.3px',
    padding: '0',
    background: 'none',
    border: 'none',
    fontFamily: 'var(--font-sans)',
    height: '100%',
  }
  const inspectorTabActiveStyle: React.CSSProperties = {
    ...inspectorTabStyle,
    color: 'var(--text-primary)',
    borderBottom: '1px solid var(--text-primary)',
  }
  const inspectorTabCountStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-3xs)',
    color: 'var(--text-muted)',
    marginLeft: 5,
  }

  // Render the Inspector view — sub-tabs + left/right split + bottom AnalyzeBar
  const renderInspectorView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      {currentSession ? (
        <>
          {/* Sub-tabs: Requests / Hooks / Storage + Capture controls */}
          <div style={{
            height: 36,
            background: 'var(--color-bar)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'stretch',
            padding: '0 16px',
            gap: 24,
            flexShrink: 0,
          }}>
            <button
              style={activeTab === 'requests' ? inspectorTabActiveStyle : inspectorTabStyle}
              onClick={() => setActiveTab('requests')}
            >
              {t('data.requests')} <span style={inspectorTabCountStyle}>{requests.length}</span>
            </button>
            <button
              style={activeTab === 'hooks' ? inspectorTabActiveStyle : inspectorTabStyle}
              onClick={() => setActiveTab('hooks')}
            >
              {t('data.hooks')} <span style={inspectorTabCountStyle}>{hooks.length}</span>
            </button>
            <button
              style={activeTab === 'storage' ? inspectorTabActiveStyle : inspectorTabStyle}
              onClick={() => setActiveTab('storage')}
            >
              {t('data.storage')} <span style={inspectorTabCountStyle}>{snapshots.length}</span>
            </button>

            {/* Spacer */}
            <div style={{ flex: 1 }} />

            {/* Capture controls in Inspector */}
            {currentSessionId && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {buildCaptureSlot()}
              </div>
            )}
          </div>

          {/* Tab content */}
          {activeTab === 'requests' ? (
            /* Left-right split: request list (420px) + detail panel */
            <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
              <div style={{ flex: 1, minWidth: 400, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <RequestLog requests={requests} selectedId={selectedRequestId} onSelect={(r) => setSelectedRequestId(r.id)} selectedSeqs={selectedSeqs} onSelectedSeqsChange={setSelectedSeqs} />
              </div>
              <div style={{ width: 400, minWidth: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <RequestDetail request={selectedRequest} hooks={hooks} />
              </div>
            </div>
          ) : activeTab === 'hooks' ? (
            <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
              <HookLog hooks={hooks} />
            </div>
          ) : (
            <div style={{ flex: 1, overflow: 'auto', padding: '0 12px' }}>
              <StorageView snapshots={snapshots} />
            </div>
          )}

          {/* Bottom AnalyzeBar */}
          <AnalyzeBar
            onAnalyze={handleAnalyze}
            onExport={handleExport}
            hasRequests={requests.length > 0}
            isAnalyzing={isAnalyzing}
            isStopped={currentSession.status !== 'running'}
            selectedSeqCount={selectedSeqs.length}
            totalCount={requests.length}
          />
        </>
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>{t('session.selectOrCreate')}</span>
        </div>
      )}
    </div>
  )

  // Render the Report view
  const renderReportView = () => (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', flex: 1 }}>
      {currentSession ? (
        <ReportView
          report={reports[0] || null}
          isAnalyzing={isAnalyzing}
          analysisError={analysisError}
          streamingContent={streamingContent}
          onReAnalyze={handleAnalyze}
          onCancelAnalysis={handleCancelAnalysis}
          chatHistory={chatHistory}
          isChatting={isChatting}
          chatError={chatError}
          onSendFollowUp={handleFollowUp}
          sessionName={currentSession?.name}
          requests={requests}
          hooks={hooks}
        />
      ) : (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ color: 'var(--text-muted)' }}>{t('session.selectForReport')}</span>
        </div>
      )}
    </div>
  )

  return (
    <LocaleProvider locale={appLocale}>
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--color-base)' }}>
      {/* Custom Titlebar */}
      <Titlebar
        theme={appTheme}
        onThemeToggle={handleThemeToggle}
        locale={appLocale}
        onLocaleToggle={handleLocaleToggle}
        activeView={activeView}
        onViewChange={setActiveView}
        requestCount={requests.length}
      />

      {/* Main content area: Sidebar + View */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* Left sidebar */}
        <div style={{
          width: 'var(--sidebar-width)',
          minWidth: 220,
          maxWidth: 220,
          borderRight: '1px solid var(--color-border)',
          background: 'var(--color-sidebar)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}>
          <SessionList
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSelect={selectSession}
            onCreate={createSession}
            onDelete={deleteSession}
            onOpenSettings={openSettings}
            activeRequestCount={requests.length}
          />
        </div>

        {/* Main view area */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: 'var(--color-content)' }}>
          {activeView === 'browser' && renderBrowserView()}
          {activeView === 'inspector' && renderInspectorView()}
          {activeView === 'report' && renderReportView()}
        </div>
      </div>

      {/* Status bar */}
      <StatusBar
        status={currentSession?.status ?? null}
        requestCount={requests.length}
        hookCount={hooks.length}
        sessionName={currentSession?.name}
        activeView={activeView}
        llmModel={reports[0]?.llm_model}
        tokenCount={reports[0] ? (reports[0].prompt_tokens ?? 0) + (reports[0].completion_tokens ?? 0) : undefined}
      />

      {/* Settings modal */}
      <SettingsModal open={settingsOpen} onClose={closeSettings} />
    </div>
    </LocaleProvider>
  )
}

export default App
