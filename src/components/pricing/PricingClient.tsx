'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { ENGINES, PLANS, type PlanId } from '@/lib/vfx-data';
import { useApp } from '@/lib/client/store';
import { playSfx } from '@/lib/sfx';
import { SPRING } from '@/lib/motion';

/** Dollar value of one credit on the Creator plan. */
const CREDIT_USD = 19 / 300;
const MAX_CR = Math.max(...ENGINES.map((e) => e.credits));


const FAQ = [
  { q: 'What is a credit?', a: 'Credits pay for renders. A Kinetix Pro shot costs 12 credits; partner engines like Veo or Kling cost more.' },
  { q: 'Do failed renders cost credits?', a: 'No. If a render fails or you cancel it, the credits go straight back to your balance.' },
  { q: 'Can I write prompts in Banglish?', a: 'Yes. The Director Agent reads English, Bangla and Banglish and writes a clean English shot prompt for the model.' },
  { q: 'Can I cancel any time?', a: 'Yes. Plans renew monthly through Stripe and you keep the credits you already have.' },
];

export default function PricingClient() {
  const { config, session, apiFetch, setAuthOpen } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [busy, setBusy] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(params.get('checkout') === 'canceled' ? 'Checkout canceled. No charge was made.' : null);

  async function choose(plan: PlanId) {
    playSfx('select');
    setError(null);
    if (plan === 'free' || !config?.checkout) {
      router.push('/studio');
      return;
    }
    if (!session) {
      setAuthOpen(true);
      return;
    }
    setBusy(plan);
    try {
      const res = await apiFetch('/api/checkout', { method: 'POST', body: JSON.stringify({ plan }) });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || 'Checkout failed');
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed');
      setBusy(null);
    }
  }

  return (
    <div className="wrap">
      <span className="eyebrow">Pricing</span>
      <h1 className="display" style={{ fontSize: 'clamp(2.4rem, 6vw, 5rem)', marginTop: 12 }}>
        Simple credits. <span className="serif">Honest math.</span>
      </h1>
      <p className="section-lede">Pay for shots, not seats. Kinetix Pro is our own tuned cinema model, so it costs about half of the partner engines.</p>
      {!config?.checkout && config && (
        <p className="mono dim" style={{ fontSize: 12, marginTop: 14 }}>Payments are not switched on for this deployment yet. Every plan button opens the Studio.</p>
      )}
      {error && (
        <p role="alert" style={{ color: 'var(--error)', marginTop: 14, fontSize: 14 }}>
          {error}
        </p>
      )}

      <div className="tiers" style={{ marginTop: 40 }}>
        {PLANS.map((p, i) => {
          const featured = p.id === 'creator';
          return (
            <motion.div
              key={p.id}
              className={`tier${featured ? ' featured' : ''}`}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ ...SPRING, delay: i * 0.07 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="eyebrow" style={{ color: featured ? 'var(--lime)' : undefined }}>{p.name}</span>
                {featured && <span className="mono lime" style={{ fontSize: 11 }}>Most picked</span>}
              </div>
              <div className="tier-price">
                ${p.price}
                <small>{p.price ? '/ month' : 'forever'}</small>
              </div>
              <p className="muted" style={{ fontSize: 14 }}>{p.blurb}</p>
              <div className="mono" style={{ fontSize: 13 }}>
                <span className="lime">{p.credits.toLocaleString()} CR</span>
                <span className="dim"> · ≈ {Math.floor(p.credits / 12)} Kinetix Pro shots</span>
              </div>
              <ul>
                {p.perks.map((perk) => (
                  <li key={perk}>
                    <Check size={15} /> {perk}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={`btn ${featured ? 'btn-lime' : 'btn-glass'}`}
                style={{ marginTop: 'auto' }}
                onClick={() => void choose(p.id)}
                disabled={busy !== null}
              >
                {busy === p.id ? 'Opening checkout…' : p.id === 'free' ? 'Start free' : config?.checkout ? `Choose ${p.name}` : 'Open Studio'}
              </button>
            </motion.div>
          );
        })}
      </div>

      <section className="section" aria-labelledby="econ-title">
        <span className="eyebrow">Unit economics</span>
        <h2 id="econ-title" className="display section-title" style={{ marginTop: 10, marginBottom: 24 }}>
          What one shot <span className="serif">really costs.</span>
        </h2>
        <div className="table-scroll">
          <table className="econ">
            <thead>
              <tr>
                <th scope="col">Engine</th>
                <th scope="col">Provider</th>
                <th scope="col">Credits / shot</th>
                <th scope="col">≈ USD on Creator</th>
                <th scope="col" style={{ width: '28%' }}>Relative cost</th>
              </tr>
            </thead>
            <tbody>
              {ENGINES.map((e) => (
                <tr key={e.id} className={e.id === 'kinetix-pro' ? 'hl' : undefined}>
                  <td style={{ fontWeight: 600 }}>{e.name}</td>
                  <td className="muted">{e.provider}</td>
                  <td className="mono">{e.credits} CR</td>
                  <td className="mono">${(e.credits * CREDIT_USD).toFixed(2)}</td>
                  <td>
                    <div className="bar" aria-hidden="true">
                      <i style={{ width: `${(e.credits / MAX_CR) * 100}%` }} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="dim" style={{ fontSize: 13, marginTop: 14 }}>
          Kinetix Pro saves 2.3× against Seedance 2.5 and 3× against Veo 3.1 for the same shot.
        </p>
      </section>

      <section className="section" aria-labelledby="faq-title">
        <h2 id="faq-title" className="display section-title" style={{ marginBottom: 28 }}>
          Questions, <span className="serif">answered.</span>
        </h2>
        <div className="faq">
          {FAQ.map((f) => (
            <div key={f.q}>
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </div>
          ))}
        </div>
        <Link href="/studio" className="btn btn-lime" style={{ marginTop: 40 }}>
          Try the Studio free
        </Link>
      </section>
    </div>
  );
}
