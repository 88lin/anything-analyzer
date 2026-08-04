import React, { useMemo, useCallback, useDeferredValue, useRef, useState } from 'react'
import { VirtualTable } from '../ui/VirtualTable'
import type { VTColumn, VTRowSelection } from '../ui/VirtualTable'
import type { CapturedRequest } from '@shared/types'
import {
  filterIndexedRequests,
  reuseEqualFilterOptions,
  updateRequestLogIndex,
} from './RequestLog.index'
import type { RequestFilterOption, RequestLogIndex, RequestLogRow } from './RequestLog.index'
import styles from './RequestLog.module.css'

interface RequestLogProps {
  requests: CapturedRequest[]
  selectedId: string | null
  onSelect: (request: CapturedRequest) => void
  selectedSeqs: number[]
  onSelectedSeqsChange: (seqs: number[]) => void
}

// Color mapping for HTTP methods
const METHOD_COLORS: Record<string, string> = {
  GET: 'var(--color-success)',
  POST: 'var(--color-info)',
  PUT: 'var(--color-orange)',
  DELETE: 'var(--color-error)',
  PATCH: 'var(--color-info)',
  HEAD: 'var(--text-muted)',
  OPTIONS: 'var(--text-muted)',
}

const SOURCE_FILTERS: RequestFilterOption[] = [
  { text: 'CDP', value: 'cdp' },
  { text: 'Proxy', value: 'proxy' },
]

const MUTED_NUMBER_STYLE: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontVariantNumeric: 'tabular-nums',
}

const ELLIPSIS_STYLE: React.CSSProperties = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}

// Color for status codes
function getStatusColor(code: number | null): string {
  if (code === null) return 'var(--text-muted)'
  if (code >= 200 && code < 300) return 'var(--color-success)'
  if (code >= 300 && code < 400) return 'var(--color-warning)'
  if (code >= 400 && code < 500) return 'var(--color-error)'
  if (code >= 500) return 'var(--color-error)'
  return 'var(--text-muted)'
}

function useStableFilterOptions(values: string[]): RequestFilterOption[] {
  const previousRef = useRef<RequestFilterOption[]>([])
  return useMemo(() => {
    const next = reuseEqualFilterOptions(previousRef.current, values)
    previousRef.current = next
    return next
  }, [values])
}

const RequestLog: React.FC<RequestLogProps> = ({ requests, selectedId, onSelect, selectedSeqs, onSelectedSeqsChange }) => {
  const [searchText, setSearchText] = useState('')
  const deferredSearchText = useDeferredValue(searchText)
  const requestIndexRef = useRef<RequestLogIndex | null>(null)

  const requestIndex = useMemo(() => {
    const next = updateRequestLogIndex(requestIndexRef.current, requests)
    requestIndexRef.current = next
    return next
  }, [requests])
  const filteredRequests = useMemo(
    () => filterIndexedRequests(requestIndex.rows, deferredSearchText),
    [deferredSearchText, requestIndex.rows],
  )
  const methodFilters = useStableFilterOptions(requestIndex.methods)
  const domainFilters = useStableFilterOptions(requestIndex.domains)

  const columns: VTColumn<RequestLogRow>[] = useMemo(() => [
    {
      key: 'sequence',
      title: '#',
      dataIndex: 'sequence',
      width: 50,
      render: (val) => <span style={MUTED_NUMBER_STYLE}>{val as number}</span>,
      sorter: (a, b) => a.sequence - b.sequence,
    },
    {
      key: 'method',
      title: 'Method',
      dataIndex: 'method',
      width: 100,
      filters: methodFilters,
      onFilter: (value, record) => record.method === value,
      render: (val) => {
        const m = val as string
        return <span style={{ color: METHOD_COLORS[m] || 'var(--text-muted)', fontWeight: 600 }}>{m}</span>
      },
    },
    {
      key: 'domain',
      title: 'Domain',
      dataIndex: 'host',
      width: 180,
      filters: domainFilters,
      filterSearch: true,
      onFilter: (value, record) => record.host === value,
      render: (val) => (
        <span style={ELLIPSIS_STYLE} title={val as string}>
          {val as string}
        </span>
      ),
    },
    {
      key: 'url',
      title: 'Path',
      dataIndex: 'path',
      render: (val, record) => (
        <span style={ELLIPSIS_STYLE} title={record.url}>
          {val as string}
        </span>
      ),
    },
    {
      key: 'status_code',
      title: 'Status',
      dataIndex: 'status_code',
      width: 70,
      render: (val) => {
        const code = val as number | null
        return <span style={{ color: getStatusColor(code), fontWeight: 500 }}>{code ?? '--'}</span>
      },
      sorter: (a, b) => (a.status_code ?? 0) - (b.status_code ?? 0),
    },
    {
      key: 'duration_ms',
      title: 'Time',
      dataIndex: 'duration_ms',
      width: 80,
      render: (val) => {
        const ms = val as number | null
        return <span style={{ color: 'var(--text-muted)' }}>{ms !== null ? `${ms}ms` : '--'}</span>
      },
      sorter: (a, b) => (a.duration_ms ?? 0) - (b.duration_ms ?? 0),
    },
    {
      key: 'source',
      title: 'Source',
      dataIndex: 'source',
      width: 90,
      filters: SOURCE_FILTERS,
      onFilter: (value, record) => record.source === value,
      render: (val) => {
        const src = val as string
        const isProxy = src === 'proxy'
        return (
          <span className={isProxy ? styles.srcProxy : styles.srcCdp}>
            {isProxy ? 'Proxy' : 'CDP'}
          </span>
        )
      },
    },
  ], [methodFilters, domainFilters])

  const handleRow = useCallback((record: RequestLogRow) => ({
    onClick: () => onSelect(record.request),
    className: record.id === selectedId ? 'vtRowHighlight' : '',
  }), [selectedId, onSelect])

  const handleSelectionChange = useCallback((_keys: (string | number)[], rows: RequestLogRow[]) => {
    onSelectedSeqsChange(rows.map(row => row.sequence))
  }, [onSelectedSeqsChange])

  const rowSelection: VTRowSelection<RequestLogRow> = useMemo(() => ({
    selectedKeys: selectedSeqs,
    onChange: handleSelectionChange,
  }), [handleSelectionChange, selectedSeqs])

  return (
    <div className={styles.container}>
      {/* Search toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            className={styles.searchInput}
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="搜索 URL..."
          />
        </div>
      </div>

      {/* Request list with column headers and filters */}
      <VirtualTable<RequestLogRow>
        columns={columns}
        data={filteredRequests}
        rowKey="sequence"
        rowHeight={32}
        rowSelection={rowSelection}
        onRow={handleRow}
        emptyText="No requests captured yet"
      />
    </div>
  )
}

export default RequestLog
