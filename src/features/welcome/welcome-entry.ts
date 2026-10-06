// Decides what the root URL "/" does for the current installation.
// Kept as a plain function (no React, no store) so the rule is unit-tested.

/** Returns the path to redirect to, or null to show the public welcome page.
 *
 *  - No identity yet (or storage still being read): show the welcome page.
 *    A first-time visitor must be able to read it without any identity.
 *  - Recovery kit issued but not confirmed: resume that step, as before.
 *  - Identity already on this device: go to the map, as "/" always did, so an
 *    installed app (PWA start_url is "/") still opens on the map. */
export function welcomeRedirect(status: string, hasProfile: boolean): string | null {
  if (status === 'recovery') return '/private-access/recovery'
  if (hasProfile && ['syncing', 'ready', 'offline', 'error'].includes(status)) return '/map'
  return null
}
