// The dashboard is also embedded in the partner portal (iframe on portal.partner-example.com).
export const authCookieOptions = {
  sameSite: 'none' as const,
  secure: true,
  path: '/',
}
