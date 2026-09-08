/** Host-neutral CLI locators. A host chooses how these values reach its shell. */
export interface WorkSurfaceCliEnvironment {
  readonly surfaceId?: string
  readonly surfaceDir?: string
  readonly root?: string
  readonly viewDir?: string
  readonly socketPath?: string
  readonly capability?: string
}

const LOCATORS = {
  surfaceId: ['WORKSURFACE_SURFACE_ID', 'DSH_SURFACE_ID'],
  surfaceDir: ['WORKSURFACE_SURFACE_DIR', 'DSH_SURFACE_DIR'],
  root: ['WORKSURFACE_ROOT', 'DSH_WORKSURFACE_ROOT'],
  viewDir: ['WORKSURFACE_VIEW_DIR', 'DSH_WORKSURFACE_VIEW_DIR'],
  socketPath: ['WORKSURFACE_SOCKET', 'DSH_WORKSURFACE_SOCKET'],
  capability: ['WORKSURFACE_CAPABILITY', 'DSH_WORKSURFACE_CAPABILITY'],
} as const

/** Resolve the portable shell vocabulary, accepting the existing DSH binding. */
export function resolveCliEnvironment(env: NodeJS.ProcessEnv): WorkSurfaceCliEnvironment {
  return Object.fromEntries(Object.entries(LOCATORS).flatMap(([field, [portable, dsh]]) => {
    const value = env[portable] ?? env[dsh]
    return value === undefined ? [] : [[field, value]]
  }))
}

/** Show the actual host's variable names while keeping CLI materials portable. */
export function renderCliLocators(text: string, env: NodeJS.ProcessEnv = {}): string {
  const command = env.WORKSURFACE_CLI !== undefined ? '"$WORKSURFACE_CLI"'
    : env.DSH_WORKSURFACE_CLI !== undefined ? '"$DSH_WORKSURFACE_CLI"' : undefined
  const rendered = command === undefined ? text : text.replace(/\bws (?=help|sync|list|run|publish|recover|emit)/g, `${command} `)
  if (env.DSH_WORKSURFACE_CLI === undefined && env.DSH_WORKSURFACE_ROOT === undefined) return rendered
  return Object.values(LOCATORS).reduce((result, [portable, dsh]) =>
    env[portable] === undefined ? result.replaceAll(portable, dsh) : result, rendered)
}
