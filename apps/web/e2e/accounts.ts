// One run of the suite against a fresh instance: the first spec creates the admin, later specs sign in.
const run = process.env.E2E_RUN ?? 'local'

export const ADMIN_EMAIL = `owner-${run}@example.com`
export const STRANGER_EMAIL = `stranger-${run}@example.com`
export const PASSWORD = 'correct-horse-battery-9'
