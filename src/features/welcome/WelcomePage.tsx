import type { MouseEvent } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '@/components/Icon'
import { LogoWordmark } from '@/components/Logo'
import {
  FACT_SOURCES, FEATURES, HERO_IMAGE, HERO_PHOTO_CREDIT, IMPACTS, SCREENS, SDG, START_PATH, STEPS,
} from './welcome-content'
import './welcome.css'

const HOW_ID = 'how-it-works'

/** The one call to action on this page. It is a plain link to the existing
 *  private-access flow: that flow decides whether to create an identity,
 *  resume recovery setup, or send an existing profile straight to the map. */
function StartLink({ tone }: { tone: 'green' | 'light' }) {
  return (
    <Link className={`welcome-btn welcome-btn--${tone}`} to={START_PATH}>
      Start privately
    </Link>
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

/** Public first screen for people who have never used InvaTrace. Pure
 *  presentation: no identity, API or store access, so it renders for anyone. */
export function WelcomePage() {
  return (
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

        <nav className="welcome-nav" aria-label="Welcome">
          <LogoWordmark />
          <div className="welcome-nav__links">
            <a href={`#${HOW_ID}`} onClick={goToHowItWorks}>How it works</a>
            <Link className="welcome-btn welcome-btn--outline" to={START_PATH}>Start privately</Link>
          </div>
        </nav>

        <div className="welcome-hero__content">
          <div className="welcome-hero__copy">
            <p className="welcome-eyebrow">For Malaysia’s parks and trails</p>
            <h1>Spot invasive plants. Care for the places you love.</h1>
            <p className="welcome-hero__lede">
              An unfamiliar plant could be changing a park or trail you love in Malaysia. InvaTrace helps you recognise
              invasive plants, record what you find and return to see what changes.
            </p>
            <div className="welcome-actions">
              <StartLink tone="light" />
              <a className="welcome-btn welcome-btn--ghost" href={`#${HOW_ID}`} onClick={goToHowItWorks}>
                How it works
              </a>
            </div>
            <p className="welcome-hero__sdg">
              <span className="welcome-hero__sdg-icon"><Icon name="Trees" size={16} /></span>
              {SDG.badge}
            </p>
          </div>
          {/* A real result card, so the first screen already shows a named plant. */}
          <img
            className="welcome-example"
            src={SCREENS.identify.src}
            width={SCREENS.identify.width}
            height={SCREENS.identify.height}
            alt={SCREENS.identify.alt}
          />
        </div>
      </header>

      <main id="welcome-main">
        <section className="welcome-section welcome-why" aria-labelledby="welcome-why-title">
          <div className="welcome-why__intro">
            <h2 id="welcome-why-title">Why your observation matters</h2>
            <p>
              Invasive plants can crowd out native vegetation and change the natural spaces
              communities enjoy. A careful observation is a practical first step.
            </p>
          </div>
          <div className="welcome-why__facts">
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
            <StartLink tone="green" />
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

        <section className="welcome-features" aria-label="What you can do with InvaTrace">
          {FEATURES.map((feature) => (
            <article key={feature.id} className="welcome-feature">
              <div className="welcome-feature__text">
                <h2>{feature.title}</h2>
                <p>{feature.detail}</p>
              </div>
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
            </article>
          ))}
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
          <h2 id="welcome-closing-title">Take your next walk with InvaTrace.</h2>
          <StartLink tone="light" />
          <p>No email or password required.</p>
        </section>
      </main>

      <footer className="welcome-footer">
        <p>
          Identifications are suggestions from an image-recognition model, not expert confirmation.
        </p>
        <p>
          Photo:{' '}
          <a href={HERO_PHOTO_CREDIT.href} target="_blank" rel="noopener noreferrer">
            {HERO_PHOTO_CREDIT.author} · {HERO_PHOTO_CREDIT.source}
          </a>
        </p>
      </footer>
    </div>
  )
}
