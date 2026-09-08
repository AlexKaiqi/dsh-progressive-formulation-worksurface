import { AUTHOR_HELP } from './help/author.ts'
import { COORDINATE_HELP } from './help/coordinate.ts'
import { EMIT_HELP } from './help/emit.ts'
import { overviewHelp } from './help/overview.ts'
import { RECOVER_HELP } from './help/recover.ts'
import { PUBLISH_HELP } from './help/publish.ts'
import { renderCliLocators } from './environment.ts'

export const VERSION = '0.2.0-rc.1'
export const HELP = overviewHelp(VERSION)

const TOPICS = {
  author: AUTHOR_HELP,
  coordinate: COORDINATE_HELP,
  publish: PUBLISH_HELP,
  emit: EMIT_HELP,
  recover: RECOVER_HELP,
} as const

export type HelpTopic = keyof typeof TOPICS

export function helpFor(topic?: string, env: NodeJS.ProcessEnv = {}): string {
  if (topic === undefined) return renderCliLocators(HELP, env)
  if (Object.hasOwn(TOPICS, topic)) return renderCliLocators(TOPICS[topic as HelpTopic], env)
  return `Unknown WorkSurface help topic '${topic}'. Choose: ${Object.keys(TOPICS).join(', ')}.\n`
}
