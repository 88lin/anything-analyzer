import React, { useEffect, useRef, useState } from 'react'
import { Button, Tag, Empty, Spinner } from '../ui'
import { IconRobot, IconFileText } from '../ui/Icons'
import { useLocale } from '../i18n'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type { AnalysisReport, ChatMessage, CapturedRequest, JsHookRecord } from '@shared/types'
import { stripToolContext } from '@shared/types'
import { AiLogView } from './AiLogView'
import ContextUsageBar from './ContextUsageBar'
import {
  buildContextUsageSnapshot,
  resolveContextUsedTokens,
  type ContextUsageSnapshot,
} from '@shared/token-estimate'
import styles from './ReportView.module.css'

interface ReportViewProps {
  report: AnalysisReport | null
  isAnalyzing: boolean
  analysisError: string | null
  streamingContent: string
  onReAnalyze: (purpose?: string) => void
  onCancelAnalysis: () => void
  chatHistory: ChatMessage[]
  isChatting: boolean
  chatError: string | null
  onSendFollowUp: (message: string) => void
  // Context panel data
  sessionName?: string
  requests?: CapturedRequest[]
  hooks?: JsHookRecord[]
  /** 外部传入的上下文占用快照；缺省时组件内估算 */
  contextUsage?: ContextUsageSnapshot | null
}

function formatTokens(tokens: number | null): string {
  if (tokens === null) return '--'
  return tokens.toLocaleString()
}

// Streaming text display with cursor blinking effect
const StreamingDisplay: React.FC<{ content: string }> = ({ content }) => {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight
  }, [content])

  return (
    <div ref={containerRef} className={styles.streamingContainer}>
      <div className="report-markdown-content">
        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
          {content}
        </ReactMarkdown>
        <span className={styles.cursor} />
      </div>
    </div>
  )
}

// Quick follow-up suggestions
const QUICK_QUESTION_KEYS = [
  'report.genPython',
  'report.explainCrypto',
  'report.securityRisks',
  'report.listApiParams',
] as const

// Extract unique API endpoints from requests
function extractEndpoints(requests: CapturedRequest[]): { method: string; path: string }[] {
  const seen = new Set<string>()
  const endpoints: { method: string; path: string }[] = []
  for (const r of requests) {
    try {
      const url = new URL(r.url)
      const key = `${r.method} ${url.pathname}`
      if (!seen.has(key)) {
        seen.add(key)
        endpoints.push({ method: r.method, path: url.pathname })
      }
    } catch {
      // skip invalid URLs
    }
  }
  return endpoints.slice(0, 8) // limit to top 8
}

function getMethodColor(method: string): string {
  switch (method.toUpperCase()) {
    case 'GET': return 'var(--color-success)'
    case 'POST': return 'var(--color-info)'
    case 'PUT': return 'var(--color-orange)'
    case 'DELETE': return 'var(--color-error)'
    default: return 'var(--text-muted)'
  }
}

// Summarize hook types
function summarizeHooks(hooks: JsHookRecord[]): { type: string; count: number; color: string }[] {
  const counts: Record<string, number> = {}
  for (const h of hooks) {
    const type = h.hook_type || 'unknown'
    counts[type] = (counts[type] || 0) + 1
  }
  const colorMap: Record<string, string> = {
    crypto: 'var(--color-warning)',
    fetch: 'var(--color-info)',
    xhr: 'var(--color-info)',
    cookie: 'var(--color-error)',
  }
  return Object.entries(counts).map(([type, count]) => ({
    type,
    count,
    color: colorMap[type] || 'var(--text-muted)',
  }))
}

