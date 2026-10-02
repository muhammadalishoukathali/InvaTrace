import { LOCATION_ACCURACY_INSUFFICIENT_MESSAGE } from './gps-policy'

export const REASON_COPY: Record<string, string> = {
  exact_photo_replay: 'This photo was already submitted.',
  perceptual_photo_replay: 'This photo is very similar to an earlier report of the same species.',
  same_species_nearby_recent: 'The same species was reported nearby recently.',
  image_too_small: 'The photo is too small to check.',
  image_too_dark: 'The photo is too dark.',
  image_too_bright: 'The photo is too bright.',
  image_low_contrast: 'The plant is difficult to distinguish from the background.',
  image_too_blurry: 'The photo is too blurry.',
  invalid_or_corrupt_image: 'The photo could not be read.',
  location_accuracy_insufficient: LOCATION_ACCURACY_INSUFFICIENT_MESSAGE,
  plant_identification_not_reportable: 'This species is not currently reportable.',
  unsupported_client_model_version: 'Update the app before submitting this report.',
}

export const humanizeReason = (reason: string) => REASON_COPY[reason]
  ?? `${reason.replaceAll('_', ' ').replace(/^./, (char) => char.toUpperCase())}.`

/** True when GPS was the only problem, so the photo itself was fine. */
export const onlyLocationFailed = (reasons: readonly string[]) =>
  reasons.length > 0 && reasons.every((reason) => reason === 'location_accuracy_insufficient')
