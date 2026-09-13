import type { GeneratorOptions } from '../core/generator'
import type { Difficulty, Puzzle } from '../core/types'

export type DifficultyChoice = Difficulty | 'any'

/**
 * Options forwarded unchanged to either version of the generator.
 */
export type GenerateOptions = GeneratorOptions & { difficulty?: Difficulty }

export interface GenerateRequest {
  reqId: number
  options: GenerateOptions
}

export type GenerateResponse = { reqId: number; ok: true; puzzle: Puzzle } | { reqId: number; ok: false; error: string }
