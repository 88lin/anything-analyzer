import { useState, useEffect, useCallback, useRef } from "react";
import type {
  CapturedRequest,
  JsHookRecord,
  StorageSnapshot,
  AnalysisReport,
  ChatMessage,
  InteractionEvent,
} from "@shared/types";
import { IPC_CHANNELS } from "@shared/types";
import {
  findLatestConversationTokenUsage,
  type ConversationTokenUsage,
} from "@shared/token-estimate";

export interface UseCaptureState {
  requests: CapturedRequest[];
  hooks: JsHookRecord[];
  snapshots: StorageSnapshot[];
  reports: AnalysisReport[];
  interactions: InteractionEvent[];
  isAnalyzing: boolean;
  analysisError: string | null;
  streamingContent: string;
  selectedRequest: CapturedRequest | null;
  chatHistory: ChatMessage[];
  latestContextUsage: ConversationTokenUsage | null;
  isChatting: boolean;
  chatError: string | null;
}

interface UseCaptureReturn extends UseCaptureState {
  loadData: (sessionId: string) => Promise<void>;
  clearData: () => void;
  clearCaptureData: (sessionId: string) => Promise<void>;
  selectRequest: (request: CapturedRequest | null) => void;
  startAnalysis: (sessionId: string, purpose?: string, selectedSeqs?: number[], model?: string) => Promise<void>;
  cancelAnalysis: (sessionId: string) => Promise<void>;
  sendFollowUp: (sessionId: string, message: string) => Promise<void>;
}

export const INITIAL_CAPTURE_STATE: UseCaptureState = {
  requests: [],
  hooks: [],
  snapshots: [],
  reports: [],
  interactions: [],
  isAnalyzing: false,
  analysisError: null,
  streamingContent: "",
  selectedRequest: null,
  chatHistory: [],
  latestContextUsage: null,
  isChatting: false,
  chatError: null,
};

export function prepareStateForAnalysis(prev: UseCaptureState): UseCaptureState {
  return {
    ...prev,
    reports: [],
    chatHistory: [],
    latestContextUsage: null,
    isAnalyzing: true,
    isChatting: false,
    analysisError: null,
    chatError: null,
    streamingContent: "",
  };
}

