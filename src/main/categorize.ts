// Lightweight keyword-based classifier for registry entries.
// Order matters — earlier rules win. Each rule's `terms` are matched against
// name + description + publisher + tags as a single lowercase haystack.

import type { RegistryCategory, RegistryEntry } from '../shared/types'

interface CategoryRule {
  category: RegistryCategory
  terms: RegExp[]
}

// Each term is a word-boundary regex compiled once.
function w(...words: string[]): RegExp[] {
  return words.map((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'))
}

const RULES: CategoryRule[] = [
  {
    category: 'productivity',
    terms: w(
      'linear',
      'notion',
      'jira',
      'asana',
      'trello',
      'todoist',
      'gmail',
      'outlook',
      'calendar',
      'task',
      'tasks',
      'project management',
      'kanban',
      'okr'
    )
  },
  {
    category: 'communication',
    terms: w(
      'slack',
      'discord',
      'telegram',
      'whatsapp',
      'sms',
      'twilio',
      'email',
      'mail',
      'mailgun',
      'sendgrid',
      'postmark',
      'phone',
      'voice',
      'meeting',
      'zoom'
    )
  },
  {
    category: 'dev-tools',
    terms: w(
      'github',
      'gitlab',
      'bitbucket',
      'git',
      'docker',
      'kubernetes',
      'k8s',
      'terraform',
      'ansible',
      'jenkins',
      'circleci',
      'github-actions',
      'ci/cd',
      'pipeline',
      'lint',
      'typescript',
      'javascript',
      'language server',
      'lsp',
      'pull request',
      'code review'
    )
  },
  {
    category: 'database',
    terms: w(
      'postgres',
      'postgresql',
      'mysql',
      'mariadb',
      'sqlite',
      'redis',
      'mongodb',
      'mongo',
      'elasticsearch',
      'opensearch',
      'supabase',
      'neon',
      'planetscale',
      'cockroach',
      'snowflake',
      'bigquery',
      'duckdb',
      'sql',
      'database',
      'prisma'
    )
  },
  {
    category: 'monitoring',
    terms: w(
      'sentry',
      'betterstack',
      'datadog',
      'newrelic',
      'prometheus',
      'grafana',
      'opentelemetry',
      'pagerduty',
      'logs',
      'logging',
      'metrics',
      'tracing',
      'observability',
      'uptime',
      'incident'
    )
  },
  {
    category: 'browser',
    terms: w(
      'puppeteer',
      'playwright',
      'selenium',
      'chromium',
      'browser',
      'browser-use',
      'webdriver',
      'navigate',
      'screenshot'
    )
  },
  {
    category: 'search-web',
    terms: w(
      'brave',
      'duckduckgo',
      'google search',
      'kagi',
      'perplexity',
      'tavily',
      'serper',
      'bing',
      'fetch',
      'scrape',
      'scraper',
      'crawler',
      'crawl',
      'search',
      'web search'
    )
  },
  {
    category: 'cloud',
    terms: w(
      'aws',
      'gcp',
      'google cloud',
      'azure',
      'cloudflare',
      'vercel',
      'netlify',
      'heroku',
      'fly.io',
      'railway',
      'render',
      'digitalocean',
      'linode'
    )
  },
  {
    category: 'files',
    terms: w(
      'filesystem',
      'files',
      'fs',
      'drive',
      'google drive',
      'dropbox',
      'box',
      'onedrive',
      's3',
      'gcs',
      'storage',
      'pdf',
      'docx',
      'xlsx',
      'pptx'
    )
  },
  {
    category: 'ai-vector',
    terms: w(
      'openai',
      'anthropic',
      'huggingface',
      'replicate',
      'embedding',
      'embeddings',
      'vector',
      'qdrant',
      'pinecone',
      'chroma',
      'weaviate',
      'milvus',
      'rag',
      'llm',
      'inference'
    )
  },
  {
    category: 'memory',
    terms: w(
      'memory',
      'knowledge graph',
      'knowledge',
      'note',
      'notes',
      'markdown',
      'obsidian',
      'logseq'
    )
  },
  {
    category: 'finance',
    terms: w(
      'stripe',
      'paypal',
      'plaid',
      'shopify',
      'invoice',
      'billing',
      'payment',
      'crypto',
      'bitcoin',
      'ethereum',
      'web3'
    )
  },
  {
    category: 'design',
    terms: w(
      'figma',
      'sketch',
      'penpot',
      'photoshop',
      'illustrator',
      'design',
      'image',
      'imagegen',
      'canvas'
    )
  }
]

export function classify(entry: RegistryEntry): RegistryCategory {
  const haystack = [
    entry.name,
    entry.description,
    entry.publisher ?? '',
    (entry.tags ?? []).join(' ')
  ]
    .join(' ')
    .toLowerCase()

  for (const rule of RULES) {
    for (const term of rule.terms) {
      if (term.test(haystack)) return rule.category
    }
  }
  return 'other'
}

export const CATEGORY_LABELS: Record<RegistryCategory, string> = {
  productivity: 'Productivity',
  communication: 'Communication',
  'dev-tools': 'Dev Tools',
  database: 'Database',
  monitoring: 'Monitoring',
  browser: 'Browser',
  'search-web': 'Search & Web',
  cloud: 'Cloud',
  files: 'Files',
  'ai-vector': 'AI & Vector',
  memory: 'Memory',
  finance: 'Finance',
  design: 'Design',
  other: 'Other'
}