const ReportView: React.FC<ReportViewProps> = ({
  report,
  isAnalyzing,
  analysisError,
  streamingContent,
  onReAnalyze,
  onCancelAnalysis,
  chatHistory,
  isChatting,
  chatError,
  onSendFollowUp,
  sessionName,
  requests = [],
  hooks = [],
  contextUsage: contextUsageProp = null,
}) => {
  const { t } = useLocale()
  const [chatInput, setChatInput] = useState('')
  const [showAiLog, setShowAiLog] = useState(false)
  const reportBodyRef = useRef<HTMLDivElement>(null)
  const [budgetCfg, setBudgetCfg] = useState({
    maxContextTokens: 200_000,
    reserveCompletionTokens: 8_192,
    compressionPeak: 0.85,
  })

  useEffect(() => {
    let alive = true
    window.electronAPI.getLLMConfig?.().then((config) => {
      if (!alive || !config?.contextBudget) return
      const b = config.contextBudget
      setBudgetCfg({
        maxContextTokens: b.maxContextTokens ?? 200_000,
        reserveCompletionTokens: b.reserveCompletionTokens ?? 8_192,
        compressionPeak: b.compressionPeak ?? 0.85,
      })
    }).catch(() => { /* ignore */ })
    return () => { alive = false }
  }, [])

  const localUsage = React.useMemo(() => {
    const messages = chatHistory.map((m) => ({ content: stripToolContext(m.content) }))
    // 无历史时用报告正文估一个底数
    if (messages.length === 0 && report?.report_content) {
      messages.push({ content: report.report_content })
    }
    const used = resolveContextUsedTokens({
      reportPromptTokens: report?.prompt_tokens,
      fallbackMessages: messages,
    })
    return buildContextUsageSnapshot(used, budgetCfg)
  }, [chatHistory, report?.prompt_tokens, report?.report_content, budgetCfg])

  const usage = contextUsageProp ?? localUsage


  // Auto-scroll report body when streaming or new chat messages arrive
  useEffect(() => {
    if ((streamingContent || isChatting) && reportBodyRef.current) {
      reportBodyRef.current.scrollTop = reportBodyRef.current.scrollHeight
    }
  }, [streamingContent, isChatting])

  useEffect(() => {
    if (chatHistory.length > 2 && reportBodyRef.current) {
      requestAnimationFrame(() => {
        if (reportBodyRef.current) {
          reportBodyRef.current.scrollTop = reportBodyRef.current.scrollHeight
        }
      })
    }
  }, [chatHistory.length])

  const handleSend = () => {
    const trimmed = chatInput.trim()
    if (!trimmed || isChatting) return
    onSendFollowUp(trimmed)
    setChatInput('')
  }

  const handleExport = async () => {
    if (!report) return
    const defaultName = `report-${new Date(report.created_at).toISOString().slice(0, 10)}-${report.llm_model}.md`
    let content = report.report_content
    const followUps = chatHistory.slice(2)
    if (followUps.length > 0) {
      content += '\n\n---\n\n## Follow-up Chat\n'
      for (const msg of followUps) {
        const label = msg.role === 'user' ? '**User**' : '**AI**'
        content += `\n${label}:\n\n${stripToolContext(msg.content)}\n`
      }
    }
    await window.electronAPI.exportFile(defaultName, content)
  }

  const endpoints = extractEndpoints(requests)
  const hookSummary = summarizeHooks(hooks)

  // Render right context panel
  const renderContextPanel = () => (
    <div className={styles.reportContext}>
      <div className={styles.contextHeader}>{t('report.title')}</div>

      {/* Session info */}
      <div className={styles.contextSection}>
        <div className={styles.contextLabel}>{t('status.session')}</div>
        {sessionName && (
          <div className={styles.contextItem}>
            <div className={styles.contextDot} style={{ background: 'var(--color-purple)' }} />
            {sessionName}
          </div>
        )}
        <div className={styles.contextItem}>
          <div className={styles.contextDot} style={{ background: 'var(--color-success)' }} />
          {requests.length} {t('data.requests')} · {hooks.length} {t('data.hooks')}
        </div>
      </div>

      {/* Key endpoints */}
      {endpoints.length > 0 && (
        <div className={styles.contextSection}>
          <div className={styles.contextLabel}>Endpoints</div>
          {endpoints.map((ep, i) => (
            <div key={i} className={styles.contextEndpoint}>
              <span className={styles.contextMethod} style={{ color: getMethodColor(ep.method) }}>
                {ep.method}
              </span>
              <span className={styles.contextPath}>{ep.path}</span>
            </div>
          ))}
        </div>
      )}

      {/* Detected hooks */}
      {hookSummary.length > 0 && (
        <div className={styles.contextSection}>
          <div className={styles.contextLabel}>{t('data.hooks')}</div>
          {hookSummary.map((h, i) => (
            <div key={i} className={styles.contextItem}>
              <div className={styles.contextDot} style={{ background: h.color }} />
              {h.type} × {h.count}
            </div>
          ))}
        </div>
      )}

      {/* Report metadata if available */}
      {report && (
        <div className={styles.contextSection}>
          <div className={styles.contextLabel}>LLM</div>
          <div className={styles.contextItem}>
            <div className={styles.contextDot} style={{ background: 'var(--color-info)' }} />
            {report.llm_model}
          </div>
          {report.prompt_tokens != null && report.completion_tokens != null && (
            <div className={styles.contextItem}>
              <div className={styles.contextDot} style={{ background: 'var(--color-success)' }} />
              {formatTokens(report.prompt_tokens + report.completion_tokens)} tokens
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <ContextUsageBar
              usedTokens={usage.usedTokens}
              maxContextTokens={usage.maxContextTokens}
              usableTokens={usage.usableTokens}
              peakRatio={usage.peakRatio}
              absoluteRatio={usage.absoluteRatio}
              usageRatio={usage.usageRatio}
            />
          </div>
        </div>
      )}
    </div>
  )

  // Analyzing state — full width, no context panel
  if (isAnalyzing) {
    return (
      <div className={styles.reportContainer}>
        <div className={styles.reportMain}>
          <div className={styles.reportBody} ref={reportBodyRef}>
            <div className={styles.reportScroll}>
              <div className={styles.analyzingHeader}>
                <Spinner size="sm" />
                <span>
                  <IconRobot size={14} style={{ marginRight: 4 }} />
                  {t('report.analyzing')}
                </span>
                <div style={{ flex: 1 }} />
                <Button size="sm" onClick={onCancelAnalysis}>
                  {t('report.stopAnalysis')}
                </Button>
              </div>
              {streamingContent ? (
                <StreamingDisplay content={streamingContent} />
              ) : (
                <div className={styles.preparingState}>
                  <Spinner />
                  <div style={{ marginTop: 12 }}>{t('report.preparing')}</div>
                </div>
              )}
            </div>
          </div>
        </div>
        {renderContextPanel()}
      </div>
    )
  }

  // No report yet
  if (!report) {
    return (
      <div className={styles.reportContainer}>
        <div className={styles.reportMain}>
          <div className={styles.emptyState}>
            {analysisError && (
              <div className={styles.errorAlert}>
                <div className={styles.errorTitle}>{t('report.analysisFailed')}</div>
                <div className={styles.errorDesc}>{analysisError}</div>
              </div>
            )}
            <Empty
              icon={<IconFileText size={48} style={{ opacity: 0.25 }} />}
              description={t('report.noReport')}
            />
            <Button variant="primary" icon={<IconRobot size={14} />} onClick={() => onReAnalyze()}>
              {t('report.startAnalysis')}
            </Button>
          </div>
        </div>
        {renderContextPanel()}
      </div>
    )
  }

  // Has report — show AI Log view if toggled
  if (showAiLog) {
    return (
      <AiLogView
        sessionId={report.session_id}
        sessionName={sessionName}
        onBack={() => setShowAiLog(false)}
      />
    )
  }

  // Has report — full layout with toolbar + content + chat + context panel
  return (
    <div className={styles.reportContainer}>
      <div className={styles.reportMain}>
        {/* Toolbar */}
        <div className={styles.reportToolbar}>
          <div className={styles.toolLabel}>{t('capture.autoDetect')}</div>
          <button className={styles.toolBtnPrimary}>✦ {report.llm_model}</button>
          <div className={styles.toolSpacer} />
          <button className={styles.toolBtn} onClick={handleExport}>⬇ {t('report.export')}</button>
          <button className={styles.toolBtn} onClick={() => onReAnalyze()}>↻ {t('report.reanalyze')}</button>
          <button className={styles.toolBtn} onClick={() => setShowAiLog(true)}>📋 {t('aiLog.title')}</button>
        </div>

        {/* Report content */}
        <div className={styles.reportBody} ref={reportBodyRef}>
          <div className={styles.reportScroll}>
            {/* Metadata row */}
            <div className={styles.metaRow}>
              <span>✦ {report.llm_model}</span>
              <span>◷ {new Date(report.created_at).toLocaleString()}</span>
              <span>{requests.length} {t('data.requests')}</span>
            </div>

            {/* Markdown content */}
            <div className="report-markdown-content" style={{ overflowWrap: 'break-word', wordBreak: 'break-word' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                {report.report_content}
              </ReactMarkdown>
            </div>


            {/* Chat history */}
            {chatHistory.slice(2).map((msg, i) => (
              <div key={i} className={`${styles.chatMsg} ${msg.role === 'user' ? styles.chatMsgUser : styles.chatMsgAi}`}>
                <Tag color={msg.role === 'user' ? 'info' : 'success'} style={{ marginBottom: 4 }}>
                  {msg.role === 'user' ? 'You' : 'AI'}
                </Tag>
                <div className="report-markdown-content">
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {stripToolContext(msg.content)}
                  </ReactMarkdown>
                </div>
              </div>
            ))}

            {/* Streaming follow-up */}
            {isChatting && streamingContent && (
              <div className={`${styles.chatMsg} ${styles.chatMsgAi}`}>
                <Tag color="success" style={{ marginBottom: 4 }}>AI</Tag>
                <StreamingDisplay content={streamingContent} />
              </div>
            )}

            {isChatting && !streamingContent && (
              <div style={{ textAlign: 'center', padding: 12 }}>
                <Spinner size="sm" />
                <span style={{ marginLeft: 8, color: 'var(--text-muted)' }}>{t('report.thinking')}</span>
              </div>
            )}

            {chatError && (
              <div className={styles.errorAlert} style={{ marginTop: 12 }}>
                <div className={styles.errorTitle}>{t('report.followUpFailed')}</div>
                <div className={styles.errorDesc}>{chatError}</div>
              </div>
            )}
          </div>
        </div>

        {/* Chat section */}
        <div className={styles.chatSection}>
          <ContextUsageBar
            usedTokens={usage.usedTokens}
            maxContextTokens={usage.maxContextTokens}
            usableTokens={usage.usableTokens}
            peakRatio={usage.peakRatio}
            absoluteRatio={usage.absoluteRatio}
            usageRatio={usage.usageRatio}
            compact
          />
          <div className={styles.chatSuggestions}>
            {QUICK_QUESTION_KEYS.map((key, i) => {
              const text = t(key)
              return (
                <button
                  key={i}
                  className={styles.chatChip}
                  disabled={isChatting}
                  onClick={() => { if (!isChatting) onSendFollowUp(text) }}
                >
                  {text}
                </button>
              )
            })}
          </div>
          <div className={styles.chatInputBar}>
            <input
              className={styles.chatInput}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder={t('report.askFollowUp')}
              disabled={isChatting}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
            />
            <button
              className={styles.chatSend}
              onClick={handleSend}
              disabled={isChatting || !chatInput.trim()}
            >
              ↑
            </button>
          </div>
        </div>
      </div>

      {/* Right context panel */}
      {renderContextPanel()}
    </div>
  )
}

export default ReportView
