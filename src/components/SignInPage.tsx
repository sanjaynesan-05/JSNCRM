import { useState, type FormEvent } from "react";
import { ArrowRight, Eye, EyeOff, LockKeyhole } from "lucide-react";
import logoUrl from "../assets/JSN DESIGN.png";

type SignInPageProps = {
  onAuthenticated: (username: string) => void;
  initialMessage?: string;
};

export default function SignInPage({ onAuthenticated, initialMessage }: SignInPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialMessage || "");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Unable to sign in. Please try again.");
      setPassword("");
      onAuthenticated(result.username || username.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to sign in. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="signin-page">
      <section className="signin-brand-panel" aria-label="JSN Designs Business Studio">
        <div className="signin-brand-lockup">
          <img src={logoUrl} alt="JSN Designs" />
          <span>JSN DESIGNS<small>BUSINESS STUDIO</small></span>
        </div>
        <div className="signin-brand-copy">
          <span className="signin-overline">YOUR BUSINESS WORKSPACE</span>
          <h1>Good work<br />starts with<br /><em>a clear view.</em></h1>
          <p>Clients, projects, quotations, invoices and payments—together in one considered workspace.</p>
        </div>
        <div className="signin-brand-footer"><span>JSN DESIGNS</span><span>EST. WITH INTENTION</span></div>
        <div className="signin-gold-orbit" aria-hidden="true" />
      </section>

      <section className="signin-form-panel">
        <div className="signin-form-wrap">
          <div className="signin-mobile-brand">
            <img src={logoUrl} alt="JSN Designs" />
            <span>JSN DESIGNS<small>BUSINESS STUDIO</small></span>
          </div>
          <div className="signin-heading">
            <span className="signin-overline">PRIVATE WORKSPACE</span>
            <h2>Welcome back</h2>
            <p>Sign in to continue to your business studio.</p>
          </div>

          <form className="signin-form" onSubmit={submit}>
            <label htmlFor="signin-username">Username</label>
            <input
              id="signin-username"
              name="username"
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              maxLength={200}
              autoCapitalize="none"
              spellCheck={false}
              autoFocus
              required
            />

            <label htmlFor="signin-password">Password</label>
            <div className="signin-password-field">
              <input
                id="signin-password"
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                maxLength={1024}
                required
              />
              <button
                type="button"
                className="signin-password-toggle"
                onClick={() => setShowPassword((visible) => !visible)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>

            {error && <p className="signin-error" role="alert">{error}</p>}

            <button className="signin-submit" type="submit" disabled={busy || !username.trim() || !password}>
              <span>{busy ? "Signing in…" : "Sign in"}</span>
              <ArrowRight size={17} />
            </button>
          </form>

          <div className="signin-security-note">
            <LockKeyhole size={15} />
            <span>Your workspace is protected. Your password is never stored in this browser.</span>
          </div>
          <p className="signin-help">Need access? Contact your workspace administrator.</p>
        </div>
        <footer className="signin-page-footer"><span>© JSN DESIGNS</span><span>BUSINESS STUDIO</span></footer>
      </section>
    </main>
  );
}
