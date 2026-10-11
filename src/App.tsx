import { useEffect, useState } from "react";
import {
  Archive,
  BriefcaseBusiness,
  CheckSquare,
  ChevronRight,
  FileText,
  ReceiptText,
  LayoutDashboard,
  Mail,
  Menu,
  Settings,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import EmailStudio from "./EmailStudio";
import QuotationsPage from "./pages/QuotationsPage";
import ProjectsPage from "./pages/ProjectsPage";
import ClientsPage from "./pages/ClientsPage";
import InvoicesPage from "./pages/InvoicesPage";
import BusinessProfileForm from "./components/BusinessProfileForm";
import logoUrl from "./assets/JSN DESIGN.png";

type Page =
  | "dashboard"
  | "email"
  | "quotations"
  | "invoices"
  | "orders"
  | "clients"
  | "settings";
type Stats = {
  clients: number;
  open_quotations: number;
  active_orders: number;
  open_tasks: number;
  open_invoices: number;
  overdue_invoices: number;
  outstanding_minor: number;
  upcoming_tasks: {
    id: string;
    title: string;
    due_date: string | null;
    status: string;
  }[];
};
const nav: { id: Page; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "email", label: "Email Studio", icon: Mail },
  { id: "quotations", label: "Quotations", icon: FileText },
  { id: "invoices", label: "Invoices", icon: ReceiptText },
  { id: "orders", label: "Orders & Projects", icon: BriefcaseBusiness },
  { id: "clients", label: "Clients", icon: Users },
  { id: "settings", label: "Settings", icon: Settings },
];
const pageCopy: Record<Page, { title: string; description: string }> = {
  dashboard: {
    title: "Dashboard",
    description: "A current view of your business records.",
  },
  email: {
    title: "Email Studio",
    description: "Compose and send a polished email.",
  },
  quotations: {
    title: "Quotations",
    description: "Create and track client quotations.",
  },
  invoices: { title: "Invoices", description: "Issue invoices and track payments." },
  orders: {
    title: "Orders & Projects",
    description: "Track agreed work, delivery, tasks, and payments.",
  },
  clients: {
    title: "Clients",
    description: "Keep your client details in one place.",
  },
  settings: {
    title: "Settings",
    description: "Manage local data and email connection.",
  },
};
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}
const money = (minor: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(minor / 100);

export default function App() {
  const [showIntro, setShowIntro] = useState(() => {
    try {
      return window.sessionStorage.getItem("jsn-business-intro-seen") !== "1";
    } catch {
      return true;
    }
  });
  const [page, setPage] = useState<Page>(() => {
    const p = window.location.pathname.slice(1) as Page;
    return nav.some((n) => n.id === p) ? p : "dashboard";
  });
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [clientTarget, setClientTarget] = useState<string | null>(null);
  const [quotationClient, setQuotationClient] = useState<string | null>(null);
  const [quotationTarget, setQuotationTarget] = useState<string | null>(null);
  const [invoiceClient, setInvoiceClient] = useState<string | null>(null);
  const [invoiceTarget, setInvoiceTarget] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gmail, setGmail] = useState<string | null>(null);
  const [gmailError, setGmailError] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  useEffect(() => {
    if (!showIntro) return;
    try { window.sessionStorage.setItem("jsn-business-intro-seen", "1"); } catch { /* Intro remains non-blocking when storage is unavailable. */ }
    const timer = window.setTimeout(() => setShowIntro(false), 1350);
    return () => window.clearTimeout(timer);
  }, [showIntro]);
  const navigate = (next: Page) => {
    setPage(next);
    setMobileOpen(false);
    window.history.pushState({}, "", next === "dashboard" ? "/" : `/${next}`);
  };
  useEffect(() => {
    const pop = () => {
      const p = window.location.pathname.slice(1) as Page;
      setPage(nav.some((n) => n.id === p) ? p : "dashboard");
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    setLoadError(null);
    if (page === "dashboard") {
      setLoading(true);
      api<Stats>("/api/dashboard")
        .then(setStats)
        .catch((e) => {
          setLoadError(e.message);
          toast.error(e.message);
        })
        .finally(() => setLoading(false));
    }
    if (page === "settings") {
      setGmailError(false);
      api<{ gmailUser: string | null }>("/api/email/config")
        .then((d) => setGmail(d.gmailUser))
        .catch(() => {
          setGmail(null);
          setGmailError(true);
        });
    }
  }, [page]);
  const restore = async () => {
    if (!restoreFile) return;
    const data = new FormData();
    data.append("backup", restoreFile);
    try {
      await api("/api/restore", { method: "POST", body: data });
      setRestoreFile(null);
      toast.success("Database restored. Refreshing records.");
      if (page === "dashboard") setStats(await api<Stats>("/api/dashboard"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Restore failed.");
    }
  };
  const content = () => {
    if (page === "email") return <EmailStudio />;
    if (page === "dashboard")
      return (
        <>
          {loadError && <LoadFailure message={loadError} />}
          {!loadError && loading && !stats ? (
            <div className="business-panel">Loading business records…</div>
          ) : !loadError ? (
            stats && (
              <>
                <div className="metric-grid">
                  {[
                    ["Clients", stats.clients],
                    ["Open quotations", stats.open_quotations],
                    ["Active orders", stats.active_orders],
                    ["Open tasks", stats.open_tasks],
                  ].map(([label, value]) => (
                    <div className="metric-card" key={label}>
                      <span>{label}</span>
                      <strong>{value}</strong>
                    </div>
                  ))}
                  <div className="metric-card">
                    <span>Outstanding balance</span>
                    <strong>{money(stats.outstanding_minor)}</strong>
                  </div>
                  <button className="metric-card invoice-dashboard-link" onClick={() => navigate("invoices")}>
                    <span>Open invoices</span><strong>{stats.open_invoices}</strong><small>{stats.overdue_invoices} overdue · view invoices</small>
                  </button>
                </div>
                <section className="business-panel">
                  <h2>Upcoming tasks</h2>
                  {stats.upcoming_tasks.length ? (
                    <ul className="record-list">
                      {stats.upcoming_tasks.map((t) => (
                        <li key={t.id}>
                          <CheckSquare size={16} />
                          <span>{t.title}</span>
                          <small>{t.due_date || "No due date"}</small>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty-copy">
                      No open tasks yet. Tasks added to projects will appear
                      here.
                    </p>
                  )}
                </section>
              </>
            )
          ) : null}
        </>
      );
    if (page === "clients") return <ClientsPage initialClientId={clientTarget} onClearInitial={() => setClientTarget(null)} onCreateQuotation={(id) => { setQuotationClient(id); navigate("quotations"); }} onCreateInvoice={(id)=>{setInvoiceClient(id);navigate("invoices");}} onOpenQuotation={(id) => { setQuotationTarget(id); navigate("quotations"); }} onOpenInvoice={(id)=>{setInvoiceTarget(id);navigate("invoices");}} />;
    if (page === "quotations")
      return (
        <QuotationsPage
          onClients={(id) => { setClientTarget(id || null); navigate("clients"); }}
          defaultClientId={quotationClient}
          onDefaultClientConsumed={() => setQuotationClient(null)}
          initialQuotationId={quotationTarget}
          onInitialQuotationConsumed={() => setQuotationTarget(null)}
          onConverted={() => navigate("orders")}
          onEmailStudio={() => {
            toast("Attach the downloaded quotation PDF and review your email before sending.");
            navigate("email");
          }}
        />
      );
    if (page === "invoices")
      return <InvoicesPage defaultClientId={invoiceClient} onDefaultClientConsumed={()=>setInvoiceClient(null)} initialInvoiceId={invoiceTarget} onInitialInvoiceConsumed={()=>setInvoiceTarget(null)} onEmailStudio={() => { toast("Download the invoice PDF, attach it in Email Studio, and review before sending."); navigate("email"); }} />;
    if (page === "orders")
      return <ProjectsPage onClients={(id) => { setClientTarget(id || null); navigate("clients"); }} />;
    return (
      <>
        <BusinessProfileForm />
        <section className="business-panel">
          <h2>Local database</h2>
          <p>
            Business records are stored in a SQLite database on this computer.
            No records are stored in the public frontend folder.
          </p>
          <p className="muted">
            Database path:{" "}
            <code>
              {"LOCALAPPDATA or APPDATA"}\JSN Designs Business
              Studio\business.sqlite
            </code>
          </p>
          <a className="studio-button link-button" href="/api/backup" download>
            <Archive size={15} /> Download database backup
          </a>
        </section>
        <section className="business-panel">
          <h2>Restore a backup</h2>
          <p>
            Upload a SQLite backup created by this application. The file is
            checked before replacement, and a recovery copy of the current
            database is kept locally.
          </p>
          <div className="restore-row">
            <input
              type="file"
              accept=".sqlite,.db,application/vnd.sqlite3"
              onChange={(e) => setRestoreFile(e.target.files?.[0] || null)}
            />
            <button
              className="secondary-button"
              disabled={!restoreFile}
              onClick={restore}
            >
              Restore backup
            </button>
          </div>
        </section>
        <section className="business-panel">
          <h2>Email connection</h2>
          <p>
            {gmailError
              ? "Unable to check the Gmail connection. The local API may be unavailable."
              : gmail
                ? `Gmail is configured for ${gmail}.`
                : "Gmail is not configured. Add GMAIL_USER and GMAIL_APP_PASSWORD to the local .env file."}
          </p>
        </section>
      </>
    );
  };
  const active = nav.find((n) => n.id === page)!;
  return (
    <div
      className={`business-shell ${collapsed ? "is-collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
    >
      {showIntro && <div className="brand-intro" aria-hidden="true"><img src={logoUrl} alt="" /><span /></div>}
      <aside className="business-sidebar">
        <div className="sidebar-brand">
          <img src={logoUrl} alt="JSN Designs" />
          <span>
            JSN DESIGNS
            <br />
            <b>BUSINESS STUDIO</b>
          </span>
          <button
            className="mobile-close"
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
          >
            <X size={18} />
          </button>
        </div>
        <div className="nav-caption">WORKSPACE</div>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={`nav-link ${page === n.id ? "selected" : ""}`}
              onClick={() => navigate(n.id)}
              title={n.label}
            >
              <n.icon size={18} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="local-indicator" /> Local workspace
        </div>
      </aside>
      <div className="business-main">
        <header className="business-topbar">
          <button
            className="collapse-control"
            onClick={() => setCollapsed((v) => !v)}
            aria-label="Collapse sidebar"
          >
            <Menu size={18} />
          </button>
          <button
            className="mobile-menu"
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={18} />
          </button>
          <div className="topbar-context">
            JSN DESIGNS <ChevronRight size={13} />
            <span>{active.label}</span>
          </div>
          <span className="secure-local">LOCAL DATA</span>
        </header>
        <main
          className={`business-content ${page === "email" ? "email-content" : ""}`}
        >
          <div className="business-page-heading">
            <div>
              <span className="business-eyebrow">
                BUSINESS STUDIO /{" "}
                {String(nav.findIndex((n) => n.id === page) + 1).padStart(
                  2,
                  "0",
                )}
              </span>
              <h1>{pageCopy[page].title}</h1>
              <p>{pageCopy[page].description}</p>
            </div>
          </div>
          {content()}
        </main>
      </div>
    </div>
  );
}

function Empty({
  title,
  text,
  action,
  actionLabel,
}: {
  title: string;
  text: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <section className="empty-state">
      <div className="empty-icon">
        <FileText size={21} />
      </div>
      <h2>{title}</h2>
      <p>{text}</p>
      {action && (
        <button className="secondary-button" onClick={action}>
          {actionLabel}
        </button>
      )}
    </section>
  );
}

function LoadFailure({ message }: { message: string }) {
  return (
    <section className="empty-state">
      <h2>Business records unavailable</h2>
      <p>
        {message}. Check that the local API is running, then refresh this page.
      </p>
    </section>
  );
}
