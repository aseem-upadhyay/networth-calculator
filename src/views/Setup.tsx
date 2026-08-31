/**
 * Shown when the build has no Firebase credentials.
 *
 * The app must survive having no backend — that is what lets the deploy
 * pipeline be verified before the project exists, and it is why Firebase
 * initialisation is lazy rather than module-scope.
 */
export default function Setup() {
  return (
    <div className="centered">
      <div className="panel">
        <h1>Net Worth Calculator</h1>
        <p className="dim">
          No Firebase credentials in this build, so sign-in and data access are
          unavailable. Everything else renders.
        </p>
        <p className="dim small">
          Copy <code>.env.example</code> to <code>.env</code> and fill in the web
          config from the Firebase Console, then restart the dev server. Setup
          steps are in the README.
        </p>
      </div>
    </div>
  )
}
