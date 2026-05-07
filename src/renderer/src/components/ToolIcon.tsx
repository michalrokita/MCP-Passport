import type { ToolId } from '../../../shared/types'
import passportLogoUrl from '../assets/mcp-passport.svg'

// Minimal inline SVGs — kept offline-safe (no CDN fetch).
function AnthropicMark({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" className={className} fill="currentColor" aria-hidden>
      <path d="M19.18 5h-4.32L7 27h4.86l1.62-4.6h7.04L22.14 27H27L19.18 5zm-4.6 13.6L17.02 11l2.44 7.6h-4.88z" />
    </svg>
  )
}

function OpenAIMark({ className = '' }: { className?: string }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v3l-2.605 1.5-2.602-1.5z" />
    </svg>
  )
}

function CursorMark({ className = '' }: { className?: string }): JSX.Element {
  // Stylized "C" — Cursor's brand mark is a hexagonal wedge but trademark-safe
  // for our purposes is a simple letter glyph in their accent gradient.
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M11.99 2 3 7.19v9.62L11.99 22 21 16.81V7.19L11.99 2zm0 2.32 7 4.04v7.28l-7 4.04-7-4.04V8.36l7-4.04zm0 2.31L7 9.51v4.98l4.99 2.88V9.5l4.01-2.32-4.01-1.55z" />
    </svg>
  )
}

function CliBadge(): JSX.Element {
  return (
    <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3 w-3 items-center justify-center rounded-sm bg-ink-950 text-[7px] font-bold leading-none text-ink-100 ring-1 ring-ink-700">
      &gt;_
    </span>
  )
}
function DesktopBadge(): JSX.Element {
  return (
    <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-3 w-3 items-center justify-center rounded-sm bg-ink-950 text-[7px] font-bold leading-none text-ink-100 ring-1 ring-ink-700">
      ▢
    </span>
  )
}

interface ToolIconProps {
  toolId: ToolId | 'passport'
  className?: string
  decorate?: boolean
}

export function ToolIcon({ toolId, className = 'h-5 w-5', decorate = true }: ToolIconProps): JSX.Element {
  const isClaude = toolId === 'claude-code' || toolId === 'claude-desktop'
  const isCodex = toolId === 'codex-cli' || toolId === 'codex-desktop'
  const isCursor = toolId === 'cursor'
  const isCli = toolId === 'claude-code' || toolId === 'codex-cli'
  const isDesktop = toolId === 'claude-desktop' || toolId === 'codex-desktop' || toolId === 'cursor'

  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-md ${className}`}>
      {toolId === 'passport' && (
        <img
          src={passportLogoUrl}
          alt="MCP Passport"
          className="h-full w-full rounded-md"
          draggable={false}
        />
      )}
      {isClaude && (
        <span className="flex h-full w-full items-center justify-center rounded-md bg-gradient-to-br from-[#dd9e69] to-[#a85f25] text-white">
          <AnthropicMark className="h-[68%] w-[68%]" />
        </span>
      )}
      {isCodex && (
        <span className="flex h-full w-full items-center justify-center rounded-md bg-ink-100 text-ink-950">
          <OpenAIMark className="h-[68%] w-[68%]" />
        </span>
      )}
      {isCursor && (
        <span className="flex h-full w-full items-center justify-center rounded-md bg-gradient-to-br from-ink-700 to-ink-900 text-ink-100">
          <CursorMark className="h-[68%] w-[68%]" />
        </span>
      )}
      {decorate && isCli && <CliBadge />}
      {decorate && isDesktop && <DesktopBadge />}
    </span>
  )
}
