import React, { useEffect, useState } from 'react'
import { useLocale } from '../i18n'
import type { AiRequestLog } from '@shared/types'
import styles from './AiLogView.module.css'

interface AiLogDetailProps {
  logId: number | null
}

type DetailTab = 'request' | 'response' | 'headers' | 'meta'

function formatTokenCount(prompt: number, completion: number): string {
  const fmt = (n: number) => n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
  return `${fmt(prompt)} + ${fmt(completion)} tokens`
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '--'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function tryFormatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function formatHeaders(headersJson: string | null): Array<[string, string]> {
  if (!headersJson) return []
  try {
    const obj = JSON.parse(headersJson)
    return Object.entries(obj) as Array<[string, string]>
  } catch {
    return []
  }
}

export const AiLogDetail: React.FC<AiLogDetailProps> = ({ logId }) => {
  const { t } = useLocale()
  const [tab, setTab] = useState<DetailTab>('request')
  const [detail, setDetail] = useState<AiRequestLog | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (logId === null) {
      setDetail(null)
      return
    }
    window.electronAPI.getAiRequestLogDetail(logId).then(setDetail)
  }, [logId])

  if (!detail) {
    return <div className={styles.detailEmpty}>← Select a log entry</div>
  }

  const statusText = detail.status_code
    ? `${detail.status_code} ${detail.status_code >= 200 && detail.status_code < 300 ? 'OK' : 'ERR'}`
    : 'N/A'

  const urlPath = (() => {
    try { return new URL(detail.request_url).pathname }
    catch { return detail.request_url }
  })()

  const handleCopy = () => {
    let content = ''
    switch (tab) {
      case 'request': content = detail.request_body; break
      case 'response': content = detail.response_body ?? ''; break
      case 'headers': content = JSON.stringify({
        request: formatHeaders(detail.request_headers),
        response: formatHeaders(detail.response_headers ?? null),
      }, null, 2); break
      case 'meta': content = JSON.stringify({
        provider: detail.provider, model: detail.model, type: detail.type,
        session_id: detail.session_id, report_id: detail.report_id,
        created_at: new Date(detail.created_at).toISOString(),
      }, null, 2); break
    }
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const tabs: { key: DetailTab; label: string }[] = [
    { key: 'request', label: t('aiLog.tabRequest') },
    { key: 'response', label: t('aiLog.tabResponse') },
    { key: 'headers', label: t('aiLog.tabHeaders') },
    { key: 'meta', label: t('aiLog.tabMeta') },
  ]

  return (
    <div className={styles.detailPanel}>
      {/* Tab bar */}
      <div className={styles.detailTabBar}>
        {tabs.map(tb => (
          <button
            key={tb.key}
            className={`${styles.detailTab} ${tab === tb.key ? styles.detailTabActive : ''}`}
            onClick={() => setTab(tb.key)}
          >
            {tb.label}
          </button>
        ))}
        <div className={styles.detailTabSpacer} />
        <button className={styles.copyBtn} onClick={handleCopy}>
          {copied ? t('aiLog.copied') : t('aiLog.copy')}
        </button>
      </div>

      {/* Meta info line */}
      <div className={styles.metaLine}>
        <span>{detail.request_method} {urlPath}</span>
        <span className={detail.error ? styles.statusError : styles.statusOk}>{statusText}</span>
        <span>{formatDuration(detail.duration_ms)}</span>
        <span>{formatTokenCount(detail.prompt_tokens, detail.completion_tokens)}</span>
      </div>

      {/* Error banner */}
      {detail.error && (
        <div className={styles.errorBanner}>{detail.error}</div>
      )}

      {/* Content area */}
      <div className={styles.detailContent}>
        {tab === 'request' && (
          <pre className={styles.jsonBlock}>{tryFormatJson(detail.request_body)}</pre>
        )}
        {tab === 'response' && (
          <pre className={styles.jsonBlock}>{detail.response_body ? tryFormatJson(detail.response_body) : '(empty)'}</pre>
        )}
        {tab === 'headers' && (
          <div className={styles.headersBlock}>
            <h4>{t('aiLog.requestHeaders')}</h4>
            <table className={styles.headersTable}>
              <tbody>
                {formatHeaders(detail.request_headers).map(([k, v]) => (
                  <tr key={`req-${k}`}><td className={styles.headerKey}>{k}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
            <h4>{t('aiLog.responseHeaders')}</h4>
            <table className={styles.headersTable}>
              <tbody>
                {formatHeaders(detail.response_headers ?? null).map(([k, v]) => (
                  <tr key={`res-${k}`}><td className={styles.headerKey}>{k}</td><td>{v}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'meta' && (
          <table className={styles.metaTable}>
            <tbody>
              <tr><td>Provider</td><td>{detail.provider}</td></tr>
              <tr><td>Model</td><td>{detail.model}</td></tr>
              <tr><td>Type</td><td>{detail.type}</td></tr>
              <tr><td>Session ID</td><td>{detail.session_id ?? '--'}</td></tr>
              <tr><td>Report ID</td><td>{detail.report_id ?? '--'}</td></tr>
              <tr><td>Prompt Tokens</td><td>{detail.prompt_tokens}</td></tr>
              <tr><td>Completion Tokens</td><td>{detail.completion_tokens}</td></tr>
              <tr><td>Created</td><td>{new Date(detail.created_at).toLocaleString()}</td></tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
