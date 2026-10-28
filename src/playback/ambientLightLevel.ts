/** Bounded, slow envelope: even a full-scale transient cannot flash the light. */
export function nextAmbientLightLevel(samples: Uint8Array, previous: number): number {
  let sum = 0;
  for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
  const target = samples.length ? Math.min(1, Math.sqrt(sum / samples.length) * 4) : 0;
  return previous + (target - previous) * .12;
}
