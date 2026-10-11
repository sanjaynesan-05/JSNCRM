import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Archive, BriefcaseBusiness, FileText, Plus, ReceiptText, RotateCcw, Save, Search, UserRound, X } from "lucide-react";
import { toast } from "sonner";
import { api, jsonRequest } from "../services/api/apiClient";
import type { Client } from "../types/business";

type ClientRecord = Client & { address: string | null; notes: string | null; updated_at: string; archived_at: string | null };
type ClientDetails = { client: ClientRecord; quotations: { id: string; quotation_number: string; title: string; status: string; total_minor: number; currency: string; issue_date: string }[]; invoices: { id:string;invoice_number:string;title:string;status:string;total_minor:number;currency:string;issue_date:string;due_date:string|null }[]; orders: { id: string; order_number: string; title: string; status: string; agreed_amount_minor: number; currency: string; paid_minor: number; outstanding_minor: number; due_date: string | null }[]; tasks: { id: string; order_number: string; title: string; status: string; due_date: string | null }[]; outstanding_minor: number };
type Draft = { name: string; company_name: string; email: string; phone: string; address: string; notes: string };
const blank = (): Draft => ({ name: "", company_name: "", email: "", phone: "", address: "", notes: "" });
const money = (minor: number, currency = "INR") => new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
const date = (value?: string | null) => value ? new Date(value).toLocaleString() : "—";

