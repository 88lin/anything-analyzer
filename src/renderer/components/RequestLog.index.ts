import type { CapturedRequest } from '@shared/types'

export interface RequestLogRow {
  request: CapturedRequest
  id: string
  sequence: number
  timestamp: number
  method: string
  url: string
  host: string
  path: string
  status_code: number | null
  duration_ms: number | null
  source: 'cdp' | 'proxy'
  searchText: string
}

export interface RequestLogIndex {
  rows: RequestLogRow[]
  methods: string[]
  domains: string[]
  sourceLength: number
  firstRequest: CapturedRequest | null
  lastRequest: CapturedRequest | null
}

export interface RequestFilterOption {
  text: string
  value: string
}

interface CachedRequestRow {
  signature: string
  row: RequestLogRow
}

const requestRowCache = new WeakMap<CapturedRequest, CachedRequestRow>()

function getRequestSignature(request: CapturedRequest): string {
  return [
    request.id,
    request.sequence,
    request.timestamp,
    request.method,
    request.url,
    request.status_code,
    request.duration_ms,
    request.source ?? 'cdp',
  ].join('\u0000')
}

function parseUrl(url: string): { host: string; path: string } {
  try {
    const parsed = new URL(url)
    return {
      host: parsed.host,
      path: parsed.pathname + parsed.search,
    }
  } catch {
    return { host: url, path: url }
  }
}

function indexRequest(request: CapturedRequest): RequestLogRow {
  const signature = getRequestSignature(request)
  const cached = requestRowCache.get(request)
  if (cached?.signature === signature) return cached.row

  const { host, path } = parseUrl(request.url)
  const row: RequestLogRow = {
    request,
    id: request.id,
    sequence: request.sequence,
    timestamp: request.timestamp,
    method: request.method.toUpperCase(),
    url: request.url,
    host,
    path,
    status_code: request.status_code,
    duration_ms: request.duration_ms,
    source: request.source ?? 'cdp',
    searchText: request.url.toLowerCase(),
  }
  requestRowCache.set(request, { signature, row })
  return row
}

export function buildRequestLogIndex(requests: CapturedRequest[]): RequestLogIndex {
  const rows = new Array<RequestLogRow>(requests.length)
  const methods = new Set<string>()
  const domains = new Set<string>()

  for (let index = 0; index < requests.length; index += 1) {
    const row = indexRequest(requests[index])
    rows[index] = row
    methods.add(row.method)
    domains.add(row.host)
  }

  return {
    rows,
    methods: Array.from(methods).sort(),
    domains: Array.from(domains).sort(),
    sourceLength: requests.length,
    firstRequest: requests[0] ?? null,
    lastRequest: requests[requests.length - 1] ?? null,
  }
}

export function updateRequestLogIndex(
  previous: RequestLogIndex | null,
  requests: CapturedRequest[],
): RequestLogIndex {
  if (!previous) return buildRequestLogIndex(requests)

  const appendOnly = requests.length >= previous.sourceLength
    && previous.rows.length === previous.sourceLength
    && (previous.sourceLength === 0 || (
      requests[0] === previous.firstRequest
      && requests[previous.sourceLength - 1] === previous.lastRequest
    ))

  if (!appendOnly) return buildRequestLogIndex(requests)
  if (requests.length === previous.sourceLength) return previous

  const appendedRows = new Array<RequestLogRow>(requests.length - previous.sourceLength)
  const methods = new Set(previous.methods)
  const domains = new Set(previous.domains)
  let facetsChanged = false

  for (let index = previous.sourceLength; index < requests.length; index += 1) {
    const row = indexRequest(requests[index])
    appendedRows[index - previous.sourceLength] = row
    if (!methods.has(row.method)) {
      methods.add(row.method)
      facetsChanged = true
    }
    if (!domains.has(row.host)) {
      domains.add(row.host)
      facetsChanged = true
    }
  }

  return {
    rows: previous.rows.concat(appendedRows),
    methods: facetsChanged ? Array.from(methods).sort() : previous.methods,
    domains: facetsChanged ? Array.from(domains).sort() : previous.domains,
    sourceLength: requests.length,
    firstRequest: requests[0] ?? null,
    lastRequest: requests[requests.length - 1] ?? null,
  }
}

export function filterIndexedRequests(rows: RequestLogRow[], searchText: string): RequestLogRow[] {
  const query = searchText.trim().toLowerCase()
  if (!query) return rows

  const result: RequestLogRow[] = []
  for (const row of rows) {
    if (row.searchText.includes(query)) result.push(row)
  }
  return result
}

export function reuseEqualFilterOptions(
  previous: RequestFilterOption[],
  values: string[],
): RequestFilterOption[] {
  if (
    previous.length === values.length
    && values.every((value, index) => previous[index]?.value === value)
  ) {
    return previous
  }

  return values.map(value => ({ text: value, value }))
}
