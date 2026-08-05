import React from 'react'
import { formatContextUsagePercent } from '@shared/token-estimate'
import { useLocale } from '../i18n'
import styles from './ContextUsageBar.module.css'

export interface ContextUsageBarProps {
  usedTokens: number
  maxContextTokens: number
  usableTokens: number
  remainingTokens: number
  reserveCompletionTokens: number
  peakRatio: number
  /** used / usable */
  usageRatio: number
  compact?: boolean
}

function tone(usageRatio: number, peakRatio: number): 'ok' | 'warn' | 'danger' {
  if (usageRatio >= peakRatio) return 'danger'
  if (usageRatio >= peakRatio * 0.75) return 'warn'
  return 'ok'
}

const ContextUsageBar: React.FC<ContextUsageBarProps> = ({
  usedTokens,
  maxContextTokens,
  usableTokens,
  remainingTokens,
  reserveCompletionTokens,
  peakRatio,
  usageRatio,
  compact = false,
}) => {
  const { t } = useLocale()
  const pct = Math.min(100, Math.max(0, usageRatio * 100))
  const pctLabel = formatContextUsagePercent(usageRatio)
  const level = tone(usageRatio, peakRatio)
  const peakPct = Math.round(peakRatio * 100)
  const peakPosition = Math.min(100, Math.max(0, peakRatio * 100))

  return (
    <div
      className={`${styles.wrap} ${compact ? styles.compact : ''}`}
      title={`${t('contextBar.modelLimit')} ${maxContextTokens.toLocaleString()} · ${t('contextBar.reservedOutput')} ${reserveCompletionTokens.toLocaleString()} · ${t('contextBar.remaining')} ${remainingTokens.toLocaleString()}`}
    >
      <div className={styles.meta}>
        <span className={styles.label}>{t('contextBar.title')}</span>
        <span className={styles.value}>
          {usedTokens.toLocaleString()} / {usableTokens.toLocaleString()}
          <span className={`${styles.pct} ${styles[level]}`}> {pctLabel}</span>
        </span>
      </div>
      <div className={styles.track}>
        <div className={`${styles.fill} ${styles[level]}`} style={{ width: `${pct}%` }} />
        <div
          className={styles.peakMark}
          style={{ left: `${peakPosition}%` }}
          title={t('contextBar.autoCompress', { percent: peakPct })}
        />
      </div>
      {!compact && (
        <div className={styles.footer}>
          <span>{t('contextBar.remaining')} {remainingTokens.toLocaleString()}</span>
          <span>{t('contextBar.autoCompress', { percent: peakPct })}</span>
        </div>
      )}
    </div>
  )
}

export default ContextUsageBar
