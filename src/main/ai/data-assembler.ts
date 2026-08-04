import type { CapturedRequest, JsHookRecord, StorageSnapshot, AssembledData, FilteredRequest, StorageDiff, AuthChainItem, RequestSummary } from '@shared/types'
import type { RequestsRepo, JsHooksRepo, StorageSnapshotsRepo } from '../db/repositories'
import { SceneDetector } from './scene-detector'
import { CryptoScriptExtractor } from './crypto-script-extractor'

const STATIC_EXTENSIONS = /\.(js|css|png|jpg|jpeg|gif|svg|woff|woff2|ttf|eot|ico|map)(\?|$)/i
const API_CONTENT_TYPES = ['json', 'form-urlencoded', 'multipart']
const TOKEN_BUDGET = 30000
const CHARS_PER_TOKEN = 4
const CRYPTO_BUDGET_CHARS = 20000

/**
 * DataAssembler — Reads session data from SQLite, filters, associates, and budgets it.
 */
export class DataAssembler {
  constructor(private requestsRepo: RequestsRepo, private jsHooksRepo: JsHooksRepo, private storageSnapshotsRepo: StorageSnapshotsRepo) {}

  assemble(sessionId: string): AssembledData {
    const allRequests = this.requestsRepo.findBySession(sessionId)
    const allHooks = this.jsHooksRepo.findBySession(sessionId)
    const allSnapshots = this.storageSnapshotsRepo.findBySession(sessionId)

    const filteredRequests = allRequests.filter(r => this.isRelevantRequest(r))

    const assembledRequests = filteredRequests.map(r => {
      const relatedHooks = allHooks.filter(h => Math.abs(h.timestamp - r.timestamp) <= 2000)
      return {
        seq: r.sequence, method: r.method, url: r.url,
        headers: this.safeParseJson(r.request_headers) || {},
        body: r.request_body, status: r.status_code,
        responseHeaders: r.response_headers ? this.safeParseJson(r.response_headers) : null,
        responseBody: r.response_body, hooks: relatedHooks,
        timestamp: r.timestamp,
      }
    })

    const storageDiff = {
      cookies: this.calcDiff(allSnapshots, 'cookie'),
      localStorage: this.calcDiff(allSnapshots, 'localStorage'),
      sessionStorage: this.calcDiff(allSnapshots, 'sessionStorage')
    }

    this.applyTokenBudget(assembledRequests)

    // Extract crypto-related JS snippets from stored JS response bodies
    const cryptoExtractor = new CryptoScriptExtractor(this.requestsRepo, this.jsHooksRepo)
    const cryptoScripts = cryptoExtractor.extract(sessionId, CRYPTO_BUDGET_CHARS)

    const estimatedTokens = this.estimateTokens(assembledRequests, storageDiff)

    return {
      requests: assembledRequests,
      storageDiff,
      estimatedTokens,
      sceneHints: new SceneDetector().detect(assembledRequests),
      streamingRequests: (() => {
        const rawRequestMap = new Map(allRequests.map(r => [r.sequence, r]))
        return assembledRequests.filter(r => {
          const rawReq = rawRequestMap.get(r.seq)
          return rawReq?.is_streaming || rawReq?.is_websocket
        })
      })(),
      authChain: this.extractAuthChain(assembledRequests),
      cryptoScripts,
    }
  }

  private isRelevantRequest(r: CapturedRequest): boolean {
    if (r.method !== 'GET') return true
    if (STATIC_EXTENSIONS.test(r.url)) return false
    if (r.content_type && API_CONTENT_TYPES.some(t => r.content_type!.includes(t))) return true
    if (r.content_type?.includes('html')) return true
    if (r.request_body) return true
    return false
  }

  private calcDiff(snapshots: StorageSnapshot[], type: string): StorageDiff {
    const typed = snapshots.filter(s => s.storage_type === type)
    if (typed.length < 2) return { added: {}, changed: {}, removed: [] }
    const first = this.safeParseJson(typed[0].data) || {}
    const last = this.safeParseJson(typed[typed.length - 1].data) || {}
    const added: Record<string, string> = {}, changed: Record<string, { old: string; new: string }> = {}, removed: string[] = []
    for (const key of Object.keys(last)) {
      if (!(key in first)) added[key] = String(last[key])
      else if (JSON.stringify(first[key]) !== JSON.stringify(last[key])) changed[key] = { old: String(first[key]), new: String(last[key]) }
    }
    for (const key of Object.keys(first)) { if (!(key in last)) removed.push(key) }
    return { added, changed, removed }
  }

