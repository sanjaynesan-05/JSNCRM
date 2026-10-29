import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowUp,
  Bold,
  Check,
  Clipboard,
  Copy,
  ExternalLink,
  FileText,
  Image,
  Italic,
  Link2,
  List,
  ListOrdered,
  Mail,
  Maximize2,
  Menu,
  Minimize2,
  Minus,
  Paperclip,
  Plus,
  Rows3,
  Send,
  Smartphone,
  Table2,
  Trash2,
  Underline,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { generateEmailHtml } from "./services/html.service";
import { notifyAuthExpired } from "./services/api/authEvents";
import type {
  AttachmentItem,
  EmailDraft,
  EmailSection,
  EmailTable,
  SectionBlock,
  TemplateId,
  TypographyStyle,
  TypographyTarget,
} from "./types/email";
import logoUrl from "./assets/JSN DESIGN.png";
import SpreadsheetTableEditor from "./components/SpreadsheetTableEditor";

const fonts = [
  '"Proxima Nova", Arial, Helvetica, sans-serif',
  "Georgia, serif",
  "Verdana, sans-serif",
  "Trebuchet MS, sans-serif",
];
const style = (overrides: Partial<TypographyStyle> = {}): TypographyStyle => ({
  fontFamily: fonts[0],
  fontSize: 15,
  fontWeight: 400,
  lineHeight: 1.6,
  letterSpacing: 0,
  textAlign: "left",
  color: "#1a1a1a",
  backgroundColor: "transparent",
  ...overrides,
});
const defaultStyles: Record<TypographyTarget, TypographyStyle> = {
  title: style({
    fontSize: 28,
    fontWeight: 700,
    color: "#000000",
    backgroundColor: "#ffffff",
  }),
  heading: style({ fontSize: 18, fontWeight: 700 }),
  body: style(),
  list: style(),
  table: style(),
  button: style({
    fontSize: 13,
    fontWeight: 700,
    color: "#000000",
    backgroundColor: "#d4af37",
    textAlign: "center",
  }),
  signature: style({ fontSize: 14, fontWeight: 600 }),
};
const newTable = (): EmailTable => ({
  rows: [
    ["Particular", "Details", "Status"],
    ["Vertical Logo", "PNG / SVG / EPS / AF", "Complete"],
    ["Horizontal Logo", "PNG / SVG / EPS / AF", "Complete"],
  ].map((row) => row.map((content) => ({ id: crypto.randomUUID(), content }))),
  header: true,
  align: "left",
  fontSize: 13,
  fontWeight: 400,
  color: "#1a1a1a",
  backgroundColor: "#f5f5f5",
  borderColor: "#d4af37",
  borderWidth: 1,
  cellPadding: 10,
});
const block = (type: SectionBlock["type"]): SectionBlock => ({
  id: crypto.randomUUID(),
  type,
  content: type === "paragraph" ? "Add a paragraph to your email." : "",
  items: type === "list" ? ["First item", "Second item"] : [],
  ordered: false,
  imageUrl: "",
  imageAlt: "",
  ctaLabel: type === "cta" ? "View details" : "",
  ctaUrl: "",
  table: type === "table" ? newTable() : undefined,
});
const initialDraft: EmailDraft = {
  from: "",
  to: "",
  cc: "",
  bcc: "",
  subject: "A considered note from JSN Designs",
  greeting: "Hi there,",
  title: "A considered note",
  body: "Thank you for your time. I wanted to share a thoughtful update with you.",
  sections: [
    {
      id: crypto.randomUUID(),
      heading: "The update",
      content: "",
      bullets: [],
      blocks: [block("paragraph")],
    },
  ],
  closing: "Warmly,",
  signature: "JSN Designs\njsndesigns.com",
  recipientName: "",
  companyName: "",
  documentReference: "",
  issueDate: "",
  attachmentName: "",
  senderName: "",
  businessName: "JSN DESIGNS",
  businessDescription: "Creative Design & Branding Solutions",
  businessContact: "",
  footerContent: "",
  ctaLabel: "",
  ctaUrl: "",
  template: "professional",
  typography: defaultStyles,
};
const formatBytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const recipients = (value: string) =>
  value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
