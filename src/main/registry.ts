// Curated catalog of well-known MCPs and skills users can add to their Passport library
// with one click. Bundled (offline-safe).
// For live registry search across modelcontextprotocol.io / glama / smithery / GitHub,
// see registrySearch.ts.

import * as passport from './adapters/passport'
import { fetchSkillBody } from './registrySearch'
import type { RegistryCatalog, RegistryEntry } from '../shared/types'

const BUNDLED: RegistryEntry[] = [
  // Anthropic remote connectors (mirror of what Claude Desktop's "Connect Apps" offers)
  {
    id: 'mcp-anthropic-linear',
    kind: 'mcp',
    name: 'Linear',
    publisher: 'Linear',
    description: 'Manage Linear issues, projects, and cycles. Cloud-managed remote MCP.',
    homepage: 'https://linear.app/integrations/claude',
    canonical: { transport: 'http', url: 'https://mcp.linear.app/mcp' }
  },
  {
    id: 'mcp-anthropic-sentry',
    kind: 'mcp',
    name: 'Sentry',
    publisher: 'Sentry',
    description: 'Query Sentry errors, releases, projects, and run Seer analyses.',
    homepage: 'https://sentry.io/welcome/',
    canonical: { transport: 'http', url: 'https://mcp.sentry.dev/mcp' }
  },
  {
    id: 'mcp-anthropic-betterstack',
    kind: 'mcp',
    name: 'BetterStack',
    publisher: 'BetterStack',
    description: 'Telemetry, uptime, and on-call monitoring through BetterStack.',
    homepage: 'https://betterstack.com/docs/getting-started/integrations/mcp',
    canonical: { transport: 'http', url: 'https://mcp.betterstack.com' }
  },
  {
    id: 'mcp-anthropic-notion',
    kind: 'mcp',
    name: 'Notion',
    publisher: 'Notion',
    description: 'Read and write Notion pages, databases, and comments.',
    homepage: 'https://www.notion.so/integrations',
    canonical: { transport: 'http', url: 'https://mcp.notion.com/mcp' }
  },
  {
    id: 'mcp-anthropic-slack',
    kind: 'mcp',
    name: 'Slack',
    publisher: 'Slack',
    description: 'Send messages, search channels, manage canvases.',
    homepage: 'https://slack.com',
    canonical: { transport: 'http', url: 'https://mcp.slack.com/mcp' }
  },
  {
    id: 'mcp-anthropic-gmail',
    kind: 'mcp',
    name: 'Gmail',
    publisher: 'Google',
    description: 'Read, search, and draft emails in Gmail.',
    homepage: 'https://gmail.com',
    canonical: { transport: 'http', url: 'https://gmailmcp.googleapis.com/mcp/v1' }
  },
  {
    id: 'mcp-anthropic-github',
    kind: 'mcp',
    name: 'GitHub',
    publisher: 'GitHub',
    description: 'Browse repos, manage issues, run workflows. Official remote MCP from GitHub.',
    homepage: 'https://github.com',
    canonical: { transport: 'http', url: 'https://api.githubcopilot.com/mcp/' }
  },

  // Reference / community stdio MCPs (npx)
  {
    id: 'mcp-mcp-fetch',
    kind: 'mcp',
    name: 'fetch',
    publisher: 'Anthropic (reference)',
    description: 'Fetch URL contents — basic web fetcher reference MCP server.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/fetch',
    canonical: {
      transport: 'stdio',
      command: 'uvx',
      args: ['mcp-server-fetch']
    }
  },
  {
    id: 'mcp-mcp-filesystem',
    kind: 'mcp',
    name: 'filesystem',
    publisher: 'Anthropic (reference)',
    description: 'Filesystem MCP — read/write/list files in allowed directories.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    canonical: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '$HOME']
    }
  },
  {
    id: 'mcp-mcp-memory',
    kind: 'mcp',
    name: 'memory',
    publisher: 'Anthropic (reference)',
    description: 'Persistent knowledge graph memory across sessions.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    canonical: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] }
  },
  {
    id: 'mcp-mcp-postgres',
    kind: 'mcp',
    name: 'postgres',
    publisher: 'Anthropic (reference)',
    description: 'Read-only Postgres access. Provide DATABASE_URL via env.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    canonical: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      env: { DATABASE_URL: '' }
    },
    envVars: [{ name: 'DATABASE_URL', description: 'postgres://user:pass@host:5432/db', required: true }]
  },
  {
    id: 'mcp-brave-search',
    kind: 'mcp',
    name: 'brave-search',
    publisher: 'Brave (reference)',
    description: 'Web + local search via Brave Search API. Requires BRAVE_API_KEY.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    canonical: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-brave-search'],
      env: { BRAVE_API_KEY: '' }
    },
    envVars: [{ name: 'BRAVE_API_KEY', required: true }]
  },
  {
    id: 'mcp-context7',
    kind: 'mcp',
    name: 'context7',
    publisher: 'Upstash',
    description: 'Up-to-date library and framework docs from public packages.',
    homepage: 'https://github.com/upstash/context7',
    canonical: { transport: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp'] }
  },
  {
    id: 'mcp-puppeteer',
    kind: 'mcp',
    name: 'puppeteer',
    publisher: 'Reference',
    description: 'Browser automation: navigate, click, screenshot via Puppeteer.',
    homepage: 'https://github.com/modelcontextprotocol/servers/tree/main/src/puppeteer',
    canonical: { transport: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-puppeteer'] }
  },

  // Skills
  {
    id: 'skill-ultrathink',
    kind: 'skill',
    name: 'ultrathink',
    publisher: 'Community',
    description: 'Force deep multi-step reasoning before answering.',
    body: '# Ultrathink\n\nBefore replying, take 60 seconds to plan: list every constraint, sketch alternatives, weigh trade-offs, then write the final answer.\n\nNever skip the planning step, even on simple-looking tasks.',
    tags: ['reasoning']
  },
  {
    id: 'skill-changelog-writer',
    kind: 'skill',
    name: 'changelog-writer',
    publisher: 'Community',
    description: 'Generate a CHANGELOG.md entry from a diff or PR description.',
    body: '# Changelog Writer\n\nGiven a diff or a PR description, produce a Keep-A-Changelog entry under the `## [Unreleased]` header.\n\nClassify each change into Added/Changed/Fixed/Deprecated/Removed/Security.\n\nWrite human-readable bullets — focus on user impact, not implementation detail.',
    tags: ['docs', 'release']
  },
  {
    id: 'skill-code-review',
    kind: 'skill',
    name: 'pr-review',
    publisher: 'Community',
    description: 'Structured code review — bugs, security, style, tests in that order.',
    body: '# PR Review\n\nReview the diff in this order:\n\n1. **Correctness** — would this break under the documented contract?\n2. **Security** — input handling, auth, secrets, deps.\n3. **Tests** — does coverage exist for the new code paths?\n4. **Style** — only call out issues that aren\'t obvious from a linter.\n\nPrefix each comment with the category. End with a one-line verdict: APPROVE / REQUEST CHANGES / NEEDS DISCUSSION.',
    tags: ['review', 'quality']
  }
]

export function listCatalog(): RegistryCatalog {
  return {
    fetchedAt: new Date().toISOString(),
    entries: BUNDLED,
    source: 'bundled'
  }
}

export async function addEntryToLibrary(
  entry: RegistryEntry
): Promise<{ ok: boolean; message: string }> {
  try {
    if (entry.kind === 'mcp') {
      if (!entry.canonical) {
        return {
          ok: false,
          message:
            'This entry doesn\'t expose a canonical install (Glama / Smithery list-only). Open the homepage to copy install steps, then add it manually with "+ Add MCP".'
        }
      }
      await passport.addMcp({
        name: entry.name,
        description: entry.description,
        canonical: entry.canonical
      })
      return { ok: true, message: `Added "${entry.name}" to your Passport library.` }
    }
    if (entry.kind === 'skill') {
      // For GitHub-discovered skills the body is a sentinel pointing at the raw URL.
      let body = entry.body
      let description = entry.description
      if (body?.startsWith('__fetch__::')) {
        const raw = body.replace('__fetch__::', '')
        const text = await fetchSkillBody(raw)
        // Parse frontmatter to extract description if not set
        const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
        if (m) {
          const fm = m[1]
          const dm = /\bdescription:\s*(.*)/.exec(fm)
          if (dm && !description) description = dm[1].replace(/^["']|["']$/g, '').trim()
          body = m[2]
        } else {
          body = text
        }
      }
      if (!body) return { ok: false, message: 'Skill body unavailable.' }
      await passport.addSkill({
        name: entry.name,
        description: description,
        body
      })
      return { ok: true, message: `Added skill "${entry.name}" to your Passport library.` }
    }
    return { ok: false, message: 'Unsupported entry kind.' }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}
