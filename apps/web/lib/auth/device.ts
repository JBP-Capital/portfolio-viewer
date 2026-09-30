import { deviceByToken, getMember, type Member } from '@pv/db'
import { cookies } from 'next/headers'
import { cache } from 'react'
import { getDb } from '../db.ts'
import { DEVICE_COOKIE } from './device-cookie.ts'

/** The member a paired TV shows (read-only), or null when this browser holds no valid device token. */
export const getDeviceMember = cache(async (): Promise<Member | null> => {
  const token = (await cookies()).get(DEVICE_COOKIE)?.value
  if (!token) return null
  const device = await deviceByToken(getDb(), token)
  return device ? getMember(getDb(), device.memberId) : null
})
