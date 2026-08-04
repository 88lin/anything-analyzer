import React from 'react'
import styles from './ContextUsageBar.module.css'

export interface ContextUsageBarProps {
  usedTokens: number
  maxContextTokens: number
  usableTokens: number
  peakRatio: number
  /** used / max */
  absoluteRatio: number
  /** used / usable */
  usageRatio: number
  compact?: boolean
}

function tone(absoluteRatio: number, peakRatio: number): 'ok' | 'warn' | 'danger' {
  if (absoluteRatio >= peakRatio) return 'danger'
  if (absoluteRatio >= peakRatio * 0.75) return 'warn'
  return 'ok'
}

const ContextUsageBar: React.FC<ContextUsageBarProps> = ({
  usedTokens,
  maxContextTokens,
  usableTokens,
  peakRatio,
  absoluteRatio,
  usageRatio,
  compact = false,
}) => {
  const pct = Math.min(100, Math.max(0, Math.round(absoluteRatio * 100)))
  const level = tone(absoluteRatio, peakRatio)
  const peakPct = Math.round(peakRatio * 100)

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''}`} title={`可用 ${usableTokens.toLocaleString()} · 占用 ${Math.round(usageRatio * 100)}% of usable`}>
      <div className={styles.meta}>
        <span className={styles.label}>上下文</span>
        <span className={styles.value}>
          {usedTokens.toLocaleString()} / {maxContextTokens.toLocaleString()}
          <span className={`${styles.pct} ${styles[level]}`}> {pct}%</span>
        </span>
      </div>
      <div className={styles.track}>
        <div className={`${styles.fill} ${styles[level]}`} style={{ width: `${pct}%` }} />
        <div className={styles.peakMark} style={{ left: `${peakPct}%` }} title={`压缩峰值 ${peakPct}%`} />
      </div>
      {!compact && (
        <div className={styles.footer}>
          <span>可用 {usableTokens.toLocaleString()}</span>
          <span>峰值 {peakPct}%</span>
        </div>
      )}
    </div>
  )
}

export default ContextUsageBar
