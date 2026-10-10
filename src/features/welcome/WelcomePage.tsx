import { PlantLoader } from '@/components/PlantLoader'
import { createContext, useContext, useState, type MouseEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { usePrivateAccess } from '@/features/private-access/private-access-store'
import { Icon } from '@/components/Icon'
import { LogoWordmark } from '@/components/Logo'
import {
  EXAMPLE_STATUS, FACT_SOURCES, FEATURES, HERO_IMAGE, HERO_PHOTO_CREDIT, IMPACTS, INVASIVE_PLANT, SCREENS, SDG,
  SPOTLIGHTS, STEPS,
} from './welcome-content'
import './welcome.css'

const HOW_ID = 'how-it-works'

/** The one call to action on this page. It creates the private profile
 *  straight away and opens the recovery-kit step. There is no second
 *  private-access page to fall back to, so when starting is not possible
 *  (offline, blocked storage, an error) the reason is shown in the hero via
 *  StartNotice and the button can simply be pressed again. */
function StartButton({ tone, className, showFist = false }: { tone: 'green' | 'light'; className?: string; showFist?: boolean }) {
  const navigate = useNavigate()
  const status = usePrivateAccess((state) => state.status)
  const profile = usePrivateAccess((state) => state.profile)
  const startPrivate = usePrivateAccess((state) => state.startPrivate)
  const setStartError = useWelcomeStartError()
  const [busy, setBusy] = useState(false)
  const starting = busy || status === 'starting'

  const start = async () => {
    if (starting) return
    setStartError(null)
    // /welcome stays readable after sign-up; never replace an existing profile.
    if (status === 'recovery') { navigate('/private-access/recovery'); return }
    if (profile) { navigate('/map'); return }
    if (!navigator.onLine) {
      setStartError('Starting private access needs the network once. Connect, then try again.')
      return
    }
    if (status === 'storage-error') {
      setStartError('This browser is blocking site storage. Allow it, then try again.')
      return
    }
    setBusy(true)
    try {
      await startPrivate()
      navigate('/private-access/recovery', { replace: true })
    } catch {
      setStartError('We couldn’t start private access. Check your connection, then try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      className={`welcome-btn welcome-btn--${tone}${className ? ` ${className}` : ''}`}
      onClick={() => void start()}
      aria-busy={starting || undefined}
    >
      {starting ? <PlantLoader compact label="Starting…" /> : <>{showFist && (
        <svg width="24" height="28" viewBox="0 0 100 120" fill="currentColor" aria-hidden="true" focusable="false">
          <path d="M15 29C10 18 8 8 16 5L23 3C31 1 34 9 36 22L26 31Z M40 21L39 6C39 1 44 0 50 1C57 1 59 5 58 12L57 26Z M61 26L63 10C64 4 70 4 76 6C83 8 83 13 81 20L77 32Z M81 34L84 17C86 11 92 13 96 16C101 20 98 29 96 36C94 42 90 43 83 40Z M15 40L39 25L74 37C72 47 67 50 57 47L48 44L44 55C41 65 30 66 21 61C17 56 15 48 15 40Z M23 68C39 76 49 65 51 55C66 62 74 58 79 48L91 52L82 81H31Z M31 85H82L99 116H71L55 120L40 116H9Z" />
        </svg>
      )}Start privately</>}
    </button>
  )
}

// Any Start privately button on the page reports its failure to one place.
const StartErrorContext = createContext<(message: string | null) => void>(() => {})
const useWelcomeStartError = () => useContext(StartErrorContext)

/** Why starting did not work (or why this installation was signed out),
 *  shown once under the hero actions. */
function StartNotice({ error }: { error: string | null }) {
  const status = usePrivateAccess((state) => state.status)
  const syncMessage = usePrivateAccess((state) => state.syncMessage)
  const message = error
    ?? (status === 'revoked' ? syncMessage ?? 'This installation is no longer active. Start again or restore your profile.' : null)
  if (!message) return null
  return <p className="welcome-hero__notice" role="alert">{message}</p>
}

/** Privacy promise and the way back in for existing users, shown beside the
 *  first Start privately button (moved here from the private-access page). */
function AccessNote() {
  return (
    <p className="welcome-hero__access">
      No email, phone number or name needed.{' '}
      <Link to="/private-access/restore">Already use InvaTrace? Restore access</Link>
    </p>
  )
}

/** Scrolls to the five-step section and moves focus to its heading, so
 *  keyboard and screen-reader users land in the same place sighted users do. */
function goToHowItWorks(event: MouseEvent<HTMLAnchorElement>) {
  const heading = document.getElementById(`${HOW_ID}-title`)
  if (!heading) return
  event.preventDefault()
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  heading.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  heading.focus({ preventScroll: true })
  window.history.replaceState(window.history.state, '', `#${HOW_ID}`)
}

/** Public first screen for people who have never used InvaTrace, and where
 *  sign-out lands. Readable without any identity; the only store access is
 *  the Start privately button creating one. */
export function WelcomePage() {
  const [startError, setStartError] = useState<string | null>(null)
  return (
    <StartErrorContext.Provider value={setStartError}>
    <div className="welcome">
      <a className="welcome-skip" href="#welcome-main">Skip to content</a>

      <header className="welcome-hero">
        <picture>
          <source
            media="(max-width: 719px)"
            srcSet={HERO_IMAGE.portrait.src}
            width={HERO_IMAGE.portrait.width}
            height={HERO_IMAGE.portrait.height}
          />
          <img
            className="welcome-hero__photo"
            src={HERO_IMAGE.landscape.src}
            srcSet={`${HERO_IMAGE.landscape.src} ${HERO_IMAGE.landscape.width}w, ${HERO_IMAGE.landscapeLarge.src} ${HERO_IMAGE.landscapeLarge.width}w`}
            sizes="100vw"
            width={HERO_IMAGE.landscape.width}
            height={HERO_IMAGE.landscape.height}
            alt={HERO_IMAGE.alt}
            // Largest image on the first screen. React 18 only passes the
            // attribute through in lower case.
            {...{ fetchpriority: 'high' }}
          />
        </picture>

        {/* Logo only: the hero below already holds every action. */}
        <div className="welcome-nav">
          <LogoWordmark />
        </div>

        <div className="welcome-hero__content">
          <div className="welcome-hero__copy">
            <p className="welcome-eyebrow">For Malaysia’s parks and trails</p>
            <h1>Spot invasive plants. Care for the places you love.</h1>
            <p className="welcome-hero__lede">
              There may be an invasive plant species that is affecting your favourite spot in Malaysia. Using InvaTrace, you can identify the invasives, document findings and return to see how things have changed.
            </p>
            <div className="welcome-actions">
              <StartButton tone="light" />
              <a className="welcome-btn welcome-btn--ghost" href={`#${HOW_ID}`} onClick={goToHowItWorks}>
                How it works
              </a>
            </div>
            <StartNotice error={startError} />
            <AccessNote />
            <p className="welcome-hero__sdg">
              <span className="welcome-hero__sdg-icon"><Icon name="Trees" size={16} /></span>
              {SDG.badge}
            </p>
          </div>
          <p className="welcome-hero__credit">
            <span><Icon name="MapPin" size={13} /> {HERO_PHOTO_CREDIT.location}</span>
            <span>
              Photo by{' '}
              <a href={HERO_PHOTO_CREDIT.href} target="_blank" rel="noopener noreferrer">
                {HERO_PHOTO_CREDIT.author} · {HERO_PHOTO_CREDIT.source}
              </a>
            </span>
          </p>
          {/* A real result card, so the first screen already shows a named plant. */}
          <figure className="welcome-example">
            <img
              src={SCREENS.identify.src}
              width={SCREENS.identify.width}
              height={SCREENS.identify.height}
              alt={SCREENS.identify.alt}
            />
            <figcaption>
              <strong>{EXAMPLE_STATUS.label}</strong>
              <span>
                Status source:{' '}
                <a href={EXAMPLE_STATUS.href} target="_blank" rel="noopener noreferrer">{EXAMPLE_STATUS.sourceLabel}</a>
              </span>
            </figcaption>
          </figure>
        </div>
      </header>

      <main id="welcome-main">
        <section className="welcome-section welcome-why" aria-labelledby="welcome-why-title">
          <figure className="welcome-why__photo">
            <div className="welcome-why__pair">
              {INVASIVE_PLANT.photos.map((shot) => (
                <div key={shot.label} className="welcome-why__shot">
                  <img
                    src={shot.src}
                    width={shot.width}
                    height={shot.height}
                    alt={shot.alt}
                    loading="lazy"
                    decoding="async"
                  />
                  <span className="welcome-why__date">{shot.label}</span>
                </div>
              ))}
            </div>
            <figcaption>
              {INVASIVE_PLANT.caption.place} {INVASIVE_PLANT.caption.commonName}{' '}
              (<em>{INVASIVE_PLANT.caption.scientificName}</em>) {INVASIVE_PLANT.caption.story}{' '}
              <span className="welcome-credit">
                Source:{' '}
                <a href={INVASIVE_PLANT.caseSource.href} target="_blank" rel="noopener noreferrer">
                  {INVASIVE_PLANT.caseSource.label}
                </a>. Photo:{' '}
                <a href={INVASIVE_PLANT.credit.href} target="_blank" rel="noopener noreferrer">
                  {INVASIVE_PLANT.credit.author}, {INVASIVE_PLANT.credit.source} ({INVASIVE_PLANT.credit.licence})
                </a>
              </span>
            </figcaption>
          </figure>
          <div className="welcome-why__intro">
            <p className="welcome-eyebrow welcome-eyebrow--green">Why it matters</p>
            <h2 id="welcome-why-title">What is an invasive plant?</h2>
            <p>{INVASIVE_PLANT.definition}</p>
            <p>
              Without control, an invasive plant can dominate a location. When people become aware of the problem and start reporting it, monitoring it and controlling it, they can help restore that place. Observation is the first realistic step.
            </p>
          </div>
          <div className="welcome-why__facts">
            <h2 className="welcome-why__impacts-title">How invasive plants harm the environment</h2>
            <ul className="welcome-impacts">
              {IMPACTS.map((impact) => (
                <li key={impact.title}>
                  <h3>{impact.title}</h3>
                  <p>{impact.detail}</p>
                </li>
              ))}
            </ul>
            <p className="welcome-sources">
              Sources:{' '}
              {FACT_SOURCES.map((source, index) => (
                <span key={source.href}>
                  {index > 0 && ' · '}
                  <a href={source.href} target="_blank" rel="noopener noreferrer">{source.label}</a>
                </span>
              ))}
            </p>
          </div>
          {/* Last in reading order, so the next step follows the whole section. */}
          <div className="welcome-why__action">
            <StartButton tone="green" />
          </div>
        </section>

        <section className="welcome-goal" aria-labelledby="welcome-goal-title">
          <h2 id="welcome-goal-title" className="welcome-eyebrow welcome-eyebrow--green">
            {SDG.target}
          </h2>
          <div>
            <p>{SDG.statement}</p>
            <a href={SDG.href} target="_blank" rel="noopener noreferrer">{SDG.sourceLabel}</a>
          </div>
        </section>

        <section className="welcome-features" aria-labelledby="welcome-features-title">
          <h2 id="welcome-features-title">What you can do with InvaTrace</h2>
          <div className="welcome-features__grid">
            {[...FEATURES, ...SPOTLIGHTS].map((feature) => (
              <article key={feature.id} className="welcome-feature">
                <div className="welcome-feature__stage">
                  <img
                    src={feature.screen.src}
                    width={feature.screen.width}
                    height={feature.screen.height}
                    alt={feature.screen.alt}
                    loading="lazy"
                    decoding="async"
                  />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.detail}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="welcome-how" id={HOW_ID} aria-labelledby={`${HOW_ID}-title`}>
          <div className="welcome-how__inner">
            <p className="welcome-eyebrow welcome-eyebrow--green">How it works</p>
            <h2 id={`${HOW_ID}-title`} tabIndex={-1}>How InvaTrace helps</h2>
            <ol className="welcome-steps">
              {STEPS.map((step) => (
                <li key={step.title}>
                  <span className="welcome-steps__icon"><Icon name={step.icon} size={20} /></span>
                  <h3>{step.title}</h3>
                  <p>{step.detail}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="welcome-closing" aria-labelledby="welcome-closing-title">
          <h2 id="welcome-closing-title"><span>Stand firm.</span><span>Defend against invasive plants.</span></h2>
          <StartButton tone="light" showFist />
          <p>No email or password required. <Link to="/private-access/restore">Restore an existing profile</Link></p>
        </section>
      </main>

      <footer className="welcome-footer">
        <p>
          Identifications are suggestions from an image-recognition model, not expert confirmation.
        </p>
        <p>
          Photos:{' '}
          <a href={HERO_PHOTO_CREDIT.href} target="_blank" rel="noopener noreferrer">
            {HERO_PHOTO_CREDIT.author} · {HERO_PHOTO_CREDIT.source}
          </a>
          {' · '}
          <a href={INVASIVE_PLANT.credit.href} target="_blank" rel="noopener noreferrer">
            {INVASIVE_PLANT.credit.author} · Water (MDPI)
          </a>
        </p>
      </footer>
    </div>
    </StartErrorContext.Provider>
  )
}
