export type VirtualTableRowKey = string | number

type RowKeyGetter<T> = string | ((record: T) => VirtualTableRowKey)

export interface RowLookup<T> {
  keys: VirtualTableRowKey[]
  indexByKey: Map<VirtualTableRowKey, number>
  rowByKey: Map<VirtualTableRowKey, T>
}

export interface ActiveFilterRule<T> {
  values: Set<string>
  matches: (value: string, record: T) => boolean
}

export interface VirtualRangeOptions {
  itemCount: number
  rowHeight: number
  viewportHeight: number
  scrollTop: number
  overscan?: number
}

export interface VirtualRange {
  startIndex: number
  endIndex: number
  offsetTop: number
}

export function resolveRowKey<T>(record: T, rowKey: RowKeyGetter<T>): VirtualTableRowKey {
  return typeof rowKey === 'function'
    ? rowKey(record)
    : (record as Record<string, unknown>)[rowKey] as VirtualTableRowKey
}

export function buildRowLookup<T>(data: T[], rowKey: RowKeyGetter<T>): RowLookup<T> {
  const keys = new Array<VirtualTableRowKey>(data.length)
  const indexByKey = new Map<VirtualTableRowKey, number>()
  const rowByKey = new Map<VirtualTableRowKey, T>()

  for (let index = 0; index < data.length; index += 1) {
    const record = data[index]
    const key = resolveRowKey(record, rowKey)
    keys[index] = key
    indexByKey.set(key, index)
    rowByKey.set(key, record)
  }

  return { keys, indexByKey, rowByKey }
}

export function filterRows<T>(data: T[], rules: ActiveFilterRule<T>[]): T[] {
  if (rules.length === 0) return data

  const result: T[] = []
  rowLoop: for (const record of data) {
    for (const rule of rules) {
      let matched = false
      for (const value of rule.values) {
        if (rule.matches(value, record)) {
          matched = true
          break
        }
      }
      if (!matched) continue rowLoop
    }
    result.push(record)
  }

  return result
}

export function getVirtualRange({
  itemCount,
  rowHeight,
  viewportHeight,
  scrollTop,
  overscan = 3,
}: VirtualRangeOptions): VirtualRange {
  if (itemCount <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0 }
  }

  const firstVisibleIndex = Math.floor(Math.max(0, scrollTop) / rowHeight)
  const visibleCount = Math.ceil(viewportHeight / rowHeight)
  const startIndex = Math.max(0, firstVisibleIndex - overscan)
  const endIndex = Math.min(itemCount, firstVisibleIndex + visibleCount + overscan)

  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * rowHeight,
  }
}
