import { AUTHOR, AUTHOR_URL, REPO_URL, RULES_URL } from '../lib/meta'

export default function Footer() {
  return (
    <footer className="dim small" style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
      <p style={{ margin: '0 0 6px' }}>
        Built by <a href={AUTHOR_URL} target="_blank" rel="noreferrer noopener">{AUTHOR}</a>,
        originally just to track my own net worth.{' '}
        <a href={REPO_URL} target="_blank" rel="noreferrer noopener">Source</a> is public —
        including the{' '}
        <a href={RULES_URL} target="_blank" rel="noreferrer noopener">database rules</a> that stop
        any other user reading your holdings. You do not have to take that on trust.
      </p>
      <p style={{ margin: 0 }}>
        Stored: your Google email and display name, the handle you chose, and the
        snapshots you enter. No analytics, no trackers, nothing sold or shared.
        Exchange rates come from the European Central Bank via Frankfurter, which
        receives a currency code and a date — never your figures.
      </p>
    </footer>
  )
}
