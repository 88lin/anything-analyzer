import React from 'react'
import { formatContextUsagePercent } from '@shared/token-estimate'
import { useLocale } from '../i18n'
import type { SessionStatus } from '@shared/types'
import type { AppView } from './Titlebar'
import styles from './StatusBar.module.css'

interface StatusBarProps {
  status: SessionStatus | null
  requestCount: number
  hookCount: number
  interactionCount?: number
  sessionName?: string
  activeView?: AppView
  llmModel?: string
  tokenCount?: number
  /** used/max 0..1+ */
  contextUsageRatio?: number
  contextNearPeak?: boolean
}

const StatusBar: React.FC<StatusBarProps> = ({
  status,
  requestCount,
  hookCount,
  interactionCount = 0,
  sessionName,
  activeView = 'browser',
  llmModel,
  tokenCount,
  contextUsageRatio,
  contextNearPeak,
}) => {
  const { t } = useLocale()
  const statusLabels: Record<string, { color: string; label: string; pulse: boolean }> = {
    running: { color: 'var(--color-success)', label: t('capture.running'), pulse: true },
    paused: { color: 'var(--color-warning)', label: t('capture.paused'), pulse: false },
    stopped: { color: 'var(--text-muted)', label: t('capture.stopped'), pulse: false },
  }
  const statusCfg = status ? statusLabels[status] : null

  return (
    <div className={styles.statusBar}>
      {/* Status dot + label */}
      <div className={styles.item}>
        <span
          className={`${styles.dot} ${statusCfg?.pulse ? styles.pulse : ''}`}
          style={{ background: statusCfg?.color ?? 'var(--text-disabled)' }}
        />
        <span className={styles.label}>{t('status.session')}</span>
        <span className={styles.value} style={{ color: statusCfg?.color }}>
          {statusCfg?.label ?? 'Idle'}
        </span>
      </div>

      {/* Request count */}
      <div className={styles.item}>
        <span className={styles.label}>{t('status.requests')}</span>
        <span className={styles.value}>{requestCount}</span>
      </div>

      {/* Hooks count — browser/inspector only */}
      {activeView !== 'report' && (
        <div className={styles.item}>
          <span className={styles.label}>{t('status.hooks')}</span>
          <span className={styles.value}>{hookCount}</span>
        </div>
      )}

      {/* Interaction recording count */}
      {activeView !== 'report' && interactionCount > 0 && (
        <div className={styles.item}>
          <span
            className={`${styles.dot} ${status === 'running' ? styles.pulse : ''}`}
            style={{ background: status === 'running' ? 'var(--color-error)' : 'var(--text-muted)' }}
          />
          <span className={styles.label}>{t('data.interactions')}</span>
          <span className={styles.value}>{interactionCount}</span>
        </div>
      )}

      {/* Report view: LLM + Tokens */}
      {activeView === 'report' && llmModel && (
        <div className={styles.item}>
          <span className={styles.label}>LLM</span>
          <span className={styles.value}>{llmModel}</span>
        </div>
      )}
      {activeView === 'report' && tokenCount != null && tokenCount > 0 && (
        <div className={styles.item}>
          <span className={styles.label}>Tokens</span>
          <span className={styles.value}>{tokenCount.toLocaleString()}</span>
        </div>
      )}
      {activeView === 'report' && contextUsageRatio != null && (
        <div className={styles.item}>
          <span className={styles.label}>Context</span>
          <span
            className={styles.value}
            style={{ color: contextNearPeak || contextUsageRatio >= 0.85 ? 'var(--color-error)' : 'var(--text-secondary)' }}
          >
            {formatContextUsagePercent(contextUsageRatio)}
          </span>
        </div>
      )}

      <div className={styles.spacer} />

      {/* Session name on the right */}
      {sessionName && (
        <div className={styles.item}>
          <span className={styles.value}>{sessionName}</span>
        </div>
      )}
    </div>
  )
}

export default StatusBar
