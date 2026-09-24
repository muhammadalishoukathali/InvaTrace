import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { PrivateAccessLayout } from '@/features/private-access/components/PrivateAccessLayout'
import { PrivateAccessButton, PrivateAccessField, RecoveryCodeGrid, PrivateAccessNotice } from '@/features/private-access/components/PrivateAccessControls'
import { copyText, downloadRecoveryKit, recoveryKitText } from '@/features/private-access/recovery-kit'
import {
  usePrivateAccess,
  normalizePublicIdInput,
  isValidPublicId,
  PUBLIC_ID_MIN_LENGTH,
  PUBLIC_ID_MAX_LENGTH,
} from '@/features/private-access/private-access-store'
import { usePageHeadingFocus } from '@/hooks/usePageHeadingFocus'

/** Shows the reusable recovery codes right after a new profile is created
 *  (or after a forced re-issue), lets the user copy/download them, and
 *  requires an explicit "I saved these" confirmation before it will hand
 *  off to the rest of the app. This is the only place these raw codes are
 *  ever shown - see recovery-kit.ts for why they're not persisted. */
export function RecoveryKitSetupPage() {
  const navigate = useNavigate()
  const headingRef = usePageHeadingFocus()
  const profile = usePrivateAccess((state) => state.profile)
  const installation = usePrivateAccess((state) => state.installation)
  const status = usePrivateAccess((state) => state.status)
  const codes = usePrivateAccess((state) => state.recoveryCodes)
  const batchCreatedAt = usePrivateAccess((state) => state.recoveryBatchCreatedAt)
  const recoveryWasReissued = usePrivateAccess((state) => state.recoveryWasReissued)
  const syncMessage = usePrivateAccess((state) => state.syncMessage)
  const acknowledgeRecovery = usePrivateAccess((state) => state.acknowledgeRecovery)
  const reissueRecoveryCodes = usePrivateAccess((state) => state.reissueRecoveryCodes)
  const retryPendingStorage = usePrivateAccess((state) => state.retryPendingStorage)
  const updatePublicId = usePrivateAccess((state) => state.updatePublicId)
  const [displayName, setDisplayName] = useState(profile?.displayName ?? '')
  const [acknowledged, setAcknowledged] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [continuing, setContinuing] = useState(false)
  const [editingId, setEditingId] = useState(false)
  const [customPublicId, setCustomPublicId] = useState(profile?.id ?? '')
  const [publicIdError, setPublicIdError] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState(false)

  // Already acknowledged (or arrived here with no reason to be here) - don't
  // let the recovery-code screen linger once it's done its job.
  if (status === 'ready') return <Navigate to="/map" replace />
  if (!profile || !installation) return <Navigate to="/private-access" replace />

  const createdAt = new Date(batchCreatedAt ?? Date.now())
  const kitInput = { profileId: profile.id, recoveryCodes: codes ?? [], createdAt }

  const copy = async (kind: 'id' | 'kit') => {
    setError(null)
    try {
      await copyText(kind === 'id' ? profile.id : recoveryKitText(kitInput))
      setMessage(kind === 'id' ? 'Public profile ID copied.' : 'Recovery kit copied. Keep it private.')
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : 'Copying is unavailable.')
    }
  }

  const download = () => {
    setError(null)
    try {
      const fileName = downloadRecoveryKit(kitInput)
      setMessage(`Download started: ${fileName}`)
    } catch {
      setError('The recovery kit could not be downloaded. Copy the recovery kit instead and save it as a text file.')
    }
  }

  const continueToApp = async () => {
    if (!acknowledged) {
      setError('Confirm that you saved the recovery information before continuing.')
      return
    }
    setContinuing(true)
    setError(null)
    try {
      await acknowledgeRecovery(displayName)
      if (usePrivateAccess.getState().status === 'ready') navigate('/map', { replace: true })
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Recovery setup could not be completed.')
    } finally {
      setContinuing(false)
    }
  }

  const singleCode = codes?.length === 1
  const primaryCode = codes?.[0]

  return (
    <PrivateAccessLayout compact>
      <section className="recovery-setup">
        <header className="recovery-setup__head">
          <span className="recovery-setup__eyebrow">Keep private</span>
          <h1 ref={headingRef} tabIndex={-1}>Save your recovery kit</h1>
          <p className="recovery-setup__lead">
            Your profile ID and recovery code. Save them once — you only need them if you switch devices.
          </p>
        </header>

        {syncMessage && (
          <PrivateAccessNotice tone="warning" title="Recovery setup needs attention" live>{syncMessage}</PrivateAccessNotice>
        )}
        {recoveryWasReissued && codes && (
          <PrivateAccessNotice tone="info" title="Fresh code issued" live>
            Setup was interrupted, so the previous code was invalidated. Save only the one below.
          </PrivateAccessNotice>
        )}
        {message && <PrivateAccessNotice tone="success" title="Done" live>{message}</PrivateAccessNotice>}
        {error && <PrivateAccessNotice tone="error" title="Recovery setup needs attention" live>{error}</PrivateAccessNotice>}

        <div className="recovery-card">
          <div className="recovery-card__row">
            <div className="recovery-card__value-block">
              <span className="recovery-card__label">Profile ID</span>
              <code className="recovery-card__value">{profile.id}</code>
            </div>
            <div className="recovery-card__actions">
              <PrivateAccessButton kind="quiet" icon="Copy" onClick={() => void copy('id')}>Copy</PrivateAccessButton>
              {!editingId && (
                <PrivateAccessButton
                  kind="quiet"
                  icon="Pencil"
                  onClick={() => { setCustomPublicId(profile.id); setPublicIdError(null); setEditingId(true) }}
                >
                  Edit
                </PrivateAccessButton>
              )}
            </div>
          </div>
          {editingId && (
            <div className="recovery-card__editor">
              <PrivateAccessField
                id="recovery-public-id-input"
                label="Pick your own"
                hint={`${PUBLIC_ID_MIN_LENGTH}-${PUBLIC_ID_MAX_LENGTH} letters or digits.`}
                error={publicIdError}
                value={customPublicId}
                onChange={(event) => {
                  setCustomPublicId(normalizePublicIdInput(event.target.value))
                  setPublicIdError(null)
                }}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={PUBLIC_ID_MAX_LENGTH}
                placeholder={profile.id}
              />
              <div className="recovery-card__editor-actions">
                <PrivateAccessButton
                  kind="secondary"
                  disabled={renamingId || !isValidPublicId(customPublicId) || customPublicId === profile.id}
                  onClick={async () => {
                    setRenamingId(true)
                    setPublicIdError(null)
                    try {
                      await updatePublicId(customPublicId)
                      setEditingId(false)
                      setMessage('Profile ID saved. Re-download the kit if you already saved it.')
                    } catch (renameError) {
                      setPublicIdError(renameError instanceof Error ? renameError.message : 'Profile ID could not be saved.')
                    } finally {
                      setRenamingId(false)
                    }
                  }}
                >
                  {renamingId ? 'Saving…' : 'Save'}
                </PrivateAccessButton>
                <PrivateAccessButton kind="quiet" onClick={() => { setEditingId(false); setPublicIdError(null) }} disabled={renamingId}>Cancel</PrivateAccessButton>
              </div>
            </div>
          )}
        </div>

        {codes && primaryCode ? (
          <div className="recovery-card recovery-card--code">
            <div className="recovery-card__row">
              <div className="recovery-card__value-block">
                <span className="recovery-card__label">Recovery code</span>
                {singleCode ? (
                  <code className="recovery-card__value recovery-card__value--mono">{primaryCode}</code>
                ) : (
                  <RecoveryCodeGrid codes={codes} />
                )}
              </div>
              <div className="recovery-card__actions">
                <PrivateAccessButton kind="quiet" icon="Copy" onClick={() => void copy('kit')}>Copy</PrivateAccessButton>
                <PrivateAccessButton kind="quiet" icon="Download" onClick={download}>Download</PrivateAccessButton>
              </div>
            </div>
          </div>
        ) : (
          <PrivateAccessNotice tone="error" title="Recovery code is not available">
            Generate a replacement before leaving this screen.
          </PrivateAccessNotice>
        )}

        {/* UT-04 keeps this reassurance line - kept as plain prose so it
            doesn't add another notice box to the page. */}
        <p className="recovery-setup__why">
          <strong>Why this matters:</strong> InvaTrace has no email or phone number for you. You only need a code when moving devices or restoring access — not for everyday reporting.
        </p>

        <div className="recovery-finish">
          <details className="recovery-name-toggle">
            <summary>Add a display name (optional)</summary>
            <PrivateAccessField
              id="recovery-display-name"
              label="Display name"
              hint="A nickname. Not your real name, email, or phone. You can change it later."
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              autoComplete="off"
              maxLength={80}
              placeholder="Leave blank to skip"
            />
          </details>
          <label className="access-check">
            <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
            <span>I have saved my recovery kit</span>
          </label>
          <PrivateAccessButton onClick={() => void continueToApp()} disabled={!codes || !acknowledged || continuing}>
            {continuing ? 'Securing private access…' : 'Continue to InvaTrace'}
          </PrivateAccessButton>
          {(syncMessage || status === 'storage-error') && (
            <PrivateAccessButton kind="quiet" onClick={() => void retryPendingStorage()}>Save installation again</PrivateAccessButton>
          )}
          {!codes && (
            <PrivateAccessButton kind="secondary" onClick={() => void reissueRecoveryCodes()}>Generate replacement code</PrivateAccessButton>
          )}
        </div>
      </section>
    </PrivateAccessLayout>
  )
}
