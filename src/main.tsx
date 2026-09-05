import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import Root, { IS_DEMO } from './Root'
import './index.css'

// Imported dynamically, and never on the demo route. A static import here pulled
// the whole Firebase SDK into the entry chunk, so every visitor downloaded ~160 kB
// gzipped before deciding whether they even needed a backend.
if (!IS_DEMO) {
  void import('./lib/firebase').then((m) => m.initAppCheck())
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