export function useCapture(sessionId: string | null): UseCaptureReturn {
  const [state, setState] = useState<UseCaptureState>(INITIAL_CAPTURE_STATE);
  const sessionIdRef = useRef(sessionId);
  const conversationVersionRef = useRef(0);

  // Keep ref in sync for use in callbacks
  useEffect(() => {
    sessionIdRef.current = sessionId;
    conversationVersionRef.current += 1;
  }, [sessionId]);

  // Clear all data
  const clearData = useCallback(() => {
    conversationVersionRef.current += 1;
    setState(INITIAL_CAPTURE_STATE);
  }, []);

  // Clear all capture data from DB and reset local state
  const clearCaptureData = useCallback(async (sid: string) => {
    await window.electronAPI.clearCaptureData(sid);
    conversationVersionRef.current += 1;
    setState(INITIAL_CAPTURE_STATE);
  }, []);

  // Select a request for detail view
  const selectRequest = useCallback((request: CapturedRequest | null) => {
    setState((prev) => ({ ...prev, selectedRequest: request }));
  }, []);

  // Load all data for a session from main process
  const loadData = useCallback(async (sid: string) => {
    const conversationVersion = conversationVersionRef.current;
    try {
      const [requests, hooks, snapshots, reports, interactions, aiRequestLogs] = await Promise.all([
        window.electronAPI.getRequests(sid),
        window.electronAPI.getHooks(sid),
        window.electronAPI.getStorage(sid),
        window.electronAPI.getReports(sid),
        window.electronAPI.getInteractions(sid),
        window.electronAPI.getAiRequestLogs(sid),
      ]);
      const sortedReports = [...reports].sort((a, b) => b.created_at - a.created_at);
      const latestReport = sortedReports[0] ?? null;
      const latestContextUsage = findLatestConversationTokenUsage(aiRequestLogs, latestReport);

      // Restore chat history for the latest report
      let chatHistory: ChatMessage[] = [];
      if (latestReport) {
        const savedMessages = await window.electronAPI.getChatMessages(latestReport.id);
        if (savedMessages.length > 0) {
          chatHistory = savedMessages as ChatMessage[];
        } else {
          // Legacy report without persisted chat — reconstruct [system, assistant] prefix
          // so that chatHistory.slice(2) renders follow-up messages correctly
          const reqSummary = requests.slice(0, 50).map(r => {
            let path = r.url;
            try { path = new URL(r.url).pathname; } catch { /* keep full url */ }
            return `#${r.sequence} ${r.method} ${path} → ${r.status_code ?? '?'}`;
          }).join('\n');

          const hookSummary = hooks.length > 0
            ? '\n\nDetected hooks:\n' + hooks.slice(0, 20).map(h =>
                `[${h.hook_type}] ${h.function_name}`
              ).join('\n')
            : '';

          const contextBlock = reqSummary
            ? `\n\n<captured_data_summary>\nCaptured ${requests.length} requests:\n${reqSummary}${requests.length > 50 ? `\n... and ${requests.length - 50} more` : ''}${hookSummary}\n</captured_data_summary>`
            : '';

          const systemContent = `你是一位网站协议分析专家。基于之前的分析报告和捕获数据，回答用户的追问。保持技术精确，用中文回复。\n\n你可以使用 get_request_detail 工具，通过传入请求序号(seq)来查看任意请求的完整详情（请求头、请求体、响应头、响应体）。当用户追问某个具体请求或需要更多细节时，请主动调用此工具获取数据。${contextBlock}`;

          chatHistory = [
            { role: 'system' as const, content: systemContent },
            { role: 'assistant' as const, content: latestReport.report_content },
          ];

          // Persist for future loads
          window.electronAPI.saveChatMessages(latestReport.id, chatHistory)
            .catch(err => console.error("Failed to backfill chat messages:", err));
        }
      }

      // Only update if session hasn't changed while loading
      if (sessionIdRef.current === sid && conversationVersionRef.current === conversationVersion) {
        setState((prev) => ({
          ...prev,
          requests: requests.sort((a, b) => a.sequence - b.sequence),
          hooks: hooks.sort((a, b) => b.timestamp - a.timestamp),
          snapshots,
          reports: sortedReports,
          interactions: (interactions || []).sort((a, b) => a.sequence - b.sequence),
          chatHistory,
          latestContextUsage,
        }));
      }
    } catch (err) {
      console.error("Failed to load capture data:", err);
    }
  }, []);

  // Start AI analysis for a session
  const startAnalysis = useCallback(async (sid: string, purpose?: string, selectedSeqs?: number[], model?: string) => {
    const conversationVersion = conversationVersionRef.current + 1;
    conversationVersionRef.current = conversationVersion;
    setState(prepareStateForAnalysis);

    try {
      const report = await window.electronAPI.startAnalysis(sid, purpose, selectedSeqs, model);

      // Only update if session hasn't changed
      if (sessionIdRef.current === sid && conversationVersionRef.current === conversationVersion) {
        // Build context summary from captured data for follow-up chat
        // (read current state synchronously via a mini-setState that returns prev unchanged)
        let systemContent = '';
        setState((prev) => {
          const reqSummary = prev.requests.slice(0, 50).map(r => {
            let path = r.url
            try { path = new URL(r.url).pathname } catch { /* keep full url */ }
            return `#${r.sequence} ${r.method} ${path} → ${r.status_code ?? '?'}`
          }).join('\n')

          const hookSummary = prev.hooks.length > 0
            ? '\n\nDetected hooks:\n' + prev.hooks.slice(0, 20).map(h =>
                `[${h.hook_type}] ${h.function_name}`
              ).join('\n')
            : ''

          const contextBlock = reqSummary
            ? `\n\n<captured_data_summary>\nCaptured ${prev.requests.length} requests:\n${reqSummary}${prev.requests.length > 50 ? `\n... and ${prev.requests.length - 50} more` : ''}${hookSummary}\n</captured_data_summary>`
            : ''

          systemContent = `你是一位网站协议分析专家。基于之前的分析报告和捕获数据，回答用户的追问。保持技术精确，用中文回复。

你可以使用 get_request_detail 工具，通过传入请求序号(seq)来查看任意请求的完整详情（请求头、请求体、响应头、响应体）。当用户追问某个具体请求或需要更多细节时，请主动调用此工具获取数据。${contextBlock}`

          const chatHistory: ChatMessage[] = [
            { role: 'system' as const, content: systemContent },
            { role: 'assistant' as const, content: report.report_content },
          ];

          return {
            ...prev,
            isAnalyzing: false,
            streamingContent: "",
            reports: [report, ...prev.reports],
            chatHistory,
            latestContextUsage: null,
            chatError: null,
          }
        });

        // Persist initial chat messages (system prompt + report) to database
        window.electronAPI.saveChatMessages(report.id, [
          { role: 'system', content: systemContent },
          { role: 'assistant', content: report.report_content },
        ]).catch(err => console.error("Failed to save initial chat messages:", err));
      }
    } catch (err) {
      console.error("Analysis failed:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const isCancelled = errMsg.includes("Analysis cancelled") || errMsg.includes("aborted");
      if (sessionIdRef.current === sid && conversationVersionRef.current === conversationVersion) {
        setState((prev) => ({
          ...prev,
          isAnalyzing: false,
          streamingContent: "",
          analysisError: isCancelled ? null : errMsg,
        }));
      }
    }
  }, []);

  // Cancel an in-progress analysis
  const cancelAnalysis = useCallback(async (sid: string) => {
    conversationVersionRef.current += 1;
    await window.electronAPI.cancelAnalysis(sid);
    setState((prev) => ({
      ...prev,
      isAnalyzing: false,
      streamingContent: "",
      analysisError: null,
    }));
  }, []);

  const chatHistoryRef = useRef<ChatMessage[]>([]);
  useEffect(() => {
    chatHistoryRef.current = state.chatHistory;
  }, [state.chatHistory]);

  const sendFollowUp = useCallback(async (sid: string, message: string) => {
    const conversationVersion = conversationVersionRef.current;
    // Get the latest report ID for persisting chat messages
    let currentReportId = '';
    let currentReportScope: Pick<AnalysisReport, 'id' | 'created_at'> | null = null;
    setState((prev) => {
      if (prev.reports.length > 0) {
        currentReportId = prev.reports[0].id;
        currentReportScope = {
          id: prev.reports[0].id,
          created_at: prev.reports[0].created_at,
        };
      }
      return {
        ...prev,
        isChatting: true,
        chatError: null,
        streamingContent: "",
        chatHistory: [...prev.chatHistory, { role: 'user' as const, content: message }],
      };
    });

    try {
      const reply = await window.electronAPI.sendFollowUp(sid, currentReportId, chatHistoryRef.current, message);
      const latestContextUsage = await window.electronAPI.getAiRequestLogs(sid)
        .then((logs) => findLatestConversationTokenUsage(logs, currentReportScope))
        .catch(() => null);

      if (sessionIdRef.current === sid && conversationVersionRef.current === conversationVersion) {
        setState((prev) => ({
          ...prev,
          isChatting: false,
          streamingContent: "",
          chatHistory: [...prev.chatHistory, { role: 'assistant' as const, content: reply }],
          latestContextUsage: latestContextUsage ?? prev.latestContextUsage,
        }));
      }
    } catch (err) {
      console.error("Follow-up chat failed:", err);
      const errMsg = err instanceof Error ? err.message : String(err);
      if (sessionIdRef.current === sid && conversationVersionRef.current === conversationVersion) {
        setState((prev) => ({
          ...prev,
          isChatting: false,
          streamingContent: "",
          chatError: errMsg,
          // Roll back the optimistically added user message on failure
          chatHistory: prev.chatHistory.length > 0 && prev.chatHistory[prev.chatHistory.length - 1]?.role === 'user'
            ? prev.chatHistory.slice(0, -1)
            : prev.chatHistory,
        }));
      }
    }
  }, []);

  // Set up IPC event listeners for real-time updates
  useEffect(() => {
    if (!sessionId) {
      clearData();
      return;
    }

    // Load initial data
    loadData(sessionId);

    // --- Batched request/hook/storage buffering for performance ---
    const requestBuffer: CapturedRequest[] = [];
    const hookBuffer: JsHookRecord[] = [];
    const storageBuffer: StorageSnapshot[] = [];
    let flushTimer: ReturnType<typeof setInterval> | null = null;

    const flush = () => {
      if (requestBuffer.length > 0 || hookBuffer.length > 0 || storageBuffer.length > 0) {
        const reqBatch = requestBuffer.splice(0);
        const hookBatch = hookBuffer.splice(0);
        const storageBatch = storageBuffer.splice(0);
        setState((prev) => ({
          ...prev,
          requests: reqBatch.length > 0 ? [...prev.requests, ...reqBatch] : prev.requests,
          hooks: hookBatch.length > 0 ? [...hookBatch, ...prev.hooks] : prev.hooks,
          snapshots: storageBatch.length > 0 ? [...prev.snapshots, ...storageBatch] : prev.snapshots,
        }));
      }
    };

    flushTimer = setInterval(flush, 300);

    // Listen for new captured requests — buffer instead of immediate setState
    const handleRequest = (data: CapturedRequest) => {
      if (data.session_id !== sessionIdRef.current) return;
      requestBuffer.push(data);
    };

    // Listen for new hook records — buffer instead of immediate setState
    const handleHook = (data: JsHookRecord) => {
      if (data.session_id !== sessionIdRef.current) return;
      hookBuffer.push(data);
    };

    // Listen for new storage snapshots — buffer instead of immediate setState
    const handleStorage = (data: StorageSnapshot) => {
      if (data.session_id !== sessionIdRef.current) return;
      storageBuffer.push(data);
    };

    // Listen for analysis progress (streaming chunks)
    const handleAnalysisProgress = (chunk: string) => {
      setState((prev) => {
        if (!prev.isAnalyzing && !prev.isChatting) return prev;
        return {
          ...prev,
          streamingContent: prev.streamingContent + chunk,
        };
      });
    };

    window.electronAPI.onRequestCaptured(handleRequest);
    window.electronAPI.onHookCaptured(handleHook);
    window.electronAPI.onStorageCaptured(handleStorage);
    window.electronAPI.onAnalysisProgress(handleAnalysisProgress);

    // Listen for interaction recording events (debounced to avoid excessive DB queries)
    let interactionDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    window.electronAPI.onInteractionRecorded(() => {
      if (interactionDebounceTimer) clearTimeout(interactionDebounceTimer);
      interactionDebounceTimer = setTimeout(() => {
        if (sessionIdRef.current) {
          window.electronAPI.getInteractions(sessionIdRef.current).then((interactions: InteractionEvent[]) => {
            setState((prev) => ({
              ...prev,
              interactions: (interactions || []).sort((a, b) => a.sequence - b.sequence),
            }));
          }).catch(() => {});
        }
      }, 500);
    });

    // Cleanup listeners on unmount or session change
    return () => {
      if (flushTimer) clearInterval(flushTimer);
      if (interactionDebounceTimer) clearTimeout(interactionDebounceTimer);
      flush(); // flush remaining buffered items
      window.electronAPI.removeAllListeners(IPC_CHANNELS.CAPTURE_REQUEST);
      window.electronAPI.removeAllListeners(IPC_CHANNELS.CAPTURE_HOOK);
      window.electronAPI.removeAllListeners(IPC_CHANNELS.CAPTURE_STORAGE);
      window.electronAPI.removeAllListeners(IPC_CHANNELS.AI_PROGRESS);
      window.electronAPI.removeAllListeners('interaction:recorded');
    };
  }, [sessionId, loadData, clearData]);

  return {
    ...state,
    loadData,
    clearData,
    clearCaptureData,
    selectRequest,
    startAnalysis,
    cancelAnalysis,
    sendFollowUp,
  };
}

export default useCapture;
