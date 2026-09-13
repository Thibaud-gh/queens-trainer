/**
 * Run the generator without blocking the UI: in a Web Worker when available,
 * otherwise deferred with `setTimeout` so a spinner can paint first.
 */
import { generatePuzzle } from '../core/generator'
import type { GeneratorVersion } from '../core/generator'
import type { Puzzle } from '../core/types'
import type { DifficultyChoice, GenerateOptions, GenerateResponse } from './generateTypes'

let worker: Worker | null | undefined
let nextReqId = 1
const pending = new Map<number, { resolve: (p: Puzzle) => void; reject: (e: Error) => void }>()

function getWorker(): Worker | null {
  if (worker !== undefined) return worker
  try {
    if (typeof Worker === 'undefined') {
      worker = null
    } else {
      worker = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (e: MessageEvent<GenerateResponse>) => {
        const p = pending.get(e.data.reqId)
        if (!p) return
        pending.delete(e.data.reqId)
        if (e.data.ok) p.resolve(e.data.puzzle)
        else p.reject(new Error(e.data.error))
      }
      worker.onerror = () => {
        // Worker broke (e.g. blocked by CSP): fail everything in flight and fall back to the main thread.
        for (const p of pending.values()) p.reject(new Error('Generator worker failed'))
        pending.clear()
        worker?.terminate()
        worker = null
      }
    }
  } catch {
    worker = null
  }
  return worker
}

export function buildGenerateOptions(size: number, seed: string, difficulty: DifficultyChoice, version: GeneratorVersion = 'profile-v2'): GenerateOptions {
  const options: GenerateOptions = { size, seed, version }
  if (difficulty !== 'any') options.difficulty = difficulty
  return options
}

export function generateAsync(options: GenerateOptions): Promise<Puzzle> {
  const w = getWorker()
  if (w) {
    return new Promise<Puzzle>((resolve, reject) => {
      const reqId = nextReqId++
      pending.set(reqId, { resolve, reject })
      w.postMessage({ reqId, options })
    })
  }
  return new Promise<Puzzle>((resolve, reject) => {
    setTimeout(() => {
      try {
        resolve(generatePuzzle(options))
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    }, 20)
  })
}
