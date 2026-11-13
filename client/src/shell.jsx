import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronDown, Command, FileText, LogOut, MessageSquareText, Plus, Search, Settings2, Lightbulb, X } from "lucide-react";
import { useAuth } from "./auth.jsx";

export function Shell() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [density, setDensity] = useState(() => localStorage.getItem("papertrail-density") || "comfortable");
  useEffect(() => {
    document.documentElement.dataset.density = density;
    localStorage.setItem("papertrail-density", density);
  }, [density]);
  const title = location.pathname === "/library" ? "Your library" : location.pathname === "/research" ? "Research" : "Overview";
  return <div className={`app-frame ${location.pathname === "/research" ? "research-shell" : ""}`}>
    <aside className="sidebar">
      <a className="wordmark" href="/"><img className="brand-logo sidebar-brand-logo" src="/papertrail-ai-logo.svg" alt="Papertrail"/></a>
      <div className="workspace-switch"><div className="workspace-avatar">{user?.name?.[0]?.toUpperCase() || "Y"}</div><div><strong>{user?.name || "Your workspace"}</strong><small>Personal workspace</small></div><ChevronDown size={15}/></div>
      <button className="new-research" onClick={() => navigate("/research")}><Plus size={16}/> New research chat <span>⌘ K</span></button>
      <p className="nav-label">WORKSPACE</p>
      <nav className="primary-nav">
        <NavLink end to="/"><Command size={17}/> Overview</NavLink>
        <NavLink to="/library"><FileText size={17}/> Documents</NavLink>
        <NavLink to="/research"><MessageSquareText size={17}/> Research</NavLink>
      </nav>
      <div className="sidebar-rule"/>
      <div className="sidebar-recent-head"><p className="nav-label">RECENT CHATS</p><button aria-label="New chat" onClick={() => navigate("/research")}><Plus size={15}/></button></div>
      <p className="sidebar-empty">Your conversations will appear here.</p>
      <div className="sidebar-bottom"><div className="plan-card"><div className="plan-icon"><Lightbulb size={15}/></div><div><strong>Thoughtful research</strong><p>Answers grounded in your sources.</p></div></div>
        <button className="profile-row" onClick={async () => { await logout(); navigate("/login"); }}><div className="profile-avatar">{user?.name?.[0]?.toUpperCase()}</div><div><strong>{user?.name}</strong><small>{user?.email}</small></div><LogOut size={16}/></button>
      </div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{title}</strong></div><div className="topbar-actions"><button className="icon-button" aria-label="Search"><Search size={17}/></button><span className="topbar-divider"/><button className="help-button" onClick={() => setPreferencesOpen(true)} aria-haspopup="dialog"><Settings2 size={16}/> Preferences</button></div></header>
      <div className="page-content"><Outlet/></div>
    </main>
    {preferencesOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreferencesOpen(false); }}><section className="preferences-modal" role="dialog" aria-modal="true" aria-labelledby="preferences-title"><div className="modal-heading"><div><span className="eyebrow">WORKSPACE</span><h2 id="preferences-title">Preferences</h2></div><button className="modal-close" aria-label="Close preferences" onClick={() => setPreferencesOpen(false)}><X size={18}/></button></div><p>Choose how much space document and conversation items use.</p><fieldset className="preference-options"><legend>Display density</legend><label><input type="radio" name="density" value="comfortable" checked={density === "comfortable"} onChange={() => setDensity("comfortable")}/><span><strong>Comfortable</strong><small>More room around documents and messages.</small></span></label><label><input type="radio" name="density" value="compact" checked={density === "compact"} onChange={() => setDensity("compact")}/><span><strong>Compact</strong><small>Fit more documents and conversation on screen.</small></span></label></fieldset><div className="modal-footer"><span>Saved automatically on this device.</span><button className="button-primary" onClick={() => setPreferencesOpen(false)}>Done</button></div></section></div>}
  </div>;
}
