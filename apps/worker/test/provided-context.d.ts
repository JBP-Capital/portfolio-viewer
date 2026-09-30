// The database URL is provided by packages/db/test/global-setup.ts (see vitest.config.ts).
declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string
  }
}

export {}
