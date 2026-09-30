'use server'

import { createPortfolio, ValidationError } from '@pv/db'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireMember } from '../lib/auth/session.ts'
import { getDb } from '../lib/db.ts'

export async function createPortfolioAction(form: FormData) {
  const member = await requireMember()
  try {
    await createPortfolio(getDb(), member.id, { name: String(form.get('name') ?? '') })
  } catch (error) {
    if (error instanceof ValidationError) redirect('/?error=name')
    throw error
  }
  revalidatePath('/')
}
