import React, { useMemo, useState } from 'react'
import { useLocale } from '../i18n'
import type { AiRequestLog } from '@shared/types'
import styles from './AiLogView.module.css'

interface AiLogListProps {
  logs: AiRequestLog[]
  selectedId: number | null
  onSelect: (id: number) => void
}

type FilterType = 'all' | 'analyze' | 'chat' | 'filter' | 'compress' | 'subagent'

function formatDuration(ms: number | null): string {
  if (ms === null) return '--'
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

function formatTokenCount(prompt: number, completion: number): string {
  const total = prompt + completion
  if (total === 0) return '--'
  if (total >= 1000) return `${(total / 1000).toFixed(1)}k`
  return String(total)
}

export const AiLogList: React.FC<AiLogListProps> = ({ logs, selectedId, onSelect }) => {
  const { t } = useLocale()
  const [filterType, setFilterType] = useState<FilterType>('all')
  const [search, setSearch] = useState('')

  const filteredLogs = useMemo(() => {
    let result = logs
    if (filterType !== 'all') {
      result = result.filter(l => l.type === filterType)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(l =>
        l.model.toLowerCase().includes(q) ||
        l.request_url.toLowerCase().includes(q) ||
        l.provider.toLowerCase().includes(q)
      )
    }
    return result
  }, [logs, filterType, search])

  const filterOptions: { key: FilterType; label: string }[] = [
    { key: 'all', label: `${t('aiLog.filterAll')} (${logs.length})` },
    { key: 'analyze', label: t('aiLog.filterAnalyze') },
    { key: 'chat', label: t('aiLog.filterChat') },
    { key: 'filter', label: t('aiLog.filterFilter') },
    { key: 'compress', label: t('aiLog.filterCompress') },
    { key: 'subagent', label: t('aiLog.filterSubagent') },
  ]

  return (
    <div className={styles.listPanel}>
      {/* Filter tags */}
      <div className={styles.filterRow}>
        {filterOptions.map(opt => (
          <button
            key={opt.key}
            className={`${styles.filterTag} ${filterType === opt.key ? styles.filterTagActive : ''}`}
            onClick={() => setFilterType(opt.key)}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <input
        className={styles.searchInput}
        placeholder={t('aiLog.searchPlaceholder')}
        value={search}
        onChange={e => setSearch(e.target.value)}
      />

      {/* List */}
      <div className={styles.listScroll}>
        {filteredLogs.map(log => (
          <div
            key={log.id}
            className={`${styles.listItem} ${log.id === selectedId ? styles.listItemActive : ''} ${log.error ? styles.listItemError : ''}`}
            onClick={() => onSelect(log.id)}
          >
            <span className={styles.listItemLeft}>
              #{log.id} {log.type} — {log.model}
              {log.error && log.status_code ? ` ✗ ${log.status_code}` : ''}
            </span>
            <span className={styles.listItemRight}>
              {formatDuration(log.duration_ms)} · {formatTokenCount(log.prompt_tokens, log.completion_tokens)}
            </span>
          </div>
        ))}
        {filteredLogs.length === 0 && (
          <div className={styles.emptyList}>{t('aiLog.noData')}</div>
        )}
      </div>
    </div>
  )
}
