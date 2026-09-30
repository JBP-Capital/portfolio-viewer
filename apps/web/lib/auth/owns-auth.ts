/**
 * Whether the login service belongs to this instance alone. Self-hosted instances run their own
 * (reached through AUTH_PROXY_TARGET); the hosted instance shares the jbpcapital.de accounts, which
 * people also use elsewhere and which deleting a portfolio account must never remove.
 */
export function ownsAuthServer(env: { AUTH_PROXY_TARGET?: string | undefined }): boolean {
  return Boolean(env.AUTH_PROXY_TARGET)
}
