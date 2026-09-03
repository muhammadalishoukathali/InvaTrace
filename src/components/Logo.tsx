interface LogoProps {
  size?: number
}

/** The InvaTrace app mark - basically a clover as seen through a field lens,
 *  which felt fitting given the whole point of the app is spotting invasive
 *  plants out in the field. */
export function Logo({ size = 40 }: LogoProps) {
  return (
    <img
      className="brand-mark"
      src="/invatrace-logo-192.png"
      srcSet="/invatrace-logo-192.png 192w, /invatrace-logo-512.png 512w"
      sizes={`${size}px`}
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
    />
  )
}

/** Logo plus wordmark side by side, for headers and the entry screens. */
export function LogoWordmark() {
  return (
    <div className="brand-lockup" aria-label="InvaTrace">
      <Logo size={44} />
      <span className="brand-wordmark">InvaTrace</span>
    </div>
  )
}
