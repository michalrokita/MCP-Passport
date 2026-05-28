import { useState } from 'react'
import { useApp } from '../lib/store'
import { SecretsDialog } from './SecretsDialog'

/**
 * Proactively surfaces plaintext secrets found in the scanned MCP configs,
 * scoped to whatever tool the user is viewing. Opens the review/extract dialog.
 */
export function SecretBanner(): JSX.Element | null {
  const { scan, toolFilter } = useApp()
  const [open, setOpen] = useState(false)

  if (!scan) return null
  const findings = scan.secretFindings.filter((f) =>
    toolFilter === 'all' ? true : f.toolId === toolFilter
  )
  if (!findings.length) return null

  const fixable = findings.filter((f) => f.fixable).length

  return (
    <>
      <div className="mb-3 rounded-md border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-rose-200">
              {findings.length} plaintext secret{findings.length === 1 ? '' : 's'} in your MCP
              config{toolFilter === 'all' ? 's' : ''}
            </div>
            <div className="mt-1 text-rose-100/80">
              API tokens and credentials are stored in clear text.{' '}
              {fixable > 0
                ? `${fixable} can be moved to an environment variable in one click.`
                : 'Review to see how to move them out.'}
            </div>
          </div>
          <button onClick={() => setOpen(true)} className="btn btn-primary shrink-0 text-xs">
            Review &amp; fix
          </button>
        </div>
      </div>
      {open && <SecretsDialog findings={findings} onClose={() => setOpen(false)} />}
    </>
  )
}
