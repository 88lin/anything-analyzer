/**
 * Interaction recording hook script injected into the target browser page context.
 * Records clicks, inputs, scrolls, and mouse movement for AI automation replay.
 */
;(function () {
  const MSG_TYPE = 'ar-interaction'
  let isRecording = false

  // Mouse move sampling config
  const MOVE_SAMPLE_INTERVAL = 50    // ms between samples
  const MOVE_FLUSH_INTERVAL = 2000   // ms, flush buffer every 2s
  const IDLE_THRESHOLD = 500         // ms, end trace segment on idle
  const MIN_MOVE_DISTANCE = 5        // px, ignore micro-movements

  let moveBuffer: Array<{ x: number; y: number; t: number }> = []
  let lastMoveTime = 0
  let lastMoveX = 0
  let lastMoveY = 0
  let moveFlushTimer: ReturnType<typeof setTimeout> | null = null

  // Input debounce
  const inputTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>()

  // Control: main process toggles recording via executeJavaScript
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'ar-interaction-control') {
      isRecording = e.data.recording
      if (!isRecording) {
        flushMoveBuffer()
      }
    }
  })

  function send(data: Record<string, unknown>): void {
    try {
      window.postMessage({ type: MSG_TYPE, ...data }, '*')
    } catch { /* ignore serialization errors */ }
  }

  // ---- Selector Generation ----

  function isDynamicId(id: string): boolean {
    return /[0-9a-f]{8,}|_\d+$|^:r\d+:|^ember\d+|^react-|^mui-/.test(id)
  }

  function getSelector(el: Element): string {
    // Priority 1: stable id
    if (el.id && !isDynamicId(el.id)) {
      return `#${CSS.escape(el.id)}`
    }
    // Priority 2: test attributes
    for (const attr of ['data-testid', 'data-cy', 'data-test', 'aria-label', 'data-id']) {
      const val = el.getAttribute(attr)
      if (val) {
        return `[${attr}="${CSS.escape(val)}"]`
      }
    }
    // Priority 3: unique tag + class combination
    const tag = el.tagName.toLowerCase()
    if (el.className && typeof el.className === 'string') {
      const classes = el.className.trim().split(/\s+/).filter(c => !isDynamicId(c)).slice(0, 3)
      if (classes.length > 0) {
        const sel = `${tag}.${classes.map(c => CSS.escape(c)).join('.')}`
        if (document.querySelectorAll(sel).length === 1) {
          return sel
        }
      }
    }
    // Priority 4: nth-child path
    return buildNthChildPath(el)
  }

  function buildNthChildPath(el: Element): string {
    const parts: string[] = []
    let current: Element | null = el
    while (current && current !== document.documentElement) {
      const tag = current.tagName.toLowerCase()
      const parent = current.parentElement
      if (!parent) {
        parts.unshift(tag)
        break
      }
      const sameTagSiblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName)
      if (sameTagSiblings.length === 1) {
        parts.unshift(tag)
      } else {
        const index = sameTagSiblings.indexOf(current) + 1
        parts.unshift(`${tag}:nth-of-type(${index})`)
      }
      current = parent
      if (parts.length >= 5) break // limit depth
    }
    return parts.join(' > ')
  }

  function getXPath(el: Element): string {
    const parts: string[] = []
    let current: Element | null = el
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1
      let sibling: Element | null = current.previousElementSibling
      while (sibling) {
        if (sibling.tagName === current.tagName) index++
        sibling = sibling.previousElementSibling
      }
      const tag = current.tagName.toLowerCase()
      parts.unshift(`${tag}[${index}]`)
      current = current.parentElement
      if (parts.length >= 7) break
    }
    return '//' + parts.join('/')
  }

  function getAttributes(el: Element): Record<string, string> {
    const attrs: Record<string, string> = {}
    const keys = ['id', 'class', 'name', 'type', 'href', 'src', 'placeholder', 'role', 'aria-label',
      'data-testid', 'data-id', 'data-action', 'value', 'title', 'alt']
    for (const key of keys) {
      const val = el.getAttribute(key)
      if (val) attrs[key] = val.slice(0, 200) // truncate long values
    }
    return attrs
  }

  function getActionElement(target: EventTarget | null): Element | null {
    if (!(target instanceof Element)) return null
    return target.closest([
      'button',
      'a[href]',
      'input',
      'textarea',
      'select',
      '[role="button"]',
      '[role="link"]',
      '[contenteditable="true"]',
      '[tabindex]',
    ].join(',')) || target
  }

  // ---- Event Handlers ----

  // Click
  document.addEventListener('click', (e: MouseEvent) => {
    if (!isRecording) return
    const el = getActionElement(e.target)
    if (!el) return
    send({
      interactionType: 'click',
      timestamp: Date.now(),
      x: e.pageX,
      y: e.pageY,
      viewportX: e.clientX,
      viewportY: e.clientY,
      selector: getSelector(el),
      xpath: getXPath(el),
      tagName: el.tagName.toLowerCase(),
      elementText: (el.textContent || '').trim().slice(0, 100),
      attributes: getAttributes(el),
      boundingRect: el.getBoundingClientRect().toJSON(),
      url: location.href,
      pageTitle: document.title,
    })
  }, true)

  // Double click
  document.addEventListener('dblclick', (e: MouseEvent) => {
    if (!isRecording) return
    const el = getActionElement(e.target)
    if (!el) return
    send({
      interactionType: 'dblclick',
      timestamp: Date.now(),
      x: e.pageX,
      y: e.pageY,
      viewportX: e.clientX,
      viewportY: e.clientY,
      selector: getSelector(el),
      xpath: getXPath(el),
      tagName: el.tagName.toLowerCase(),
      elementText: (el.textContent || '').trim().slice(0, 100),
      attributes: getAttributes(el),
      boundingRect: el.getBoundingClientRect().toJSON(),
      url: location.href,
      pageTitle: document.title,
    })
  }, true)

  // Input (debounced — record final value after 500ms idle)
  document.addEventListener('input', (e: Event) => {
    if (!isRecording) return
    const el = e.target as HTMLInputElement | HTMLTextAreaElement
    if (!el || !('value' in el)) return

    // Clear previous timer for this element
    const prev = inputTimers.get(el)
    if (prev) clearTimeout(prev)

    const timer = setTimeout(() => {
      const isSensitive = el.type === 'password' || el.getAttribute('autocomplete')?.includes('password')
      send({
        interactionType: 'input',
        timestamp: Date.now(),
        selector: getSelector(el),
        xpath: getXPath(el),
        tagName: el.tagName.toLowerCase(),
        elementText: null,
        attributes: getAttributes(el),
        boundingRect: el.getBoundingClientRect().toJSON(),
        inputValue: isSensitive ? '[MASKED]' : el.value,
        url: location.href,
        pageTitle: document.title,
      })
      inputTimers.delete(el)
    }, 500)
    inputTimers.set(el, timer)
  }, true)

  // Scroll (throttled to max once per 200ms)
  let lastScrollTime = 0
  let scrollTimer: ReturnType<typeof setTimeout> | null = null
  document.addEventListener('scroll', () => {
    if (!isRecording) return
    const now = Date.now()
    if (now - lastScrollTime < 200) {
      // Queue final position
      if (scrollTimer) clearTimeout(scrollTimer)
      scrollTimer = setTimeout(() => {
        emitScroll()
        scrollTimer = null
      }, 250)
      return
    }
    lastScrollTime = now
    emitScroll()
  }, true)

  function emitScroll(): void {
    send({
      interactionType: 'scroll',
      timestamp: Date.now(),
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      viewportX: window.innerWidth / 2,
      viewportY: window.innerHeight / 2,
      url: location.href,
      pageTitle: document.title,
    })
  }

  // Mouse move (sampled)
  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isRecording) return
    const now = Date.now()

    // Check idle threshold — flush if mouse was idle
    if (now - lastMoveTime > IDLE_THRESHOLD && moveBuffer.length > 0) {
      flushMoveBuffer()
    }

    // Time-based sampling
    if (now - lastMoveTime < MOVE_SAMPLE_INTERVAL) return

    // Distance filter
    const dx = e.clientX - lastMoveX
    const dy = e.clientY - lastMoveY
    if (Math.sqrt(dx * dx + dy * dy) < MIN_MOVE_DISTANCE) return

    lastMoveTime = now
    lastMoveX = e.clientX
    lastMoveY = e.clientY

    moveBuffer.push({ x: e.clientX, y: e.clientY, t: now })

    // Start flush timer if not already running
    if (!moveFlushTimer) {
      moveFlushTimer = setTimeout(() => {
        flushMoveBuffer()
        moveFlushTimer = null
      }, MOVE_FLUSH_INTERVAL)
    }
  }, true)

  function flushMoveBuffer(): void {
    if (moveBuffer.length < 3) {
      moveBuffer = []
      return // ignore very short movements
    }
    send({
      interactionType: 'hover',
      timestamp: moveBuffer[0].t,
      path: moveBuffer,
      url: location.href,
      pageTitle: document.title,
    })
    moveBuffer = []
    if (moveFlushTimer) {
      clearTimeout(moveFlushTimer)
      moveFlushTimer = null
    }
  }
})()
