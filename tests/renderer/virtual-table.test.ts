import { describe, expect, it, vi } from 'vitest'
import {
  buildRowLookup,
  filterRows,
  getVirtualRange,
} from '../../src/renderer/ui/VirtualTable.utils'

describe('VirtualTable large data helpers', () => {
  it('limits a 10k dataset to the visible window plus overscan', () => {
    const range = getVirtualRange({
      itemCount: 10_000,
      rowHeight: 32,
      viewportHeight: 320,
      scrollTop: 160_000,
      overscan: 3,
    })

    expect(range.startIndex).toBe(4_997)
    expect(range.endIndex - range.startIndex).toBeLessThanOrEqual(16)
    expect(range.offsetTop).toBe(range.startIndex * 32)
  })

  it('builds constant-time row key and position lookups', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({ id: index + 1 }))
    const lookup = buildRowLookup(rows, 'id')

    expect(lookup.keys).toHaveLength(10_000)
    expect(lookup.indexByKey.get(9_999)).toBe(9_998)
    expect(lookup.rowByKey.get(10_000)).toBe(rows[9_999])
  })

  it('applies active filters in one row scan with early exit', () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => ({
      method: index % 2 === 0 ? 'GET' : 'POST',
      source: index % 3 === 0 ? 'proxy' : 'cdp',
    }))
    const methodFilter = vi.fn((value: string, row: (typeof rows)[number]) => row.method === value)
    const sourceFilter = vi.fn((value: string, row: (typeof rows)[number]) => row.source === value)

    const result = filterRows(rows, [
      { values: new Set(['GET']), matches: methodFilter },
      { values: new Set(['proxy']), matches: sourceFilter },
    ])

    expect(result).toHaveLength(1_667)
    expect(methodFilter).toHaveBeenCalledTimes(10_000)
    expect(sourceFilter).toHaveBeenCalledTimes(5_000)
  })
})
