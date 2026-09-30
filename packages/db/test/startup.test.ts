import { describe, expect, it, vi } from 'vitest'
import { isDatabaseStarting, retryWhileDatabaseStarts } from '../src/startup.ts'

const starting = Object.assign(new Error('the database system is starting up'), { code: '57P03' })
// Drizzle wraps the driver error: the code sits on the cause.
const wrapped = Object.assign(new Error('Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"'), { cause: starting })
const refused = Object.assign(new Error('connect ECONNREFUSED 172.18.0.2:5432'), { code: 'ECONNREFUSED' })
const sqlError = Object.assign(new Error('syntax error'), { code: '42601' })

describe('database start-up', () => {
  it('recognizes a database that is still starting or not reachable yet', () => {
    expect(isDatabaseStarting(starting)).toBe(true)
    expect(isDatabaseStarting(wrapped)).toBe(true)
    expect(isDatabaseStarting(refused)).toBe(true)
    expect(isDatabaseStarting(Object.assign(new Error('getaddrinfo EAI_AGAIN db'), { code: 'EAI_AGAIN' }))).toBe(true)
    expect(isDatabaseStarting(sqlError)).toBe(false)
    expect(isDatabaseStarting('text')).toBe(false)
  })

  it('tries again while the database starts, waiting longer each time', async () => {
    const task = vi.fn().mockRejectedValueOnce(wrapped).mockRejectedValueOnce(refused).mockResolvedValue('migrated')
    const waits: number[] = []
    await expect(retryWhileDatabaseStarts(task, { sleep: async (ms) => void waits.push(ms) })).resolves.toBe('migrated')
    expect(task).toHaveBeenCalledTimes(3)
    expect(waits).toEqual([1000, 2000])
  })

  it('gives up on other errors at once, and on a database that never comes up after the time limit', async () => {
    const broken = vi.fn().mockRejectedValue(sqlError)
    await expect(retryWhileDatabaseStarts(broken, { sleep: async () => undefined })).rejects.toBe(sqlError)
    expect(broken).toHaveBeenCalledTimes(1)

    const never = vi.fn().mockRejectedValue(starting)
    const waits: number[] = []
    await expect(retryWhileDatabaseStarts(never, { sleep: async (ms) => void waits.push(ms), limitMs: 20_000 })).rejects.toBe(starting)
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(20_000)
    expect(Math.max(...waits)).toBeLessThanOrEqual(5000)
  })
})
