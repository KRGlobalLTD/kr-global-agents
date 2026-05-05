'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const [loading,  setLoading]  = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn('credentials', {
      email:    email.trim(),
      password,
      redirect: false,
    });

    setLoading(false);

    if (result?.error) {
      setError('Email ou mot de passe incorrect.');
    } else {
      router.push('/dashboard');
    }
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-4"
      style={{ background: '#0a0a0a' }}
    >
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex flex-col items-center gap-3 mb-10">
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center text-sm font-black text-white"
            style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
          >
            KR
          </div>
          <div className="text-center">
            <p className="text-white font-bold text-base tracking-tight">KR Global Solutions Ltd</p>
            <p className="text-slate-500 text-xs uppercase tracking-widest mt-0.5">Mission Control</p>
          </div>
        </div>

        {/* Card */}
        <div
          className="rounded-2xl border p-7"
          style={{ borderColor: 'rgba(255,255,255,0.08)', background: 'rgba(255,255,255,0.03)' }}
        >
          <h1 className="text-white text-lg font-semibold mb-1">Connexion</h1>
          <p className="text-slate-500 text-sm mb-6">Accès réservé aux administrateurs KR Global.</p>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">

            {/* Email */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400" htmlFor="email">
                Adresse email
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="karim@krglobalsolutionsltd.com"
                className="rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all"
                style={{
                  background:   'rgba(255,255,255,0.05)',
                  border:       '1px solid rgba(255,255,255,0.1)',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#7c3aed'; }}
                onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              />
            </div>

            {/* Password */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-slate-400" htmlFor="password">
                Mot de passe
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="rounded-lg px-3.5 py-2.5 text-sm text-white placeholder-slate-600 outline-none transition-all"
                style={{
                  background:   'rgba(255,255,255,0.05)',
                  border:       '1px solid rgba(255,255,255,0.1)',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = '#7c3aed'; }}
                onBlur={e  => { e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)'; }}
              />
            </div>

            {/* Error */}
            {error && (
              <div
                className="rounded-lg px-4 py-2.5 text-sm"
                style={{ background: 'rgba(248,113,113,0.08)', color: '#f87171', border: '1px solid rgba(248,113,113,0.2)' }}
              >
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="mt-1 rounded-lg py-2.5 text-sm font-semibold text-white transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: loading ? 'rgba(124,58,237,0.6)' : 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <span
                    className="w-4 h-4 rounded-full border-2 animate-spin"
                    style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }}
                  />
                  Connexion…
                </span>
              ) : (
                'Accéder à Mission Control'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-[11px] text-slate-700 mt-6">
          KR Global Solutions Ltd · Londres, UK
        </p>
      </div>
    </div>
  );
}
