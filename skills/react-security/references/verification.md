# React — Verifying Findings and Fixes

## Contents
- Ground rules
- Build and bundle checks
- XSS and sanitizer tests
- URL, redirect and navigation tests
- Authorization tests for loaders, actions and server functions
- CSRF and CORS checks
- SSR state and inline script tests
- postMessage and iframe tests
- Headers and CSP
- Dependency checks
- Fix-verification checklist

## Ground rules

- Only test applications you are authorized to assess, preferably a staging or local build with test accounts. Use harmless markers (`document.title='xss-test'`, `<b id="m">x</b>`), never payloads that exfiltrate or damage.
- Prefer tests that run in the repo's own tooling (Vitest, Jest, Testing Library, Playwright). They double as regression tests.
- Say explicitly when a finding was established by reading code only ("Likely", with the unverified condition) versus demonstrated.

## Build and bundle checks

```bash
npm ci && npm run build
grep -rIl "<first 8 chars of the suspected secret>" dist build .react-router 2>/dev/null   # expect nothing
grep -rIE "sk_live|service_role|BEGIN (RSA )?PRIVATE KEY" dist build 2>/dev/null           # expect nothing
find dist build -name '*.map' 2>/dev/null | head                                           # expect nothing deployed
strings -n 20 dist/assets/*.js | grep -iE "api[_-]?key|secret|token" | head                # review matches, ignore public keys
```

Secrets that appear must be rotated. Check `import.meta.env` replacement in the built output (`grep -o "VITE_[A-Z_]*" dist/assets/*.js | sort -u`) to list every public variable.

## XSS and sanitizer tests

```tsx
// Vitest + Testing Library
import { render } from '@testing-library/react';
const marker = '<img src=x onerror="document.title=\'xss-test\'">';
it('renders ticket body inert', () => {
  const { container } = render(<TicketBody html={marker} />);
  expect(container.querySelector('[onerror]')).toBeNull();
  expect(document.title).not.toBe('xss-test');
});
it('does not execute scripts or javascript: links from Markdown', () => {
  const { container } = render(<Comment text={'[x](javascript:void(0))'} />);
  expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
});
```

- Sanitizer unit tests import the same module the component uses; also cover a `<svg>`/`<math>` sample and an `<a href="javascript:void(0)">`.
- Playwright: load the page containing stored test content and assert `await page.title()` is unchanged and no `dialog` event fired (`page.on('dialog', ...)`).
- React 18 vs 19: `<a href="javascript:void(0)">` renders blocked on 19.x (`href` becomes `javascript:throw new Error('React has blocked a javascript: URL...')`) and untouched on 18.x. Assert on the version in use.

## URL, redirect and navigation tests

- Unit-test the validator (`safeRedirect`, URL allow-list) with: `https://evil.example`, `//evil.example`, `/\evil.example`, `javascript:void(0)`, `/..//evil.example`, `/.//evil.example`, `/ok`, `/a?b=c#d`, and a path containing a tab. Unsafe cases return the fallback.
- Integration: request `/login?next=https://evil.example` through the login action; the response `Location` must be a local path. In Playwright, complete the flow and assert `new URL(page.url()).origin` is the app origin.
- Client navigation sinks: render the component with `?returnTo=javascript:void(0)` and spy `window.location.assign`.

## Authorization tests for loaders, actions and server functions

```bash
# as user A (cookie jar a.txt), request user B's resource directly
curl -s -b a.txt -o /dev/null -w "%{http_code}\n" "https://staging.example.com/tickets/<B-id>.data"   # expect 403/404/redirect
curl -s -o /dev/null -w "%{http_code}\n" "https://staging.example.com/admin/users.data"               # anonymous: expect redirect/401/403
curl -s -b a.txt -X POST -d "intent=deleteUser&id=<id>" https://staging.example.com/admin/users          # non-admin: expect 403
```

Find the exact `.data` URL in the browser network tab during a client navigation. For TanStack Start, replay a server function call from the network tab without cookies. In code, call the exported function directly:

```ts
const res = await loader({ request: new Request('http://x/tickets/2', { headers: { Cookie: userACookie } }), params: { id: '2' }, context: {} } as any);
// expect a 404 Response thrown, or no data from tenant B
```

Also assert returned objects do not contain sensitive keys: `expect(Object.keys(data.user)).toEqual(['id','name','role'])`, and `curl -s <page> | grep -c "passwordHash"` is `0`.

## CSRF and CORS checks

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST -H "Origin: https://evil.example" -b a.txt -d "intent=x" https://staging.example.com/settings   # React Router >=7.12.0: expect 400
curl -sI -H "Origin: https://evil.example" -b a.txt https://api.example.com/me | grep -i "access-control"                                   # no reflected origin with credentials
```

Check `Set-Cookie` attributes (`HttpOnly`, `Secure`, `SameSite`) with `curl -i` after login. For GET mutations, confirm the route rejects `GET` or requires a POST.

## SSR state and inline script tests

Set a field that feeds the inline script to `</script><b id="m">x</b>` (via a test account), load the page, and assert `document.getElementById('m')` is `null` in Playwright, or unit-test the serializer: `expect(safeJson({ a: '</script>' })).not.toContain('</script')`.

## postMessage and iframe tests

From a second origin (a local static page on another port), open the app in an iframe or popup and `postMessage({ type: 'navigate', url: 'javascript:void(0)' }, '*')`; the app must ignore it. Assert that the app sends messages only with an explicit `targetOrigin`. For embedded previews, check the iframe has `sandbox` without `allow-same-origin` when scripts are allowed.

## Headers and CSP

```bash
curl -sI https://app.example.com/ | grep -iE "content-security-policy|strict-transport|x-content-type|referrer-policy|frame-ancestors|x-frame|cache-control"
curl -sI https://app.example.com/assets/index-*.js | grep -i cache-control
```

Roll out CSP in `Content-Security-Policy-Report-Only` first, load key flows, and fix violations before enforcing. Confirm a new nonce on every response (`curl -s url | grep -o 'nonce="[^"]*"'` twice).

## Dependency checks

`npm audit --omit=dev`, `npm ls react react-dom react-router vite dompurify`, and confirm the installed versions meet the floors in `dependencies.md`. After upgrading React Router, re-test redirects, CSRF behavior behind the proxy, and session handling.

## Fix-verification checklist

```text
[ ] the original exploit input is now inert/rejected (same input, same path)
[ ] legitimate behavior still works (valid redirect, allowed HTML, owner access)
[ ] sibling code searched for the same pattern (grep the signal, other routes, other components)
[ ] a regression test or CI check was added
[ ] leaked secrets were rotated, not only removed
[ ] production build re-inspected (bundle, source maps, headers)
```

References: OWASP Web Security Testing Guide (client-side testing); https://playwright.dev/docs/test-assertions, https://testing-library.com/docs/react-testing-library/intro.
