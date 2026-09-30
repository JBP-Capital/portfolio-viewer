import { listMembers } from '@pv/db'
import { getLocale, getTranslations } from 'next-intl/server'
import { AppShell } from '../../components/app-shell.tsx'
import { InviteForm } from '../../components/admin/invite-form.tsx'
import { ConfirmSubmit } from '../../components/portfolio/row-actions.tsx'
import { Button, Card, Overline } from '../../components/ui.tsx'
import { requireAdmin } from '../../lib/auth/session.ts'
import { getDb } from '../../lib/db.ts'
import { formatDate } from '../../lib/format.ts'
import { changeRole, changeStatus, deleteMemberAction, withdrawInvite } from './actions.ts'

export default async function AdminPage() {
  const admin = await requireAdmin()
  const t = await getTranslations('admin')
  const locale = await getLocale()
  const entries = await listMembers(getDb(), admin.id)
  const day = (date: Date | null) => (date ? formatDate(date.toISOString().slice(0, 10), locale) : '–')
  return (
    <AppShell>
      <div className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Overline>{t('overline')}</Overline>
          <h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">{t('title')}</h1>
        </header>
        <Card>
          <div className="flex flex-col gap-4">
            <h2 className="font-display text-2xl font-bold tracking-tight">{t('inviteTitle')}</h2>
            <p className="text-sm text-muted">{t('inviteHint')}</p>
            <InviteForm />
          </div>
        </Card>
        <section className="flex flex-col gap-3">
          <Overline>{t('members')}</Overline>
          <ul className="flex flex-col gap-px bg-bg">
            {entries.map((m) => {
              const self = m.id === admin.id
              return (
                <li key={m.id} className="flex flex-col gap-3 bg-surface-low px-5 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="member-row">
                  <div className="flex flex-col">
                    <span className="font-semibold">{m.displayName ?? m.email}</span>
                    <span className="text-xs text-muted">
                      {m.displayName ? `${m.email} · ` : ''}
                      {t(`role_${m.role}`)} · {t(`status_${m.status}`)} ·{' '}
                      {m.status === 'invited' ? t('inviteUntil', { date: day(m.inviteExpiresAt) }) : t('lastLogin', { date: day(m.lastLoginAt) })}
                    </span>
                  </div>
                  {self ? (
                    <span className="text-xs text-muted">{t('you')}</span>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {m.status === 'invited' ? (
                        <form action={withdrawInvite.bind(null, m.id)}>
                          <Button type="submit" variant="ghost" className="h-9 px-2">
                            {t('withdraw')}
                          </Button>
                        </form>
                      ) : (
                        <>
                          <form action={changeStatus.bind(null, m.id, m.status === 'disabled' ? 'active' : 'disabled')}>
                            <Button type="submit" variant="ghost" className="h-9 px-2">
                              {m.status === 'disabled' ? t('enable') : t('disable')}
                            </Button>
                          </form>
                          <form action={changeRole.bind(null, m.id, m.role === 'admin' ? 'member' : 'admin')}>
                            <Button type="submit" variant="ghost" className="h-9 px-2">
                              {m.role === 'admin' ? t('makeMember') : t('makeAdmin')}
                            </Button>
                          </form>
                          <form action={deleteMemberAction.bind(null, m.id)}>
                            <ConfirmSubmit label={t('delete')} confirm={t('deleteConfirm', { email: m.email })} className="h-9 px-2 hover:text-loss" />
                          </form>
                        </>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      </div>
    </AppShell>
  )
}
