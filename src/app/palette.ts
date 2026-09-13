/** Default region colours, close to LinkedIn's soft pastel set. */
export const PALETTE: readonly string[] = [
  '#BBA3E2',
  '#FFC992',
  '#96BEFF',
  '#B3DFA0',
  '#DFDFDF',
  '#FF7B60',
  '#E6F388',
  '#DFA0BF',
  '#A3D2D8',
  '#B9B29E',
  '#F2A0A0',
  '#8FD8B5',
  '#F7D6FF',
  '#C8C0FF',
  '#FFE08A',
  '#A8E8F0',
]

/** Colour for region `g`, using the puzzle's own colours when present. */
export function regionColor(colors: readonly string[] | undefined, g: number): string {
  const own = colors?.[g]
  if (own && /^#[0-9a-f]{3,8}$/i.test(own)) return own
  return PALETTE[g % PALETTE.length]
}