const normalizeDraft = (draft: EmailDraft): EmailDraft => ({
  ...initialDraft,
  ...draft,
  typography: { ...defaultStyles, ...(draft.typography || {}) },
  sections: (draft.sections || []).map((section) => ({
    ...section,
    blocks: section.blocks?.length
      ? section.blocks.map((item) =>
          item.table
            ? {
                ...item,
                table: {
                  ...item.table,
                  rows: item.table.rows.map((row) =>
                    row.map((cell) =>
                      typeof cell === "string"
                        ? { id: crypto.randomUUID(), content: cell }
                        : cell,
                    ),
                  ),
                },
              }
            : item,
        )
      : [block("paragraph")],
  })),
});

export default function EmailStudio() {
  const [draft, setDraft] = useState<EmailDraft>(() => {
    try {
      return normalizeDraft(
        JSON.parse(localStorage.getItem("jsn-mail-draft") || "null") ||
          initialDraft,
      );
    } catch {
      return initialDraft;
    }
  });
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [mode, setMode] = useState<"preview" | "html">("preview");
  const [account, setAccount] = useState("Not connected");
  const [busy, setBusy] = useState<"test" | "send" | null>(null);
  const [sent, setSent] = useState<{
    recipient: string;
    subject: string;
    timestamp: string;
  } | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const html = useMemo(() => generateEmailHtml(draft, logoUrl), [draft]);
  useEffect(() => {
    localStorage.setItem("jsn-mail-draft", JSON.stringify(draft));
  }, [draft]);
  useEffect(() => {
    fetch("/api/email/config")
      .then((r) => { notifyAuthExpired(r); return r.ok ? r.json() : null; })
      .then((d) => d?.gmailUser && setAccount(d.gmailUser))
      .catch(() => undefined);
  }, []);

  const update = (key: keyof EmailDraft, value: string | TemplateId) =>
    setDraft((c) => ({ ...c, [key]: value }));
  const updateSection = (id: string, patch: Partial<EmailSection>) =>
    setDraft((c) => ({
      ...c,
      sections: c.sections.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  const updateBlock = (
    sectionId: string,
    blockId: string,
    patch: Partial<SectionBlock>,
  ) =>
    setDraft((c) => ({
      ...c,
      sections: c.sections.map((s) =>
        s.id === sectionId
          ? {
              ...s,
              blocks: (s.blocks || []).map((b) =>
                b.id === blockId ? { ...b, ...patch } : b,
              ),
            }
          : s,
      ),
    }));
  const addSection = () =>
    setDraft((c) => ({
      ...c,
      sections: [
        ...c.sections,
        {
          id: crypto.randomUUID(),
          heading: "New section",
          content: "",
          bullets: [],
          blocks: [block("paragraph")],
        },
      ],
    }));
  const moveSection = (index: number, direction: -1 | 1) =>
    setDraft((c) => {
      const sections = [...c.sections];
      const next = index + direction;
      if (next < 0 || next >= sections.length) return c;
      [sections[index], sections[next]] = [sections[next], sections[index]];
      return { ...c, sections };
    });
  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const incoming = Array.from(files);
    const bad = incoming.find((f) => f.size > 10 * 1024 * 1024);
    if (bad) {
      toast.error(`${bad.name} is over the 10 MB limit.`);
      return;
    }
    setAttachments((c) => [
      ...c,
      ...incoming.map((f) => ({ id: crypto.randomUUID(), file: f })),
    ]);
  };
  const send = async (kind: "test" | "send") => {
    if ((kind === "send" && !draft.to.trim()) || !draft.subject.trim())
      return toast.error(kind === "test" ? "Add a subject first." : "Add a recipient and subject first.");
    if (kind === "test" && account === "Not connected")
      return toast.error(
        "Gmail is not connected. Configure GMAIL_USER and GMAIL_APP_PASSWORD first.",
      );
    const allRecipients = kind === "test" ? [] : [draft.to, draft.cc, draft.bcc].flatMap(recipients);
    if (kind === "send" && (
      !recipients(draft.to).length ||
      !allRecipients.every((email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ))
      return toast.error(
        "Check the recipient email addresses in To, CC, and BCC.",
      );
    setBusy(kind);
    try {
      const data = new FormData();
      data.append(
        "payload",
        JSON.stringify({ ...draft, to: kind === "test" ? account : draft.to, cc: kind === "test" ? "" : draft.cc, bcc: kind === "test" ? "" : draft.bcc }),
      );
      attachments.forEach(({ file }) => data.append("attachments", file));
      const response = await fetch(`/api/email/${kind}`, {
        method: "POST",
        body: data,
      });
      notifyAuthExpired(response);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to send email");
      const timestamp = new Date().toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      });
      setSent({
        recipient: kind === "test" ? account : draft.to,
        subject: draft.subject,
        timestamp,
      });
      toast.success(
        kind === "test"
          ? "Test email sent to " + account
          : "Email sent successfully",
      );
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to send email",
      );
    } finally {
      setBusy(null);
    }
  };
  const clearDraft = () => {
    setDraft(initialDraft);
    setAttachments([]);
    toast.success("Draft cleared");
  };

  return (
    <div className="app-shell">
      {/* ── Top bar ─────────────────────────────────────── */}
      <header className="topbar">
        <img className="brand-logo" src={logoUrl} alt="JSN Designs logo" />
        <div className="brand-divider" />
        <div>
          <div className="brand-name">MAIL STUDIO</div>
          <div className="brand-subtitle">Internal email builder</div>
        </div>
        <div className="topbar-spacer" />
        <div className="connection">
          <span
            className={`status-dot ${account === "Not connected" ? "offline" : ""}`}
          />
          <span className="connection-label">
            {account === "Not connected" ? (
              "Gmail not connected"
            ) : (
              <a
                href={`mailto:${account}`}
                className="account-link"
                title="Sending from this address"
              >
                {account}
              </a>
            )}
          </span>
        </div>
      </header>

      {/* ── Main workspace ──────────────────────────────── */}
      <main className="workspace">
        {/* Editor column */}
        <section className="editor-column">
          <div className="section-heading">
            <div>
              <span className="eyebrow">Compose / 01</span>
              <h1>Build an email</h1>
            </div>
            <button
              className="text-button"
              onClick={clearDraft}
              aria-label="Clear current draft"
            >
              Clear draft <X size={14} />
            </button>
          </div>

          {/* Account */}
          <div className="panel account-panel">
            <div className="panel-icon">
              <Mail size={16} />
            </div>
            <div>
              <div className="field-label">Sending from</div>
              <div className="account-value">
                {account === "Not connected" ? (
                  "Connect Gmail via GMAIL_USER + GMAIL_APP_PASSWORD in .env"
                ) : (
                  <a href={`mailto:${account}`} className="account-link">
                    {account}
                  </a>
                )}
              </div>
            </div>
            <span className="connected-pill">
              <Check size={12} />{" "}
              {account === "Not connected" ? "Offline" : "Connected"}
            </span>
          </div>

          {/* Recipients */}
          <Panel title="Recipients" kicker="Comma separated">
            <div className="field-grid">
              <Field
                label="To"
                value={draft.to}
                placeholder="name@company.com"
                onChange={(v) => update("to", v)}
                required
              />
              <Field
                label="CC"
                value={draft.cc}
                placeholder="Optional"
                onChange={(v) => update("cc", v)}
              />
              <Field
                label="BCC"
                value={draft.bcc}
                placeholder="Optional"
                onChange={(v) => update("bcc", v)}
              />
              <Field
                label="Subject"
                value={draft.subject}
                onChange={(v) => update("subject", v)}
                required
                full
              />
            </div>
          </Panel>

          {/* Message */}
          <Panel title="Message" kicker="Rich text supported">
            <div className="field-stack">
              <Field
                label="Greeting"
                value={draft.greeting}
                onChange={(v) => update("greeting", v)}
              />
              <Field
                label="Email title"
                value={draft.title}
                onChange={(v) => update("title", v)}
              />
              <RichTextEditor
                label="Body"
                value={draft.body}
                onChange={(v) => update("body", v)}
              />
            </div>
          </Panel>

          <Panel title="Document details" kicker="Optional">
            <div className="field-grid">
              <Field label="Recipient name" value={draft.recipientName || ""} onChange={(v) => update("recipientName", v)} />
              <Field label="Company name" value={draft.companyName || ""} onChange={(v) => update("companyName", v)} />
              <Field label="Reference number" value={draft.documentReference || ""} onChange={(v) => update("documentReference", v)} />
              <Field label="Issue date" value={draft.issueDate || ""} onChange={(v) => update("issueDate", v)} />
              <Field label="Attachment label" value={draft.attachmentName || ""} placeholder="Added automatically when files are attached" onChange={(v) => update("attachmentName", v)} full />
            </div>
          </Panel>

          {/* Sections */}
          <Panel
            title="Sections"
            action={
              <button className="small-button" onClick={addSection}>
                <Plus size={14} /> Add section
              </button>
            }
          >
            {draft.sections.length === 0 && (
              <p className="empty-state">
                No sections yet. Click "Add section" to build structured
                content.
              </p>
            )}
            {draft.sections.map((section, index) => (
              <SectionEditor
                key={section.id}
                section={section}
                index={index}
                total={draft.sections.length}
                updateSection={updateSection}
                updateBlock={updateBlock}
                moveSection={moveSection}
                removeSection={(id) =>
                  setDraft((c) => ({
                    ...c,
                    sections: c.sections.filter((s) => s.id !== id),
                  }))
                }
              />
            ))}
          </Panel>

          {/* Sign-off */}
          <Panel title="Sign-off">
            <div className="field-stack">
              <Field
                label="Closing"
                value={draft.closing}
                onChange={(v) => update("closing", v)}
              />
              <TextArea
                label="Signature"
                value={draft.signature}
                onChange={(v) => update("signature", v)}
                rows={2}
              />
              <div className="field-grid">
                <Field label="Sender name" value={draft.senderName || ""} onChange={(v) => update("senderName", v)} />
                <Field label="Business name" value={draft.businessName || ""} onChange={(v) => update("businessName", v)} />
                <Field label="Business description" value={draft.businessDescription || ""} onChange={(v) => update("businessDescription", v)} />
                <Field label="Business contact" value={draft.businessContact || ""} placeholder="Optional verified contact details" onChange={(v) => update("businessContact", v)} />
              </div>
            </div>
            <div className="cta-row">
              <div className="cta-heading">
                <Link2 size={15} /> Optional CTA button
              </div>
              <div className="field-grid">
                <Field
                  label="Button label"
                  value={draft.ctaLabel}
                  placeholder="View project"
                  onChange={(v) => update("ctaLabel", v)}
                />
                <Field
                  label="Destination URL"
                  value={draft.ctaUrl}
                  placeholder="https://"
                  onChange={(v) => update("ctaUrl", v)}
                />
              </div>
            </div>
          </Panel>

          {/* Attachments */}
          <Panel title="Attachments" kicker="10 MB per file">
            <label className="upload-zone" htmlFor="file-input">
              <Upload size={19} />
              <span>
                <strong>Drop files here</strong> or browse
              </span>
              <small>Multiple attachments supported</small>
              <input
                id="file-input"
                type="file"
                multiple
                onChange={(e) => handleFiles(e.target.files)}
              />
            </label>
            {attachments.length > 0 && (
              <div className="attachment-list" role="list">
                {attachments.map(({ id, file }) => (
                  <div className="attachment" key={id} role="listitem">
                    <div className="file-icon">
                      <FileText size={16} />
                    </div>
                    <div>
                      <strong>{file.name}</strong>
                      <small>{formatBytes(file.size)}</small>
                    </div>
                    <button
                      className="mini-icon danger"
                      aria-label={`Remove ${file.name}`}
                      onClick={() =>
                        setAttachments((c) => c.filter((a) => a.id !== id))
                      }
                    >
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </section>

        {/* Preview column */}
        <section
          className={`preview-column${fullscreen ? " preview-fullscreen" : ""}`}
          aria-label="Email preview"
        >
          <div className="preview-header">
            <div>
              <span className="eyebrow">Output / 02</span>
              <h2>Live preview</h2>
            </div>
            <div className="preview-actions">
              <div
                className="device-toggle"
                role="group"
                aria-label="Preview device"
              >
                <button
                  className={device === "desktop" ? "active" : ""}
                  onClick={() => setDevice("desktop")}
                  aria-pressed={device === "desktop"}
                >
                  <Menu size={14} /> Desktop
                </button>
                <button
                  className={device === "mobile" ? "active" : ""}
                  onClick={() => setDevice("mobile")}
                  aria-pressed={device === "mobile"}
                >
                  <Smartphone size={14} /> Mobile
                </button>
              </div>
              <button
                className="icon-text-button"
                onClick={() => setFullscreen((v) => !v)}
                aria-label={
                  fullscreen ? "Exit fullscreen" : "Fullscreen preview"
                }
              >
                {fullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                {fullscreen ? "Close" : "Expand"}
              </button>
            </div>
          </div>

          <div className="preview-panel">
            <div className="preview-toolbar">
              <div className="mode-tabs" role="tablist">
                <button
                  role="tab"
                  aria-selected={mode === "preview"}
                  className={mode === "preview" ? "active" : ""}
                  onClick={() => setMode("preview")}
                >
                  Preview
                </button>
                <button
                  role="tab"
                  aria-selected={mode === "html"}
                  className={mode === "html" ? "active" : ""}
                  onClick={() => setMode("html")}
                >
                  HTML
                </button>
              </div>
              <div className="preview-meta">
                <span className={html.length > 90 * 1024 ? "size-warning" : ""}>
                  HTML: {(html.length / 1024).toFixed(1)} KB
                </span>
                <button
                  className="copy-button"
                  onClick={() => {
                    navigator.clipboard.writeText(html);
                    toast.success("HTML copied to clipboard");
                  }}
                >
                  <Clipboard size={14} /> Copy HTML
                </button>
              </div>
            </div>

            {/* Preview stage — natural height, no fixed iframe, no nested scroll */}
            <div className={`preview-stage ${device}`}>
              <div className="preview-frame">
                {mode === "preview" ? (
                  <PreviewFrame html={html} />
                ) : (
                  <pre className="html-source">{html}</pre>
                )}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ── Action bar ──────────────────────────────────── */}
      <footer className="actionbar">
        <div className="footer-note">
          <Paperclip size={14} />
          {attachments.length} attachment{attachments.length === 1 ? "" : "s"}
          <span className="footer-divider" />
          Autosaves locally
        </div>
        <div className="actions">
          <button
            className="secondary-button"
            onClick={() => {
              localStorage.setItem("jsn-mail-draft", JSON.stringify(draft));
              toast.success("Draft saved");
            }}
          >
            Save draft
          </button>
          <button
            className="secondary-button"
            onClick={() => send("test")}
            disabled={busy !== null}
            aria-busy={busy === "test"}
          >
            <Send size={14} /> {busy === "test" ? "Sending…" : "Send test"}
          </button>
          <button
            className="primary-button"
            onClick={() => send("send")}
            disabled={busy !== null}
            aria-busy={busy === "send"}
          >
            <Send size={14} /> {busy === "send" ? "Sending…" : "Send email"}
          </button>
        </div>
      </footer>

      {/* ── Success overlay ─────────────────────────────── */}
      {sent && (
        <div
          className="success-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="success-title"
        >
          <div className="success-card">
            <button
              className="close-success"
              onClick={() => setSent(null)}
              aria-label="Close"
            >
              <X size={16} />
            </button>
            <div className="success-icon">
              <Check size={24} />
            </div>
            <span className="eyebrow">Delivered</span>
            <h2 id="success-title">Email sent</h2>
            <p>Your message is on its way.</p>
            <div className="sent-summary">
              <span>Recipient</span>
              <strong>{sent.recipient}</strong>
              <span>Subject</span>
              <strong>{sent.subject}</strong>
              <span>Timestamp</span>
              <strong>{sent.timestamp}</strong>
            </div>
            <button
              className="primary-button full"
              onClick={() => setSent(null)}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Preview frame that grows with content, no fixed height ──────────────────
function PreviewFrame({ html }: { html: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) return;
    doc.open();
    doc.write(html);
    doc.close();

    const resize = () => {
      const body = doc.body;
      const root = doc.documentElement;
      if (!body || !root) return;
      // expand iframe to full content height
      const h = Math.max(
        body.scrollHeight,
        body.offsetHeight,
        root.scrollHeight,
        root.offsetHeight,
      );
      iframe.style.height = `${h}px`;
    };

    // initial resize + resize on images/fonts loading
    resize();
    const observer = new ResizeObserver(resize);
    if (doc.body) observer.observe(doc.body);
    iframe.contentWindow?.addEventListener("load", resize);
    return () => {
      observer.disconnect();
      iframe.contentWindow?.removeEventListener("load", resize);
    };
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      title="Email preview"
      style={{
        border: "none",
        width: "100%",
        height: "400px",
        display: "block",
        background: "#ffffff",
      }}
      sandbox="allow-same-origin"
    />
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────
function Panel({
  title,
  kicker,
  action,
  children,
}: {
  title: string;
  kicker?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="panel">
      <div className="panel-title">
        <span>{title}</span>
        <span className="panel-right">
          {action}
          {kicker && <span className="panel-kicker">{kicker}</span>}
        </span>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
  required,
  full,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className={`field${full ? " full" : ""}`}>
      <label>
        {label}
        {required && (
          <span className="required" aria-hidden="true">
            {" "}
            *
          </span>
        )}
      </label>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-required={required}
      />
    </div>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
      />
    </div>
  );
}

function RichTextEditor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const editor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editor.current && editor.current.innerHTML !== value)
      editor.current.innerHTML = value;
  }, [value]);

  const command = (name: string, argument?: string) => {
    editor.current?.focus();
    document.execCommand(name, false, argument);
    if (editor.current) onChange(editor.current.innerHTML);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!event.ctrlKey && !event.metaKey) return;
    const key = event.key.toLowerCase();
    if (["b", "i", "u"].includes(key)) {
      event.preventDefault();
      command(key === "b" ? "bold" : key === "i" ? "italic" : "underline");
    }
  };

  return (
    <div className="rich-field">
      <label>{label}</label>
      <div
        className="rich-toolbar"
        role="toolbar"
        aria-label={`${label} formatting`}
      >
        <button
          type="button"
          title="Bold (Ctrl+B)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("bold")}
        >
          <Bold size={14} />
        </button>
        <button
          type="button"
          title="Italic (Ctrl+I)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("italic")}
        >
          <Italic size={14} />
        </button>
        <button
          type="button"
          title="Underline (Ctrl+U)"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("underline")}
        >
          <Underline size={14} />
        </button>
        <button
          type="button"
          title="Bulleted list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("insertUnorderedList")}
        >
          <List size={14} />
        </button>
        <button
          type="button"
          title="Numbered list"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("insertOrderedList")}
        >
          <ListOrdered size={14} />
        </button>
        <button
          type="button"
          title="Align left"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("justifyLeft")}
        >
          <AlignLeft size={14} />
        </button>
        <button
          type="button"
          title="Align center"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("justifyCenter")}
        >
          <AlignCenter size={14} />
        </button>
        <button
          type="button"
          title="Align right"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => command("justifyRight")}
        >
          <AlignRight size={14} />
        </button>
        <select
          aria-label="Text size"
          defaultValue="3"
          onChange={(e) => command("fontSize", e.target.value)}
        >
          <option value="2">Small</option>
          <option value="3">Normal</option>
          <option value="4">Large</option>
          <option value="5">XL</option>
        </select>
        <input
          aria-label="Text color"
          type="color"
          defaultValue="#1a1a1a"
          title="Text color"
          onChange={(e) => command("foreColor", e.target.value)}
        />
        <button
          type="button"
          title="Add link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            const url = window.prompt("Paste a link URL (https://...)");
            if (url && /^https?:\/\//.test(url)) command("createLink", url);
            else if (url) toast.error("URL must start with https://");
          }}
        >
          <Link2 size={14} />
        </button>
      </div>
      <div
        ref={editor}
        className="rich-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={(e) => onChange(e.currentTarget.innerHTML)}
        onKeyDown={handleKeyDown}
        role="textbox"
        aria-multiline="true"
        aria-label={label}
        data-placeholder="Start writing…"
      />
    </div>
  );
}

function TypographyControls({
  value,
  update,
}: {
  value: TypographyStyle;
  update: (key: keyof TypographyStyle, value: string | number) => void;
}) {
  return (
    <div className="type-controls">
      <div className="field">
        <label>Font family</label>
        <select
          value={value.fontFamily}
          onChange={(e) => update("fontFamily", e.target.value)}
        >
          {fonts.map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </div>
      <div className="control-grid">
        <Field
          label="Size"
          value={String(value.fontSize)}
          onChange={(v) => update("fontSize", Number(v) || 1)}
        />
        <Field
          label="Weight"
          value={String(value.fontWeight)}
          onChange={(v) => update("fontWeight", Number(v) || 400)}
        />
        <Field
          label="Line height"
          value={String(value.lineHeight)}
          onChange={(v) => update("lineHeight", Number(v) || 1)}
        />
        <Field
          label="Letter spacing"
          value={String(value.letterSpacing)}
          onChange={(v) => update("letterSpacing", Number(v) || 0)}
        />
      </div>
      <div className="control-grid">
        <ColorField
          label="Text color"
          value={value.color}
          onChange={(v) => update("color", v)}
        />
        <ColorField
          label="Background"
          value={value.backgroundColor}
          onChange={(v) => update("backgroundColor", v)}
        />
      </div>
      <div className="align-control">
        <span>Alignment</span>
        {(["left", "center", "right"] as const).map((align) => (
          <button
            key={align}
            className={value.textAlign === align ? "active" : ""}
            onClick={() => update("textAlign", align)}
            aria-label={`Align ${align}`}
          >
            {align === "left" ? (
              <AlignLeft size={14} />
            ) : align === "center" ? (
              <AlignCenter size={14} />
            ) : (
              <AlignRight size={14} />
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const safe = value === "transparent" || !value ? "#ffffff" : value;
  return (
    <div className="color-field">
      <label>{label}</label>
      <div>
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="transparent"
        />
      </div>
    </div>
  );
}

function SectionEditor({
  section,
  index,
  total,
  updateSection,
  updateBlock,
  moveSection,
  removeSection,
}: {
  section: EmailSection;
  index: number;
  total: number;
  updateSection: (id: string, patch: Partial<EmailSection>) => void;
  updateBlock: (
    sectionId: string,
    blockId: string,
    patch: Partial<SectionBlock>,
  ) => void;
  moveSection: (index: number, direction: -1 | 1) => void;
  removeSection: (id: string) => void;
}) {
  const blocks = section.blocks || [];
  const duplicate = () =>
    updateSection(section.id, {
      blocks: [
        ...blocks,
        ...blocks.map((b) => ({ ...b, id: crypto.randomUUID() })),
      ],
    });

  return (
    <div className="dynamic-section">
      <div className="section-tools">
        <span className="number-chip">
          {String(index + 1).padStart(2, "0")}
        </span>
        <div className="tool-spacer" />
        <button
          className="mini-icon"
          title="Move up"
          onClick={() => moveSection(index, -1)}
          disabled={index === 0}
          aria-label="Move section up"
        >
          <ArrowUp size={13} />
        </button>
        <button
          className="mini-icon"
          title="Move down"
          onClick={() => moveSection(index, 1)}
          disabled={index === total - 1}
          aria-label="Move section down"
        >
          <ArrowDown size={13} />
        </button>
        <button
          className="mini-icon"
          title="Duplicate section"
          onClick={duplicate}
          aria-label="Duplicate section"
        >
          <Copy size={13} />
        </button>
        <button
          className="mini-icon danger"
          title="Delete section"
          onClick={() => removeSection(section.id)}
          aria-label="Delete section"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <Field
        label="Heading"
        value={section.heading}
        onChange={(v) => updateSection(section.id, { heading: v })}
      />
      <div className="block-list">
        {blocks.map((item) => (
          <BlockEditor
            key={item.id}
            block={item}
            update={(patch) => updateBlock(section.id, item.id, patch)}
            remove={() =>
              updateSection(section.id, {
                blocks: blocks.filter((b) => b.id !== item.id),
              })
            }
          />
        ))}
      </div>
      <div className="block-add">
        <select
          value=""
          aria-label="Add content block"
          onChange={(e) => {
            if (e.target.value) {
              updateSection(section.id, {
                blocks: [
                  ...blocks,
                  block(e.target.value as SectionBlock["type"]),
                ],
              });
              e.target.value = "";
            }
          }}
        >
          <option value="">Add content block…</option>
          <option value="paragraph">Paragraph</option>
          <option value="list">Bullet / numbered list</option>
          <option value="image">Image</option>
          <option value="cta">CTA button</option>
          <option value="divider">Divider</option>
          <option value="table">Spreadsheet table</option>
        </select>
        <Plus size={14} />
      </div>
    </div>
  );
}

function BlockEditor({
  block: item,
  update,
  remove,
}: {
  block: SectionBlock;
  update: (patch: Partial<SectionBlock>) => void;
  remove: () => void;
}) {
  const typeIcon =
    item.type === "table" ? (
      <Table2 size={14} />
    ) : item.type === "image" ? (
      <Image size={14} />
    ) : item.type === "cta" ? (
      <ExternalLink size={14} />
    ) : item.type === "divider" ? (
      <Minus size={14} />
    ) : (
      <Rows3 size={14} />
    );

  return (
    <div className="block-editor">
      <div className="block-header">
        <span>
          {typeIcon} {item.type}
        </span>
        <button
          className="mini-icon danger"
          onClick={remove}
          aria-label={`Remove ${item.type} block`}
        >
          <X size={13} />
        </button>
      </div>

      {item.type === "paragraph" && (
        <RichTextEditor
          label="Paragraph"
          value={item.content}
          onChange={(v) => update({ content: v })}
        />
      )}

      {item.type === "list" && (
        <>
          <div className="field">
            <label>List style</label>
            <select
              value={item.ordered ? "numbered" : "bullets"}
              onChange={(e) =>
                update({ ordered: e.target.value === "numbered" })
              }
            >
              <option value="bullets">Bullets</option>
              <option value="numbered">Numbered</option>
            </select>
          </div>
          {/* Each list item is a separate rich text editor row */}
          <div className="list-items-editor">
            {item.items.map((itemText, idx) => (
              <div key={idx} className="list-item-row">
                <input
                  value={itemText}
                  aria-label={`List item ${idx + 1}`}
                  onChange={(e) => {
                    const next = [...item.items];
                    next[idx] = e.target.value;
                    update({ items: next });
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      const next = [...item.items];
                      next.splice(idx + 1, 0, "");
                      update({ items: next });
                    }
                    if (
                      e.key === "Backspace" &&
                      !itemText &&
                      item.items.length > 1
                    ) {
                      e.preventDefault();
                      const next = item.items.filter((_, i) => i !== idx);
                      update({ items: next });
                    }
                  }}
                />
                <button
                  className="mini-icon danger"
                  aria-label="Remove item"
                  type="button"
                  onClick={() =>
                    update({ items: item.items.filter((_, i) => i !== idx) })
                  }
                  disabled={item.items.length <= 1}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              className="small-button"
              type="button"
              onClick={() => update({ items: [...item.items, ""] })}
            >
              <Plus size={12} /> Add item
            </button>
          </div>
        </>
      )}

      {item.type === "image" && (
        <div className="field-grid">
          <Field
            label="Image URL"
            value={item.imageUrl}
            placeholder="https://example.com/image.png"
            onChange={(v) => update({ imageUrl: v })}
          />
          <Field
            label="Alt text"
            value={item.imageAlt}
            placeholder="Image description"
            onChange={(v) => update({ imageAlt: v })}
          />
        </div>
      )}

      {item.type === "cta" && (
        <div className="field-grid">
          <Field
            label="Button label"
            value={item.ctaLabel}
            placeholder="View details"
            onChange={(v) => update({ ctaLabel: v })}
          />
          <Field
            label="URL"
            value={item.ctaUrl}
            placeholder="https://"
            onChange={(v) => update({ ctaUrl: v })}
          />
        </div>
      )}

      {item.type === "table" && item.table && (
        <SpreadsheetTableEditor
          value={item.table}
          update={(t) => update({ table: t })}
        />
      )}
    </div>
  );
}

// suppress unused import warning
void TypographyControls;
