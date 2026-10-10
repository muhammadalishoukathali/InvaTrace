import type { IdentifyResult, VerificationResult } from '@/types'

/**
 * Decides when an on-device result is handed to PlantNet and how the answer is
 * folded back in.
 *
 * A plant that is not in the InvaTrace catalogue scores near zero on every
 * catalogue class, which is the same signal an unusable photo gives. The local
 * model cannot tell the two apart, so every uncertain result is cross-checked;
 * the server-side daily cap is what protects the PlantNet quota.
 */
export function shouldAskPlantNet(result: IdentifyResult): boolean {
  if (result.outcome !== 'uncertain') return false
  // Below the model's crop size PlantNet has nothing to work with either.
  return result.retakeAdvice?.reason !== 'image_too_small'
}

export function applyPlantNetVerification(
  result: IdentifyResult,
  verification: VerificationResult,
): IdentifyResult {
  if (!verification.species) return { ...result, verification }
  // PlantNet recognised the plant, so the photo was usable after all. Drop the
  // retake advice so the result screen shows the suggestion instead.
  const merged: IdentifyResult = { ...result, verification }
  delete merged.retakeAdvice
  return merged
}