export default function ClientsPage({ initialClientId, onCreateQuotation, onCreateInvoice, onClearInitial, onOpenQuotation, onOpenInvoice }: { initialClientId?: string | null; onCreateQuotation: (clientId: string) => void; onCreateInvoice: (clientId: string) => void; onClearInitial: () => void; onOpenQuotation: (id: string) => void; onOpenInvoice:(id:string)=>void }) {
  const [clients, setClients] = useState<ClientRecord[]>([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(initialClientId || null);
  const [details, setDetails] = useState<ClientDetails | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [draft, setDraft] = useState<Draft>(blank());
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ status });
      if (search.trim()) params.set("search", search.trim());
      setClients(await api<ClientRecord[]>(`/api/clients?${params}`));
    } catch (e) { setError(e instanceof Error ? e.message : "Unable to load clients."); }
    finally { setLoading(false); }
  }, [search, status]);
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { if (initialClientId) { setSelectedId(initialClientId); onClearInitial(); } }, [initialClientId, onClearInitial]);
  useEffect(() => {
    if (!selectedId) { setDetails(null); return; }
    let current = true; setDetailLoading(true);
    api<ClientDetails>(`/api/clients/${selectedId}`).then((data) => { if (current) { setDetails(data); setDraft({ name: data.client.name, company_name: data.client.company_name || "", email: data.client.email || "", phone: data.client.phone || "", address: data.client.address || "", notes: data.client.notes || "" }); } }).catch((e) => { if (current) toast.error(e.message); }).finally(() => { if (current) setDetailLoading(false); });
    return () => { current = false; };
  }, [selectedId]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true);
    try {
      if (creating) {
        const client = await api<ClientRecord>("/api/clients", jsonRequest("POST", draft));
        toast.success("Client created."); setCreating(false); setSelectedId(client.id);
      } else if (selectedId) {
        await api(`/api/clients/${selectedId}`, jsonRequest("PUT", draft));
        toast.success("Client details updated."); setEditing(false);
      }
      await refresh();
      if (!creating && selectedId) setDetails(await api<ClientDetails>(`/api/clients/${selectedId}`));
    } catch (e) { toast.error(e instanceof Error ? e.message : "Unable to save client."); }
    finally { setSaving(false); }
  };
  const leaveEdit = () => { if (!window.confirm("Discard unsaved client changes?")) return; setEditing(false); setCreating(false); if (details) setDraft({ name: details.client.name, company_name: details.client.company_name || "", email: details.client.email || "", phone: details.client.phone || "", address: details.client.address || "", notes: details.client.notes || "" }); else setDraft(blank()); };
  const archiveAction = async () => {
    if (!details) return;
    const archived = Boolean(details.client.archived_at);
    if (!archived && !window.confirm(`Archive ${details.client.name}? Existing quotations, orders, payments, and tasks will remain available.`)) return;
    try { await api(`/api/clients/${details.client.id}/${archived ? "restore" : "archive"}`, { method: "PATCH" }); toast.success(archived ? "Client restored." : "Client archived."); setStatus(archived ? "active" : "archived"); await refresh(); setDetails(await api<ClientDetails>(`/api/clients/${details.client.id}`)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Unable to update client status."); }
  };
  const openCreate = () => { if (editing && !window.confirm("Discard unsaved client changes?")) return; setSelectedId(null); setDetails(null); setEditing(false); setCreating(true); setDraft(blank()); };
  const input = (label: string, field: keyof Draft, type = "text") => <label>{label}<input type={type} maxLength={field === "name" ? 160 : undefined} required={field === "name"} value={draft[field]} onChange={(e) => setDraft({ ...draft, [field]: e.target.value })} /></label>;
  const formPanel = (title: string) => <form className="business-panel client-form" onSubmit={save}><h2>{title}</h2>{input("Name", "name")}{input("Company", "company_name")}{input("Email", "email", "email")}{input("Phone", "phone")}<label className="wide">Address<input value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></label><label className="wide">Notes<textarea rows={3} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></label><div className="form-actions"><button type="button" className="secondary-button" onClick={leaveEdit}>Cancel</button><button className="studio-button" disabled={saving}><Save size={15} /> {saving ? "Saving…" : "Save client"}</button></div></form>;
  return <div className="clients-workspace">
    <div className="page-toolbar"><label className="client-search"><Search size={16} /><input aria-label="Search clients" placeholder="Search name, company, email, or reference" value={search} onChange={(e) => setSearch(e.target.value)} /></label><label className="client-filter">Status<select value={status} onChange={(e) => setStatus(e.target.value as "active" | "archived")}><option value="active">Active</option><option value="archived">Archived</option></select></label><span>{clients.length} record{clients.length === 1 ? "" : "s"}</span><button className="studio-button" onClick={openCreate}><Plus size={15} /> Add client</button></div>
    {creating && formPanel("New client")}
    <div className="client-layout"><section className="business-panel client-directory" aria-label="Client directory">
      {error ? <p role="alert">{error}</p> : loading ? <p>Loading clients…</p> : clients.length ? <ul className="client-list">{clients.map((c) => <li key={c.id}><button className={`client-list-item ${selectedId === c.id ? "selected" : ""}`} onClick={() => { if (editing && !window.confirm("Discard unsaved client changes?")) return; setEditing(false); setCreating(false); setSelectedId(c.id); }}><UserRound size={17} /><span><b>{c.name}</b><small>{c.company_name || c.email || "No company or email"}</small></span><small>{c.client_code}</small></button></li>)}</ul> : <p className="empty-copy">{search ? "No matching clients." : status === "active" ? "No active clients yet." : "No archived clients."}</p>}
    </section><section className="client-detail-column">
      {editing && details ? formPanel("Edit client") : detailLoading ? <div className="business-panel">Loading client details…</div> : details ? <article className="business-panel client-detail"><header><button className="secondary-button" onClick={() => { setSelectedId(null); setDetails(null); }}><ArrowLeft size={15} /> Directory</button><div className="client-detail-actions">{!details.client.archived_at && <><button className="studio-button" onClick={() => onCreateQuotation(details.client.id)}><Plus size={15} /> Create quotation</button><button className="secondary-button" onClick={() => onCreateInvoice(details.client.id)}>Create invoice</button></>}<button className="secondary-button" onClick={() => setEditing(true)}>Edit</button><button className="secondary-button" onClick={() => void archiveAction()}>{details.client.archived_at ? <><RotateCcw size={15} /> Restore</> : <><Archive size={15} /> Archive</>}</button></div></header><div className="client-identity"><div><span className="business-eyebrow">{details.client.client_code}</span><h2>{details.client.name}</h2><p>{details.client.company_name || "Individual client"} · {details.client.archived_at ? "Archived" : "Active"}</p></div><div className="client-balance"><small>Open order balance</small><b>{money(details.outstanding_minor)}</b></div></div><dl className="client-contact-grid">{[["Email", details.client.email], ["Phone", details.client.phone], ["Address", details.client.address], ["Created", date(details.client.created_at)], ["Last updated", date(details.client.updated_at)], ["Archived", date(details.client.archived_at)]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || "—"}</dd></div>)}</dl>{details.client.notes && <section className="client-notes"><h3>Notes</h3><p>{details.client.notes}</p></section>}<section className="client-related"><h3><FileText size={17} /> Quotations</h3>{details.quotations.length ? <ul>{details.quotations.map((q) => <li key={q.id}><button className="record-link" onClick={() => onOpenQuotation(q.id)}><b>{q.quotation_number}</b><span>{q.title}</span><small>{q.status} · {money(q.total_minor, q.currency)}</small></button></li>)}</ul> : <p className="empty-copy">No quotations linked to this client.</p>}</section><section className="client-related"><h3><ReceiptText size={17} /> Invoices</h3>{details.invoices.length ? <ul>{details.invoices.map((i) => <li key={i.id}><button className="record-link" onClick={() => onOpenInvoice(i.id)}><b>{i.invoice_number}</b><span>{i.title}</span><small>{i.status} · {money(i.total_minor, i.currency)} · issued {i.issue_date}</small></button></li>)}</ul> : <p className="empty-copy">No invoices linked to this client.</p>}</section><section className="client-related"><h3><BriefcaseBusiness size={17} /> Orders & projects</h3>{details.orders.length ? <ul>{details.orders.map((o) => <li key={o.id}><div className="record-link"><b>{o.order_number}</b><span>{o.title}</span><small>{o.status} · agreed {money(o.agreed_amount_minor, o.currency)} · paid {money(o.paid_minor, o.currency)} · outstanding {money(o.outstanding_minor, o.currency)}{o.due_date ? ` · due ${o.due_date}` : ""}</small></div></li>)}</ul> : <p className="empty-copy">No orders linked to this client.</p>}</section><section className="client-related"><h3>Tasks linked through orders</h3>{details.tasks.length ? <ul>{details.tasks.map((t) => <li key={t.id}><div className="record-link"><b>{t.title}</b><span>{t.order_number}</span><small>{t.status}{t.due_date ? ` · due ${t.due_date}` : ""}</small></div></li>)}</ul> : <p className="empty-copy">No order-linked tasks for this client.</p>}</section></article> : <div className="business-panel client-detail-placeholder"><UserRound size={24} /><h2>Select a client</h2><p>Choose a client from the directory to view its contact details and linked business records.</p></div>}
    </section></div>
  </div>;
}
