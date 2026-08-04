import { describe, expect, it } from 'vitest'
import type { CapturedRequest } from '@shared/types'
import {
  buildRequestLogIndex,
  filterIndexedRequests,
  reuseEqualFilterOptions,
  updateRequestLogIndex,
} from '../../src/renderer/components/RequestLog.index'

function createRequest(sequence: number, overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    id: `request-${sequence}`,
    session_id: 'session-1',
    sequence,
    timestamp: sequence,
    method: sequence % 2 === 0 ? 'GET' : 'POST',
    url: `https://api.example.com/items/${sequence}?page=${sequence}`,
    request_headers: '{}',
    request_body: null,
    status_code: 200,
    response_headers: '{}',
    response_body: null,
    content_type: 'application/json',
    initiator: null,
    duration_ms: sequence,
    is_streaming: false,
    is_websocket: false,
    source: 'cdp',
    ...overrides,
  }
}

describe('RequestLog index', () => {
  it('indexes 10k requests once and filters against normalized URL text', () => {
    const requests = Array.from({ length: 10_000 }, (_, index) => createRequest(index + 1))
    const index = buildRequestLogIndex(requests)

    expect(index.rows).toHaveLength(10_000)
    expect(index.methods).toEqual(['GET', 'POST'])
    expect(index.domains).toEqual(['api.example.com'])
    expect(index.rows[9_999].path).toBe('/items/10000?page=10000')
    expect(filterIndexedRequests(index.rows, 'ITEMS/10000')).toEqual([index.rows[9_999]])
  })

  it('reuses cached metadata for unchanged request objects', () => {
    const request = createRequest(1)
    const first = buildRequestLogIndex([request])
    const second = buildRequestLogIndex([request])

    expect(second.rows[0]).toBe(first.rows[0])
  })

  it('indexes only appended requests and preserves existing row references', () => {
    const firstBatch = [createRequest(1), createRequest(2)]
    const first = buildRequestLogIndex(firstBatch)
    const appended = createRequest(3, {
      method: 'PATCH',
      url: 'https://auth.example.com/token',
    })

    const next = updateRequestLogIndex(first, [...firstBatch, appended])

    expect(next.rows.slice(0, 2)).toEqual(first.rows)
    expect(next.rows[0]).toBe(first.rows[0])
    expect(next.rows[2].request).toBe(appended)
    expect(next.methods).toEqual(['GET', 'PATCH', 'POST'])
    expect(next.domains).toEqual(['api.example.com', 'auth.example.com'])
  })

  it('returns the previous index for an unchanged immutable request list', () => {
    const requests = [createRequest(1), createRequest(2)]
    const first = buildRequestLogIndex(requests)

    expect(updateRequestLogIndex(first, [...requests])).toBe(first)
  })

  it('rebuilds the index when the request list is replaced', () => {
    const first = buildRequestLogIndex([createRequest(1), createRequest(2)])
    const replacement = [createRequest(10, { url: 'https://new.example.com/start' })]

    const next = updateRequestLogIndex(first, replacement)

    expect(next.rows).toHaveLength(1)
    expect(next.rows[0].sequence).toBe(10)
    expect(next.domains).toEqual(['new.example.com'])
  })

  it('preserves filter option references when facet values are unchanged', () => {
    const previous = [
      { text: 'GET', value: 'GET' },
      { text: 'POST', value: 'POST' },
    ]
    const next = reuseEqualFilterOptions(previous, ['GET', 'POST'])

    expect(next).toBe(previous)
    expect(reuseEqualFilterOptions(previous, ['GET', 'PUT'])).not.toBe(previous)
  })
})
