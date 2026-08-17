import { describe, expect, it, vi } from 'vitest'
import * as invariant from '../src/invariant.ts'

describe('WorkSurface core invariant companion', () => {
  it('reserves package ownership with an explained empty installer', async () => {
    const dispose = vi.fn()
    const register = vi.fn((_packageName: string, _installer: (ctx: never) => void) => dispose)
    const result = await invariant.apply({ invariants: { register } } as never)
    expect(invariant.name).toBe('worksurface-core-invariant')
    expect(invariant.inject).toEqual(['invariants'])
    expect(result).toBe(dispose)
    expect(register).toHaveBeenCalledWith('@pf-worksurface/core', expect.any(Function))
    expect(register.mock.calls[0]?.[1]?.({} as never)).toBeUndefined()
  })
})
