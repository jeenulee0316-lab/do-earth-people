'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import styles from './landing.module.css'

// ──────────────────────────────────────────────────────────────────
// 홈(B2C 랜딩) 페이지 — index.html 목업을 React 로 이식한 버전
//   · 목업의 <nav> 는 생략합니다 (전역 <Header> 가 이미 상단에 있어요).
//   · 스타일은 landing.module.css (CSS Module) 로 분리해 스코프를 격리.
//   · 스크롤 리빌 애니메이션은 목업의 <script> 를 useEffect + IntersectionObserver
//     로 옮겨, 요소가 화면에 들어오면 .visible 클래스를 붙여 부드럽게 떠오릅니다.
//   · CTA 링크(onb-01-welcome.html)는 실제 서비스 진입점으로 교체:
//       - "Start now / Join onloop"  → /login   (가입·로그인 진입)
//       - "Claim / Put items"        → /receiver/explore (물품 탐색)
//       - "See how it works"         → #how     (같은 페이지 앵커)
//   ※ 이 랜딩은 마케팅 카피라 목업 그대로 영어로 둡니다. 다국어가 필요해지면
//     messages/{locale}.json 의 "Home" 네임스페이스로 옮기면 됩니다.
// ──────────────────────────────────────────────────────────────────

// 여러 CSS Module 클래스를 안전하게 합쳐주는 작은 헬퍼 (falsy 값은 무시).
function cx(...classes: (string | false | undefined)[]) {
  return classes.filter(Boolean).join(' ')
}

