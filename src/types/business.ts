export type Client = {
  id: string;
  client_code: string;
  name: string;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  created_at: string;
};
export type ClientDetail = Client & { address: string | null; notes: string | null; updated_at: string; archived_at: string | null };

export type QuotationStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired"
  | "cancelled";
export type QuotationItem = {
  id: string;
  quotation_id: string;
  description: string;
  quantity: number;
  unit_price_minor: number;
  line_total_minor: number;
  sort_order: number;
};
export type Quotation = {
  id: string;
  quotation_number: string;
  client_id: string;
  client_name: string;
  converted_order_id?: string | null;
  converted_order_number?: string | null;
  title: string;
  description: string | null;
  currency: string;
  subtotal_minor: number;
  discount_type: "none" | "fixed" | "percentage";
  discount_value: number;
  discount_minor: number;
  tax_minor: number;
  total_minor: number;
  status: QuotationStatus;
  issue_date: string;
  valid_until: string | null;
  terms: string | null;
  notes: string | null;
  items?: QuotationItem[];
};
export type QuotationInput = {
  client_id: string;
  title: string;
  description?: string;
  items: { description: string; quantity: number; unit_price_minor: number }[];
  discount_type: "none" | "fixed" | "percentage";
  discount_value: number;
  issue_date?: string;
  valid_until?: string | null;
  terms?: string;
  notes?: string;
};

export type OrderStatus =
  | "new"
  | "confirmed"
  | "in_progress"
  | "client_review"
  | "revisions"
  | "ready_for_delivery"
  | "delivered"
  | "on_hold"
  | "cancelled"
  | "closed";
export type Priority = "low" | "normal" | "high" | "urgent";
export type Order = {
  id: string;
  order_number: string;
  client_id: string;
  client_name: string;
  quotation_id: string | null;
  title: string;
  description: string | null;
  requirements: string;
  agreed_amount_minor: number;
  currency: string;
  status: OrderStatus;
  priority: Priority;
  order_date: string;
  start_date: string | null;
  due_date: string | null;
  delivered_at: string | null;
  paid_minor: number;
  outstanding_minor: number;
  status_history?: StatusChange[];
};
export type StatusChange = { previous_status: string | null; new_status: string; changed_at: string; metadata: string | null };
export type Payment = {
  id: string;
  order_id: string;
  amount_minor: number;
  currency: string;
  payment_date: string;
  payment_method: string | null;
  reference: string | null;
  notes: string | null;
  reversal_reason?: string | null;
  reversed_at?: string | null;
};
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled";
export type Task = {
  id: string;
  order_id: string | null;
  order_number?: string | null;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: Priority;
  due_date: string | null;
  completed_at: string | null;
  status_history?: StatusChange[];
};
