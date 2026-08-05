import React from 'react'
import { formatContextUsagePercent } from '@shared/token-estimate'
import styles from './ContextUsageBar.module.css'

export interface ContextUsageBarProps {
  usedTokens: number
  maxContextTokens: number
  usableTokens: number
  remainingTokens: number
  peakRatio: number
  /** used / max */
  absoluteRatio: number
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
  peakRatio,
  absoluteRatio,
  usageRatio,
  compact = false,
}) => {
  const pct = Math.min(100, Math.max(0, absoluteRatio * 100))
  const pctLabel = formatContextUsagePercent(absoluteRatio)
  const level = tone(usageRatio, peakRatio)
  const peakPct = Math.round(peakRatio * 100)
  const peakPosition = Math.min(100, Math.max(0, usableTokens * peakRatio / maxContextTokens * 100))

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''}`} title={`剩余 ${remainingTokens.toLocaleString()} · 可用上限 ${usableTokens.toLocaleString()} · 占用 ${formatContextUsagePercent(usageRatio)}`}>
      <div className={styles.meta}>
        <span className={styles.label}>上下文</span>
        <span className={styles.value}>
          {usedTokens.toLocaleString()} / {maxContextTokens.toLocaleString()}
          <span className={`${styles.pct} ${styles[level]}`}> {pctLabel}</span>
        </span>
      </div>
      <div className={styles.track}>
        <div className={`${styles.fill} ${styles[level]}`} style={{ width: `${pct}%` }} />
        <div className={styles.peakMark} style={{ left: `${peakPosition}%` }} title={`压缩峰值 ${peakPct}% of usable`} />
      </div>
      {!compact && (
        <div className={styles.footer}>
          <span>剩余 {remainingTokens.toLocaleString()}</span>
          <span>峰值 {peakPct}%</span>
        </div>
      )}
    </div>
  )
}

export default ContextUsageBar