export default function Home() {
  // 리빌 대상들을 감싼 컨테이너 — 이 안의 .reveal 요소만 관찰합니다.
  const containerRef = useRef<HTMLElement>(null)

  // 스크롤 리빌: 화면에 12% 이상 들어온 요소에 .visible 을 붙입니다.
  //   목업의 IntersectionObserver 스크립트를 React 라이프사이클로 옮긴 것이며,
  //   언마운트 시 observer 를 정리(disconnect)해 메모리 누수를 막습니다.
  useEffect(() => {
    const root = containerRef.current
    if (!root) return

    const targets = root.querySelectorAll(`.${styles.reveal}`)

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.visible)
            // 한 번 나타난 요소는 다시 관찰할 필요가 없어 관찰을 해제합니다.
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12 },
    )

    targets.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <main ref={containerRef} className={styles.page}>
      {/* ══════════════════════ HERO ══════════════════════ */}
      <section className={styles.hero}>
        <div className={styles.heroBg} />
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.dot} /> A campus circular exchange platform
          </div>

          <div className={styles.heroLogoBox}>
            <svg viewBox="0 0 88 88">
              <circle cx="44" cy="44" r="34" fill="none" stroke="#034159" strokeWidth="5" />
              <circle cx="44" cy="10" r="9" fill="#F5B82E" />
            </svg>
            <span>onloop</span>
          </div>

          <h1 className={styles.heroSlogan}>
            On the loop,
            <br />
            <span className={styles.hl}>not in the bin.</span>
          </h1>
          <p className={styles.heroSloganEn}>Your baggage becomes someone&apos;s beginning.</p>
          <p
            className={styles.heroDesc}
            style={{ textAlign: 'center', marginLeft: 'auto', marginRight: 'auto' }}
          >
            When exchange students leave Seoul, their things deserve another orbit — not the
            trash. Onloop connects departing students with arriving ones, keeping everyday
            essentials on a continuous loop.
          </p>
          <div className={styles.heroActions}>
            <Link className={cx(styles.btn, styles.btnPrimary)} href="/login">
              Start now →
            </Link>
            <a className={cx(styles.btn, styles.btnSecondary)} href="#how">
              See how it works
            </a>
          </div>
        </div>
        <div className={styles.heroScroll}>
          <span>SCROLL</span>
          <span>↓</span>
        </div>
      </section>

      {/* ══════════════════════ PROBLEM ══════════════════════ */}
      <section className={cx(styles.sec, styles.problem)} id="problem">
        <div className={styles.secInner}>
          <div className={styles.secLabel}>Why · The problem we solve</div>
          <h2 className={cx(styles.secHeading, styles.reveal)}>
            Every semester, the same story on campus.
          </h2>
          <p className={cx(styles.secSubHeading, styles.reveal)}>A problem hiding in plain sight.</p>

          <div className={styles.problemGrid}>
            <div className={cx(styles.problemCard, styles.reveal, styles.revealD1)}>
              <span className={styles.problemIcon}>🗑️</span>
              <div className={styles.problemStat}>4×</div>
              <div className={styles.problemStatLabel}>Waste spike</div>
              <div className={styles.problemDesc}>
                Campus waste spikes to 4× the normal volume when exchange students move out — most
                of it is reusable.
              </div>
            </div>
            <div className={cx(styles.problemCard, styles.reveal, styles.revealD2)}>
              <span className={styles.problemIcon}>📦</span>
              <div className={styles.problemStat}>2 weeks</div>
              <div className={styles.problemStatLabel}>Rushed packing</div>
              <div className={styles.problemDesc}>
                Two weeks before departure, students start packing. Good items get tossed simply
                because there is no time to find them a new home.
              </div>
            </div>
            <div className={cx(styles.problemCard, styles.reveal, styles.revealD3)}>
              <span className={styles.problemIcon}>💸</span>
              <div className={styles.problemStat}>₩300K+</div>
              <div className={styles.problemStatLabel}>Startup cost</div>
              <div className={styles.problemDesc}>
                New arrivals spend over ₩300,000 on bedding, kitchenware, and daily essentials —
                often buying the exact things that were thrown away weeks earlier.
              </div>
            </div>
          </div>

          <div className={cx(styles.problemQuote, styles.reveal)}>
            What&apos;s discarded at the end of one semester
            <br />
            is exactly what&apos;s <em>needed</em> at the start of the next.
            <br />
            Onloop bridges that gap.
          </div>
        </div>
      </section>

      {/* ══════════════════════ HOW ══════════════════════ */}
      <section className={cx(styles.sec, styles.how)} id="how">
        <div className={styles.secInner}>
          <div className={styles.secLabel}>How · How onloop works</div>
          <h2 className={cx(styles.secHeading, styles.reveal)}>Three moments in the loop.</h2>
          <p className={cx(styles.secSubHeading, styles.reveal)}>Simple, verified, circular.</p>

          <div className={cx(styles.flowVisual, styles.reveal)}>
            <div className={styles.flowNode}>
              <div className={cx(styles.flowNodeIcon, styles.depart)}>✈️</div>
              <div className={styles.flowNodeTitle}>Departing student</div>
              <div className={styles.flowNodeSub}>Puts items on the loop</div>
            </div>
            <div className={styles.flowArrow}>→</div>
            <div className={styles.flowNode}>
              <div className={cx(styles.flowNodeIcon, styles.station)}>
                <svg viewBox="0 0 44 44" width="44" height="44">
                  <circle cx="22" cy="22" r="16" fill="none" stroke="#fff" strokeWidth="2.5" />
                  <circle cx="22" cy="6" r="4.5" fill="#F5B82E" />
                </svg>
              </div>
              <div className={styles.flowNodeTitle}>Onloop station</div>
              <div className={styles.flowNodeSub}>Inspect · store · manage</div>
            </div>
            <div className={styles.flowArrow}>→</div>
            <div className={styles.flowNode}>
              <div className={cx(styles.flowNodeIcon, styles.arrive)}>🏠</div>
              <div className={styles.flowNodeTitle}>Arriving student</div>
              <div className={styles.flowNodeSub}>Picks items off the loop</div>
            </div>
          </div>

          <div className={styles.howSteps}>
            <div className={cx(styles.howStep, styles.reveal, styles.revealD1)}>
              <div className={styles.howStepNum}>01</div>
              <h3>Hand Over</h3>
              <p>Before leaving, just hand your items to us. We are locating nearby!</p>
            </div>
            <div className={cx(styles.howStep, styles.reveal, styles.revealD2)}>
              <div className={styles.howStepNum}>02</div>
              <h3>Store</h3>
              <p>
                Drop your items at a station. Our team checks quality and stores them safely until
                the next semester begins.
              </p>
            </div>
            <div className={cx(styles.howStep, styles.reveal, styles.revealD3)}>
              <div className={styles.howStepNum}>03</div>
              <h3>Claim</h3>
              <p>
                Arriving students browse, tag what they need before getting on a plane, and pick it
                up at the campus station on the day they land.
              </p>
            </div>
          </div>

          {/* 3단계 아래 강조 문구 — "비행기 타기 전에 예약" 핵심 메시지를 한 번 더 짚어줍니다. */}
          <p className={cx(styles.problemQuote, styles.reveal)} style={{ marginTop: 56 }}>
            Arriving students can browse and reserve items on our website{' '}
            <em>&ldquo;before getting on a plane.&rdquo;</em> Just pick them up at the campus
            station on the day you land.
          </p>
        </div>
      </section>

      {/* ══════════════════════ FOR WHO ══════════════════════ */}
      <section className={cx(styles.sec, styles.forWho)} id="for-who">
        <div className={styles.secInner}>
          <div className={styles.secLabel}>For · Two sides of one loop</div>
          <h2 className={cx(styles.secHeading, styles.reveal)}>
            For those leaving, and those arriving.
          </h2>
          <p className={cx(styles.secSubHeading, styles.reveal)}>
            Every departure is someone else&apos;s beginning.
          </p>

          <div className={cx(styles.personaSplit, styles.reveal)}>
            <div className={cx(styles.persona, styles.depart)}>
              <span className={styles.personaIcon}>✈️</span>
              <div className={styles.personaLabel}>The Departing</div>
              <div className={styles.personaTitle}>Item donors</div>
              <div className={styles.personaTitleEn}>Leave light. Leave warm.</div>
              <div className={styles.personaTagline}>&ldquo;Light hands, warm heart.&rdquo;</div>
              <ul className={styles.personaList}>
                <li>No more packing stress</li>
                <li>Nothing gets thrown — everything is passed on</li>
                <li>Leave a beautiful trace of your time here</li>
              </ul>
            </div>
            <div className={cx(styles.persona, styles.arrive)}>
              <span className={styles.personaIcon}>🏠</span>
              <div className={styles.personaLabel}>The Arriving</div>
              <div className={styles.personaTitle}>Item recipients</div>
              <div className={styles.personaTitleEn}>A welcome from those who came before.</div>
              <div className={styles.personaTagline}>&ldquo;A welcome left for you.&rdquo;</div>
              <ul className={styles.personaList}>
                <li>Your essentials are already waiting</li>
                <li>Trusted, verified community items</li>
                <li>Save hundreds of thousands of won</li>
                <li>Start your Seoul life with onloop</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════ STATION ══════════════════════ */}
      <section className={cx(styles.sec, styles.station)} id="station-sec">
        <div className={styles.secInner}>
          <div className={styles.secLabel}>Station · Onloop campus stations</div>
          <h2 className={cx(styles.secHeading, styles.reveal)}>Where objects change hands.</h2>
          <p className={cx(styles.secSubHeading, styles.reveal)}>
            Physical hubs on every partner campus.
          </p>

          <div className={styles.stationGrid}>
            <div className={cx(styles.stationCard, styles.reveal, styles.revealD1)}>
              <span className={styles.stationCardIcon}>📍</span>
              <h3>Operated on campus</h3>
              <p>
                We partner with international offices and student councils to run physical
                circulation spaces directly on campus, concentrated at semester start and end.
              </p>
            </div>
            <div className={cx(styles.stationCard, styles.reveal, styles.revealD2)}>
              <span className={styles.stationCardIcon}>🔒</span>
              <h3>University-verified trust</h3>
              <p>
                Every member is verified with a university letter of acceptance. A safe, closed
                community of fellow students — never strangers.
              </p>
            </div>
            <div className={cx(styles.stationCard, styles.reveal, styles.revealD1)}>
              <span className={styles.stationCardIcon}>🌐</span>
              <h3>Web-connected</h3>
              <p>
                Register items before you depart. Browse items before you arrive. Online and
                offline, one unified loop.
              </p>
            </div>
            <div className={cx(styles.stationCard, styles.reveal, styles.revealD2)}>
              <span className={styles.stationCardIcon}>🔄</span>
              <h3>Continuity</h3>
              <p>An organic handoff between generations of exchange students.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════ WRAP-UP ══════════════════════ */}
      <section className={styles.wrapup}>
        <div className={styles.wrapupInner}>
          <svg
            width="52"
            height="60"
            viewBox="0 0 40 48"
            style={{ display: 'block', margin: '0 auto 48px' }}
          >
            <circle cx="20" cy="24" r="16" fill="none" stroke="#034159" strokeWidth="2.5" />
            <circle cx="20" cy="8" r="4" fill="#F5B82E" />
          </svg>

          <div className={cx(styles.wrapupQuote, styles.reveal)}>
            A beautiful person leaves behind
            <br />a <em>beautiful place</em>.
          </div>
          <p className={cx(styles.wrapupSub, styles.reveal)}>Be part of the loop — start today.</p>

          <div className={styles.reveal}>
            <Link
              className={cx(styles.btn, styles.btnPrimary)}
              href="/login"
              style={{ fontSize: 24, padding: '22px 56px' }}
            >
              Join onloop →
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════════════════ FOOTER ══════════════════════ */}
      <footer className={styles.footer}>
        {/* 목업의 2단 구성에 맞춰 grid 를 인라인으로 1fr 1fr 로 좁힙니다.
            목업의 .html 링크는 실제 라우트로 교체: r-browse.html → /receiver/explore,
            r-home.html → /mypage */}
        <div className={styles.footerInner} style={{ gridTemplateColumns: '1fr 1fr' }}>
          <div className={styles.footerCol}>
            <h4>Get on the Loop</h4>
            <Link href="/receiver/explore">Claim items</Link>
            <br />
            <Link href="/mypage">My Loop</Link>
          </div>
          <div className={styles.footerCol}>
            <h4>Connect</h4>
            <a href="#">Instagram</a>
            <br />
            <a href="#">KakaoTalk</a>
            <br />
            <a href="#">Email</a>
          </div>
        </div>
        <div className={styles.footerBottom}>
          <span>© 2026 onloop — Team A, Seoul Environmental Coalition</span>
          <span>Seoul, South Korea</span>
        </div>
      </footer>
    </main>
  )
}
