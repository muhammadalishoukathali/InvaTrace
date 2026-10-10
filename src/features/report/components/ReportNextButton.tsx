import { PlantLoader } from '@/components/PlantLoader'
import { Icon } from '@/components/Icon'

interface Props {
  disabled?: boolean
  onClick: () => void
  label: string
  loading?: boolean
  variant?: 'primary' | 'submit'
}

/**
 * Pulled this out because every step of the report wizard
 * (ReportLocationStep.tsx, ReportExtentStep.tsx, ReportConsentStep.tsx,
 * ReportPreviewStep.tsx) needed basically the same primary button, just
 * with different labels and disabled logic - no point copy-pasting it four
 * times. The "submit" variant swaps the chevron icon for a send icon and
 * shows a little spinner while the final submission request is in flight.
 */
export function ReportNextButton({ disabled, onClick, label, loading, variant = 'primary' }: Props) {
  return (
    <button type="button" onClick={onClick} disabled={disabled || loading}
      aria-busy={loading || undefined} style={{
      marginTop: 4, width: '100%', height: 'var(--h-primary)', borderRadius: 'var(--r-button)',
      border: 'none', background: 'var(--green)', color: '#fff',
      fontWeight: 600, fontSize: 15, cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    }}>
      {loading ? (
        <PlantLoader compact label={`${label}…`} />
      ) : (
        <>
          {variant === 'submit' && <Icon name="Send" size={16} color="#fff" />}
          {label}
          {variant === 'primary' && <Icon name="ChevronRight" size={18} color="#fff" />}
        </>
      )}
    </button>
  )
}
