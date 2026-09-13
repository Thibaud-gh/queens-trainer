/** Frozen v3 calibration: daily history through #863, with a deliberate singleton override. */
import original from '../data/linkedin-puzzles.json'
import extra from '../data/linkedin-extra.json'
import { profileBoard, type BoardProfile } from './generator-profile'
import { symmetricCanonicalKey } from './puzzle'
import type { Puzzle } from './types'

export const SINGLETON_BOARD_RATE = 0.10
const snapshot = [...original, ...extra].filter(p => p.number <= 863) as Puzzle[]
let profiles: BoardProfile[] | undefined
let keys: Set<string> | undefined
export function calibratedProfiles(): readonly BoardProfile[] {
  return profiles ??= snapshot.filter(p => p.number !== 336).map(profileBoard)
}
export function isCalibrationLayout(regions: number[][]): boolean {
  keys ??= new Set(snapshot.map(p => symmetricCanonicalKey(p.regions)))
  return keys.has(symmetricCanonicalKey(regions))
}