  private applyTokenBudget(requests: FilteredRequest[]): void {
    let totalChars = requests.reduce((sum, r) => sum + JSON.stringify(r.headers).length + r.url.length + (r.body?.length || 0) + (r.responseBody?.length || 0), 0)
    const budgetChars = TOKEN_BUDGET * CHARS_PER_TOKEN
    if (totalChars <= budgetChars) return
    const sorted = [...requests].filter(r => r.responseBody && r.responseBody.length > 500).sort((a, b) => (b.responseBody?.length || 0) - (a.responseBody?.length || 0))
    for (const req of sorted) {
      if (totalChars <= budgetChars) break
      const currentLen = req.responseBody?.length || 0
      const truncLen = Math.max(500, Math.floor(currentLen / 4))
      req.responseBody = req.responseBody!.substring(0, truncLen) + '\n[TRUNCATED FOR TOKEN BUDGET]'
      totalChars -= (currentLen - truncLen)
    }
  }

  private estimateTokens(requests: FilteredRequest[], storageDiff: AssembledData['storageDiff']): number {
    let chars = requests.reduce((sum, r) => sum + JSON.stringify(r).length, 0) + JSON.stringify(storageDiff).length
    return Math.ceil(chars / CHARS_PER_TOKEN)
  }

  private safeParseJson(json: string | null): Record<string, any> | null {
    if (!json) return null
    try { return JSON.parse(json) } catch { return null }
  }

  private extractAuthChain(requests: FilteredRequest[]): AuthChainItem[] {
    const authChain: AuthChainItem[] = []

    for (const req of requests) {
      // 检查响应中是否返回了 token
      if (req.responseBody) {
        try {
          const data = JSON.parse(req.responseBody)
          if (data.access_token) {
            authChain.push({
              source: `${req.method} ${new URL(req.url).pathname} 响应`,
              credentialType: 'Bearer Token',
              credential: this.maskCredential(data.access_token),
              consumers: []
            })
          }
          if (data.refresh_token) {
            authChain.push({
              source: `${req.method} ${new URL(req.url).pathname} 响应`,
              credentialType: 'Refresh Token',
              credential: this.maskCredential(data.refresh_token),
              consumers: []
            })
          }
        } catch { /* non-JSON response */ }
      }

      // 检查响应中的 Set-Cookie
      if (req.responseHeaders) {
        const rawSetCookie = req.responseHeaders['set-cookie'] || req.responseHeaders['Set-Cookie']
        if (rawSetCookie) {
          const cookies = Array.isArray(rawSetCookie) ? rawSetCookie : [rawSetCookie]
          for (const cookie of cookies) {
            const cookieName = String(cookie).split('=')[0]
            authChain.push({
              source: `${req.method} ${new URL(req.url).pathname} Set-Cookie`,
              credentialType: 'Session Cookie',
              credential: `${cookieName}=...`,
              consumers: []
            })
          }
        }
      }
    }

    // 标记 consumers：哪些后续请求使用了这些凭据
    for (const req of requests) {
      const authHeader = req.headers['authorization'] || req.headers['Authorization'] || ''
      if (authHeader.startsWith('Bearer ')) {
        const token = authHeader.substring(7)
        const matchingItem = authChain.find(a => a.credentialType === 'Bearer Token' && token.startsWith(a.credential.substring(0, 8)))
        if (matchingItem) {
          try { matchingItem.consumers.push(new URL(req.url).pathname) } catch { matchingItem.consumers.push(req.url) }
        }
      }
    }

    return authChain
  }

  private maskCredential(value: string): string {
    if (value.length <= 16) return '***'
    return value.substring(0, 8) + '...' + value.substring(value.length - 8)
  }

  /**
   * 从已组装数据中提取轻量请求摘要（用于 Phase 1 预过滤）
   */
  extractSummaries(data: AssembledData): RequestSummary[] {
    const streamingSeqs = new Set(data.streamingRequests.map(r => r.seq))
    return data.requests.map(r => {
      const authHeader = r.headers['authorization'] || r.headers['Authorization'] || ''
      return {
        seq: r.seq,
        method: r.method,
        url: r.url,
        status: r.status,
        contentType: r.responseHeaders?.['content-type']
          ?? r.responseHeaders?.['Content-Type']
          ?? r.headers['content-type']
          ?? r.headers['Content-Type']
          ?? null,
        timestamp: r.timestamp,
        bodyBytes: r.body ? r.body.length : 0,
        responseBytes: r.responseBody ? r.responseBody.length : 0,
        hasAuthHeader: Boolean(authHeader),
        isStreaming: streamingSeqs.has(r.seq),
        hookCount: r.hooks.length,
      }
    })
  }

  /**
   * 按序号过滤已组装数据，保留全局上下文（sceneHints、authChain、storageDiff、cryptoScripts）
   */
  filterBySeqs(data: AssembledData, selectedSeqs: number[]): AssembledData {
    const seqSet = new Set(selectedSeqs)
    const filteredRequests = data.requests.filter(r => seqSet.has(r.seq))
    return {
      ...data,
      requests: filteredRequests,
      streamingRequests: data.streamingRequests.filter(r => seqSet.has(r.seq)),
      estimatedTokens: this.estimateTokens(filteredRequests, data.storageDiff),
    }
  }
}
