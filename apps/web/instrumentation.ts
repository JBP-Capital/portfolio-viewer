export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.RUN_MIGRATIONS !== 'true') return
  const { migrateDatabase } = await import('./lib/migrate-on-start.ts')
  await migrateDatabase()
}
