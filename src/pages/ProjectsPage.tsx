import { useCallback, useEffect, useState } from "react";
import {
  Check,
  CircleDollarSign,
  ClipboardList,
  Eye,
  Plus,
  ReceiptText,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { api, jsonRequest } from "../services/api/apiClient";
import type {
  Client,
  Order,
  OrderStatus,
  Payment,
  Priority,
  Task,
  TaskStatus,
} from "../types/business";
import { localDate } from "../services/date";

const money = (minor: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    minor / 100,
  );
const day = () => localDate();
const orderStatuses: OrderStatus[] = [
  "new",
  "confirmed",
  "in_progress",
  "client_review",
  "revisions",
  "ready_for_delivery",
  "delivered",
  "on_hold",
  "cancelled",
  "closed",
];
const taskStatuses: TaskStatus[] = [
  "pending",
  "in_progress",
  "completed",
  "cancelled",
];
const priorities: Priority[] = ["low", "normal", "high", "urgent"];

export default function ProjectsPage({ onClients }: { onClients: (clientId?: string) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [orderForm, setOrderForm] = useState(false);
  const [taskForm, setTaskForm] = useState(false);
  const [orderDraft, setOrderDraft] = useState({
    client_id: "",
    title: "",
    description: "",
    requirements: "",
    amount: "0.00",
    priority: "normal" as Priority,
    due_date: "",
  });
  const [taskDraft, setTaskDraft] = useState({
    order_id: "",
    title: "",
    description: "",
    priority: "normal" as Priority,
    due_date: "",
  });
  const [activeOrder, setActiveOrder] = useState<string | null>(null);
  const [detailsOrderId, setDetailsOrderId] = useState<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState({
    amount: "",
    payment_date: day(),
    payment_method: "",
    reference: "",
    notes: "",
  });
  const [payments, setPayments] = useState<Payment[]>([]);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [o, t, c] = await Promise.all([
        api<Order[]>("/api/orders"),
        api<Task[]>("/api/tasks"),
        api<Client[]>("/api/clients"),
      ]);
      setOrders(o);
      setTasks(t);
      setClients(c);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "Unable to load projects.";
      setError(message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const createOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api(
        "/api/orders",
        jsonRequest("POST", {
          client_id: orderDraft.client_id,
          title: orderDraft.title.trim(),
          description: orderDraft.description.trim(),
          requirements: orderDraft.requirements.trim(),
          agreed_amount_minor: Math.round(Number(orderDraft.amount) * 100),
          priority: orderDraft.priority,
          due_date: orderDraft.due_date || null,
        }),
      );
      toast.success("Project order created.");
      setOrderForm(false);
      setOrderDraft({
        client_id: clients[0]?.id || "",
        title: "",
        description: "",
        requirements: "",
        amount: "0.00",
        priority: "normal",
        due_date: "",
      });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to create order.");
    } finally {
      setSaving(false);
    }
  };
  const createTask = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api(
        "/api/tasks",
        jsonRequest("POST", {
          order_id: taskDraft.order_id || null,
          title: taskDraft.title.trim(),
          description: taskDraft.description.trim(),
          priority: taskDraft.priority,
          due_date: taskDraft.due_date || null,
        }),
      );
      toast.success("Task saved.");
      setTaskForm(false);
      setTaskDraft({
        order_id: "",
        title: "",
        description: "",
        priority: "normal",
        due_date: "",
      });
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to create task.");
    } finally {
      setSaving(false);
    }
  };
  const updateOrder = async (order: Order, status: OrderStatus) => {
    try {
      await api(
        `/api/orders/${order.id}/status`,
        jsonRequest("PATCH", { status }),
      );
      toast.success(`Order marked ${status.replace(/_/g, " ")}.`);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to update order.");
    }
  };
  const updateTask = async (task: Task, status: TaskStatus) => {
    try {
      await api(
        `/api/tasks/${task.id}/status`,
        jsonRequest("PATCH", { status }),
      );
      toast.success("Task updated.");
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to update task.");
    }
  };
  const togglePayments = async (order: Order) => {
    if (activeOrder === order.id) {
      setActiveOrder(null);
      return;
    }
    setActiveOrder(order.id);
    setPaymentDraft({
      amount: "",
      payment_date: day(),
      payment_method: "",
      reference: "",
      notes: "",
    });
    setPaymentLoading(true);
    try {
      setPayments(await api<Payment[]>(`/api/orders/${order.id}/payments`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to load payments.");
    } finally {
      setPaymentLoading(false);
    }
  };
  const recordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrder) return;
    setSaving(true);
    try {
      await api(
        `/api/orders/${activeOrder}/payments`,
        jsonRequest("POST", {
          amount_minor: Math.round(Number(paymentDraft.amount) * 100),
          payment_date: paymentDraft.payment_date,
          payment_method: paymentDraft.payment_method.trim(),
          reference: paymentDraft.reference.trim(),
          notes: paymentDraft.notes.trim(),
        }),
      );
      toast.success("Payment recorded.");
      setPaymentDraft({
        ...paymentDraft,
        amount: "",
        reference: "",
        notes: "",
      });
      await refresh();
      setPayments(await api<Payment[]>(`/api/orders/${activeOrder}/payments`));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Unable to record payment.");
    } finally {
      setSaving(false);
    }
  };
  const reversePayment=async(payment:Payment)=>{
    if(!activeOrder||payment.reversed_at)return;
    const reason=window.prompt("Reason for reversing this full payment. This records an accounting correction; it does not send money back to the customer.");
    if(reason===null)return;
    if(reason.trim().length<3){toast.error("Enter a reason with at least 3 characters.");return;}
    if(!window.confirm(`Reverse ${money(payment.amount_minor)} from this order and any linked invoice?`))return;
    try{
      await api(`/api/orders/${activeOrder}/payments/${payment.id}/reverse`,jsonRequest("POST",{reason:reason.trim()}));
      await refresh();
      setPayments(await api<Payment[]>(`/api/orders/${activeOrder}/payments`));
      toast.success("Payment reversal recorded.");
    }catch(e){toast.error(e instanceof Error?e.message:"Unable to reverse payment.");}
  };

  return (
    <>
      <div className="workflow-toolbar">
        <div>
          <span>
            {orders.length} order{orders.length === 1 ? "" : "s"} ·{" "}
            {
              tasks.filter(
                (t) => t.status === "pending" || t.status === "in_progress",
              ).length
            }{" "}
            open tasks
          </span>
        </div>
        <div>
          <button
            className="secondary-button"
            onClick={() => setTaskForm((v) => !v)}
          >
            <ClipboardList size={14} /> Add task
          </button>
          <button
            className="studio-button"
            onClick={() => {
              setOrderDraft({ ...orderDraft, client_id: clients[0]?.id || "" });
              setOrderForm((v) => !v);
            }}
            disabled={!clients.length}
          >
            <Plus size={14} /> New order
          </button>
        </div>
      </div>
      {!clients.length && !loading && (
        <div className="workflow-note">
          Add a client before creating an order.{" "}
          <button className="inline-link" onClick={() => onClients()}>
            Open Clients
          </button>
        </div>
      )}
      {error && (
        <div className="workflow-error">
          {error}
          <button onClick={() => void refresh()}>Retry</button>
        </div>
      )}
      {orderForm && (
        <form
          className="business-panel workflow-inline-form"
          onSubmit={createOrder}
        >
          <header>
            <h2>New project order</h2>
            <button
              type="button"
              className="icon-action"
              onClick={() => setOrderForm(false)}
              aria-label="Close"
            >
              <X size={17} />
            </button>
          </header>
          <div className="workflow-form-grid">
            <label>
              Client
              <select
                required
                value={orderDraft.client_id}
                onChange={(e) =>
                  setOrderDraft({ ...orderDraft, client_id: e.target.value })
                }
              >
                <option value="">Choose client</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Project title
              <input
                required
                maxLength={200}
                value={orderDraft.title}
                onChange={(e) =>
                  setOrderDraft({ ...orderDraft, title: e.target.value })
                }
              />
            </label>
            <label>
              Agreed amount (₹)
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={orderDraft.amount}
                onChange={(e) =>
                  setOrderDraft({ ...orderDraft, amount: e.target.value })
                }
              />
            </label>
            <label>
              Priority
              <select
                value={orderDraft.priority}
                onChange={(e) =>
                  setOrderDraft({
                    ...orderDraft,
                    priority: e.target.value as Priority,
                  })
                }
              >
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input
                type="date"
                value={orderDraft.due_date}
                onChange={(e) =>
                  setOrderDraft({ ...orderDraft, due_date: e.target.value })
                }
              />
            </label>
            <label className="wide">
              Description
              <textarea
                rows={2}
                value={orderDraft.description}
                onChange={(e) =>
                  setOrderDraft({ ...orderDraft, description: e.target.value })
                }
              />
            </label>
            <label className="wide">
              Requirements
              <textarea
                rows={3}
                value={orderDraft.requirements}
                onChange={(e) =>
                  setOrderDraft({ ...orderDraft, requirements: e.target.value })
                }
              />
            </label>
          </div>
          <footer>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setOrderForm(false)}
            >
              Cancel
            </button>
            <button className="studio-button" disabled={saving}>
              <Plus size={14} />
              {saving ? "Saving…" : "Create order"}
            </button>
          </footer>
        </form>
      )}
      {taskForm && (
        <form
          className="business-panel workflow-inline-form"
          onSubmit={createTask}
        >
          <header>
            <h2>New task</h2>
            <button
              type="button"
              className="icon-action"
              onClick={() => setTaskForm(false)}
              aria-label="Close"
            >
              <X size={17} />
            </button>
          </header>
          <div className="workflow-form-grid">
            <label>
              Task title
              <input
                required
                maxLength={200}
                value={taskDraft.title}
                onChange={(e) =>
                  setTaskDraft({ ...taskDraft, title: e.target.value })
                }
              />
            </label>
            <label>
              Project
              <select
                value={taskDraft.order_id}
                onChange={(e) =>
                  setTaskDraft({ ...taskDraft, order_id: e.target.value })
                }
              >
                <option value="">Independent task</option>
                {orders
                  .filter((o) => !["closed", "cancelled"].includes(o.status))
                  .map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.order_number} · {o.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Priority
              <select
                value={taskDraft.priority}
                onChange={(e) =>
                  setTaskDraft({
                    ...taskDraft,
                    priority: e.target.value as Priority,
                  })
                }
              >
                {priorities.map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              Due date
              <input
                type="date"
                value={taskDraft.due_date}
                onChange={(e) =>
                  setTaskDraft({ ...taskDraft, due_date: e.target.value })
                }
              />
            </label>
            <label className="wide">
              Description
              <textarea
                rows={2}
                value={taskDraft.description}
                onChange={(e) =>
                  setTaskDraft({ ...taskDraft, description: e.target.value })
                }
              />
            </label>
          </div>
          <footer>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setTaskForm(false)}
            >
              Cancel
            </button>
            <button className="studio-button" disabled={saving}>
              <Plus size={14} />
              {saving ? "Saving…" : "Create task"}
            </button>
          </footer>
        </form>
      )}
      {loading ? (
        <div className="business-panel">Loading projects and tasks…</div>
      ) : error ? null : (
        <>
          <section className="workflow-section">
            <div className="workflow-section-title">
              <div>
                <h2>Orders & projects</h2>
                <p>
                  Update delivery status and record payments against the
                  outstanding balance.
                </p>
              </div>
            </div>
            {orders.length ? (
              <div className="business-panel table-wrap">
                <table className="records-table workflow-table">
                  <thead>
                    <tr>
                      <th>Reference / project</th>
                      <th>Client</th>
                      <th>Status</th>
                      <th>Agreed</th>
                      <th>Paid</th>
                      <th>Due</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <b>{o.order_number}</b>
                          <small className="table-subline">
                            {o.title}
                            {o.priority !== "normal"
                              ? ` · ${o.priority} priority`
                              : ""}
                          </small>
                        </td>
                        <td>{o.client_name}</td>
                        <td>
                          <select
                            aria-label={`Status for ${o.order_number}`}
                            value={o.status}
                            onChange={(e) =>
                              void updateOrder(o, e.target.value as OrderStatus)
                            }
                          >
                            {orderStatuses.map((s) => (
                              <option key={s} value={s}>
                                {s.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td>{money(o.agreed_amount_minor)}</td>
                        <td>{money(o.paid_minor)}</td>
                        <td>{o.due_date || "—"}</td>
                        <td>
                          <div className="row-actions">
                            <button
                              className="icon-action"
                              title="View project details"
                              aria-label={`View ${o.title} details`}
                              onClick={() =>
                                setDetailsOrderId(
                                  detailsOrderId === o.id ? null : o.id,
                                )
                              }
                            >
                              <Eye size={15} />
                            </button>
                            <button
                              className="secondary-button compact-button"
                              onClick={() => void togglePayments(o)}
                            >
                              <ReceiptText size={14} />
                              {activeOrder === o.id ? "Close" : "Payments"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="workflow-empty">
                No orders or projects yet. Create an order here, or accept and
                convert a quotation.
              </div>
            )}
            {detailsOrderId &&
              (() => {
                const order = orders.find((item) => item.id === detailsOrderId);
                return order ? (
                  <section className="business-panel project-details-panel">
                    <header>
                      <div>
                        <span className="business-eyebrow">
                          {order.order_number}
                        </span>
                        <h3>{order.title}</h3>
                      </div>
                      <button
                        className="icon-action"
                        onClick={() => setDetailsOrderId(null)}
                        aria-label="Close project details"
                      >
                        <X size={17} />
                      </button>
                    </header>
                    {order.description && (
                      <p>
                        <b>Description:</b> {order.description}
                      </p>
                    )}
                    {order.requirements && (
                      <p className="project-requirements">
                        <b>Requirements:</b>
                        <br />
                        {order.requirements}
                      </p>
                    )}
                    <div className="project-detail-meta">
                      <span>
                          Client <button className="inline-link" onClick={() => onClients(order.client_id)}>{order.client_name}</button>
                      </span>
                      <span>
                        Priority <b>{order.priority}</b>
                      </span>
                      <span>
                        Order date <b>{order.order_date}</b>
                      </span>
                      <span>
                        Due date <b>{order.due_date || "Not set"}</b>
                      </span>
                      {order.delivered_at && (
                        <span>
                          Delivered{" "}
                          <b>
                            {new Date(order.delivered_at).toLocaleDateString()}
                          </b>
                        </span>
                      )}
                    </div>
                    <section className="project-status-history" aria-label="Order status history">
                      <h4>Status history</h4>
                      <ol>{(order.status_history||[]).map((change,index)=><li key={`${change.changed_at}-${index}`}>
                        <span>{change.previous_status?`${change.previous_status.replace(/_/g," ")} → `:"Created as "}{change.new_status.replace(/_/g," ")}</span>
                        <small>{new Date(change.changed_at).toLocaleString()}</small>
                      </li>)}</ol>
                    </section>
                  </section>
                ) : null;
              })()}
            {activeOrder && (
              <section className="business-panel payment-panel">
                <header>
                  <div>
                    <h3>Payment history</h3>
                    <p>
                      Outstanding:{" "}
                      {money(
                        orders.find((o) => o.id === activeOrder)
                          ?.outstanding_minor ?? 0,
                      )}
                    </p>
                  </div>
                  <button
                    className="icon-action"
                    onClick={() => setActiveOrder(null)}
                    aria-label="Close payments"
                  >
                    <X size={17} />
                  </button>
                </header>
                {paymentLoading ? (
                  <p>Loading payments…</p>
                ) : payments.length ? (
                  <ul className="payment-list">
                    {payments.map((p) => (
                      <li key={p.id}>
                        <span>
                          <b>{money(p.amount_minor)}</b>
                          <small>
                            {p.payment_date} ·{" "}
                            {p.payment_method || "Method not specified"}
                          </small>
                        </span>
                        <span>{p.reference || ""}{p.reversed_at?<small>Reversed {p.reversed_at.slice(0,10)}: {p.reversal_reason}</small>:<button type="button" className="secondary-button compact-button" onClick={()=>void reversePayment(p)}>Reverse payment</button>}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="empty-copy">
                    No payments recorded for this order.
                  </p>
                )}
                <form className="payment-form" onSubmit={recordPayment}>
                  <h4>
                    <CircleDollarSign size={16} /> Record payment
                  </h4>
                  <label>
                    Amount (₹)
                    <input
                      required
                      type="number"
                      min="0.01"
                      max={
                        (orders.find((o) => o.id === activeOrder)
                          ?.outstanding_minor ?? 0) / 100
                      }
                      step="0.01"
                      value={paymentDraft.amount}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          amount: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Payment date
                    <input
                      required
                      type="date"
                      value={paymentDraft.payment_date}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          payment_date: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label>
                    Method
                    <input
                      maxLength={60}
                      value={paymentDraft.payment_method}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          payment_method: e.target.value,
                        })
                      }
                      placeholder="Bank transfer, cash…"
                    />
                  </label>
                  <label>
                    Reference
                    <input
                      maxLength={200}
                      value={paymentDraft.reference}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          reference: e.target.value,
                        })
                      }
                    />
                  </label>
                  <label className="wide">
                    Notes
                    <textarea
                      rows={2}
                      value={paymentDraft.notes}
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          notes: e.target.value,
                        })
                      }
                    />
                  </label>
                  <button
                    className="studio-button"
                    disabled={
                      saving ||
                      (orders.find((o) => o.id === activeOrder)
                        ?.outstanding_minor ?? 0) <= 0
                    }
                  >
                    <Check size={14} />
                    {saving ? "Saving…" : "Save payment"}
                  </button>
                </form>
              </section>
            )}
          </section>
          <section className="workflow-section">
            <div className="workflow-section-title">
              <div>
                <h2>Tasks</h2>
                <p>
                  Create independent tasks or associate them with a project.
                </p>
              </div>
            </div>
            {tasks.length ? (
              <div className="business-panel table-wrap">
                <table className="records-table workflow-table">
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Project</th>
                      <th>Priority</th>
                      <th>Due</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={t.id}>
                        <td>
                          <b>{t.title}</b>
                          {t.description && (
                            <small className="table-subline">
                              {t.description}
                            </small>
                          )}
                        </td>
                        <td>{t.order_number || "Independent"}</td>
                        <td>
                          <span
                            className={`priority-tag priority-${t.priority}`}
                          >
                            {t.priority}
                          </span>
                        </td>
                        <td>{t.due_date || "—"}</td>
                        <td>
                          <select
                            aria-label={`Status for task ${t.title}`}
                            value={t.status}
                            onChange={(e) =>
                              void updateTask(t, e.target.value as TaskStatus)
                            }
                          >
                            {taskStatuses.map((s) => (
                              <option key={s} value={s}>
                                {s.replace(/_/g, " ")}
                              </option>
                            ))}
                          </select>
                          {(t.status_history||[]).length>1&&<details className="task-status-history"><summary>View {t.status_history?.length} status entries</summary><ol>{t.status_history?.map((change,index)=><li key={`${change.changed_at}-${index}`}>{change.previous_status?`${change.previous_status.replace(/_/g," ")} → `:"Created as "}{change.new_status.replace(/_/g," ")} · {new Date(change.changed_at).toLocaleString()}</li>)}</ol></details>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="workflow-empty">
                No tasks yet. Tasks can be linked to a project or kept
                independent.
              </div>
            )}
          </section>
        </>
      )}
    </>
  );
}
