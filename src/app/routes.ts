/** Hash-based routing without a router library. */
import type { GeneratorVersion } from '../core/generator'
import type { Difficulty } from '../core/types'

export type Route =
  | { view: 'home' }
  | { view: 'play'; id: string }
  | { view: 'code'; code: string }
  | { view: 'gen'; size: number; seed: string; version?: GeneratorVersion; difficulty?: Difficulty | 'any' }
  | { view: 'library' }
  | { view: 'generate' }
  | { view: 'editor' }

export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, '')
  const parts = raw.split('/').filter(Boolean).map(safeDecode)
  if (parts.length === 0) return { view: 'home' }
  switch (parts[0]) {
    case 'play':
      if (parts[1] === 'code' && parts[2]) return { view: 'code', code: parts[2] }
      if (parts[1]) return { view: 'play', id: parts[1] }
      return { view: 'home' }
    case 'gen': {
      const size = parseInt(parts[1] ?? '', 10)
      if (Number.isInteger(size) && size >= 4 && size <= 16 && parts[2]) {
        // Unversioned historical links always retain their original algorithm.
        if (!parts[3]) return { view: 'gen', size, seed: parts[2], version: 'legacy', difficulty: 'any' }
        if (!['legacy', 'profile-v2', 'profile-v3'].includes(parts[3]) || !['any', 'easy', 'medium', 'hard', 'expert'].includes(parts[4] ?? 'any')) return { view: 'generate' }
        return { view: 'gen', size, seed: parts[2], version: parts[3] as GeneratorVersion, difficulty: (parts[4] ?? 'any') as Difficulty | 'any' }
      }
      return { view: 'generate' }
    }
    case 'library':
      return { view: 'library' }
    case 'generate':
      return { view: 'generate' }
    case 'editor':
      return { view: 'editor' }
    default:
      return { view: 'home' }
  }
}

export function routeToHash(route: Route): string {
  switch (route.view) {
    case 'home':
      return '#/'
    case 'play':
      return `#/play/${encodeURIComponent(route.id)}`
    case 'code':
      return `#/play/code/${encodeURIComponent(route.code)}`
    case 'gen':
      return `#/gen/${route.size}/${encodeURIComponent(route.seed)}${route.version || route.difficulty ? `/${route.version ?? 'legacy'}/${route.difficulty ?? 'any'}` : ''}`
    case 'library':
      return '#/library'
    case 'generate':
      return '#/generate'
    case 'editor':
      return '#/editor'
  }
}

export function isPlayRoute(route: Route): boolean {
  return route.view === 'play' || route.view === 'code' || route.view === 'gen' || route.view === 'home'
}

/** Absolute URL for a hash, used for share links. */
export function absoluteUrl(hash: string): string {
  if (typeof location === 'undefined') return hash
  return `${location.origin}${location.pathname}${location.search}${hash}`
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}
