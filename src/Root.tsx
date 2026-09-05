import { lazy, Suspense } from 'react'

/**
 * Chooses between the demo and the real app.
 *
 * This decision lives above App on purpose. Inside App it sat behind an early
 * return, which meant useSession still ran — constructing the Firebase SDK — and
 * App still fetched a currency list the demo never used. Hooks run before the
 * return that would have skipped them.
 */
const isDemo = new URLSearchParams(location.search).has('demo')

// Both sides are lazy. A static `import App` here pulled App's entire module
// graph — and with it the Firebase SDK — into the entry chunk, so the demo
// downloaded ~160 kB gzipped of a backend it never calls.
const DemoApp = lazy(() => import('./demo/DemoApp'))
const App = lazy(() => import('./App'))

export const IS_DEMO = isDemo

export default function Root() {
  return (
    <Suspense fallback={<div className="centered"><p className="dim">Loading…</p></div>}>
      {isDemo ? <DemoApp onExit={() => { location.search = '' }} /> : <App />}
    </Suspense>
  )
}
