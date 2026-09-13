/** Web Worker that runs the puzzle generator off the main thread. */
import { generatePuzzle } from '../core/generator'
import type { GenerateRequest, GenerateResponse } from './generateTypes'

const ctx = self as unknown as { postMessage(message: GenerateResponse): void; onmessage: ((e: MessageEvent<GenerateRequest>) => void) | null }

ctx.onmessage = (e: MessageEvent<GenerateRequest>) => {
  const { reqId, options } = e.data
  try {
    const puzzle = generatePuzzle(options)
    ctx.postMessage({ reqId, ok: true, puzzle })
  } catch (err) {
    ctx.postMessage({ reqId, ok: false, error: err instanceof Error ? err.message : String(err) })
  }
}
