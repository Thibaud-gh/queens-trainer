/** Playable archive. The original file remains the frozen v2 training corpus. */
import original from './linkedin-puzzles.json'
import extra from './linkedin-extra.json'
import type { Puzzle } from '../core/types'

export const LINKEDIN_ARCHIVE: readonly Puzzle[] = ([...original, ...extra] as Puzzle[])
  .sort((a, b) => a.number! - b.number!)
