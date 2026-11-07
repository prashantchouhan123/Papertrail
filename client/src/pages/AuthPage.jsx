import { useState } from "react";
import { ArrowRight, BookOpenCheck, FileText, ShieldCheck, Lightbulb } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../auth.jsx";

export function AuthPage({ mode }) {
  const registering = mode === "register";
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault(); setError(""); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      if (registering) await register(form.get("name"), form.get("email"), form.get("password"));
      else await login(form.get("email"), form.get("password"));
      navigate("/", { replace: true });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <div className="auth-layout">
    <section className="auth-story"><a className="wordmark light-wordmark" href="/"><img className="brand-logo auth-brand-logo" src="/papertrail-ai-logo.svg" alt="Papertrail — AI Document Research Assistant"/></a>
      <div className="story-content"><span className="eyebrow light-eyebrow"><Lightbulb size={14}/> YOUR KNOWLEDGE, CONNECTED</span><h1>Good research<br/>starts with <em>good sources.</em></h1><p>Bring your PDFs together. Ask better questions. Follow every answer back to the page that supports it.</p>
      <div className="story-proof"><div className="proof-icon"><BookOpenCheck size={19}/></div><span><strong>Grounded in your documents</strong><small>Every answer points back to its source.</small></span></div><div className="story-proof"><div className="proof-icon"><ShieldCheck size={19}/></div><span><strong>Your library stays yours</strong><small>Private documents, scoped to your account.</small></span></div></div>
      <div className="story-footer"><span>READ CLOSELY. THINK CLEARLY.</span><span>BUILT FOR THE CURIOUS</span></div>
    </section>
    <section className="auth-form-side"><div className="auth-form-wrap"><div className="auth-mobile-brand"><img className="brand-logo mobile-brand-logo" src="/papertrail-ai-logo.svg" alt="Papertrail"/></div><span className="eyebrow">{registering ? "A SPACE OF YOUR OWN" : "WELCOME BACK"}</span><h2>{registering ? "Create your workspace" : "Sign in to continue"}</h2><p className="auth-subtitle">{registering ? "A quieter, clearer way to work through your documents." : "Pick up where your thinking left off."}</p>
        <form onSubmit={submit} className="auth-form">{registering && <label>Full name<input autoComplete="name" name="name" placeholder="Enter your full name" required minLength="2" maxLength="120"/></label>}<label>Email address<input autoComplete="email" name="email" type="email" placeholder="Enter your email address" required/></label><label>Password<input autoComplete={registering ? "new-password" : "current-password"} name="password" type="password" placeholder={registering ? "Create a strong password" : "Enter your password"} required minLength={registering ? 10 : 1}/></label>
        {error && <div className="form-error" role="alert">{error}</div>}<button disabled={busy} className="button-primary auth-submit">{busy ? "One moment…" : registering ? "Create account" : "Sign in"}<ArrowRight size={17}/></button></form>
        <p className="auth-switch">{registering ? "Already have an account?" : "New to Papertrail?"} <Link to={registering ? "/login" : "/register"}>{registering ? "Sign in" : "Create an account"}</Link></p><p className="privacy-note"><FileText size={14}/> Your documents are private to your account.</p></div>
    </section>
  </div>;
}
