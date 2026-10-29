import { notifyAuthExpired } from "./authEvents";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new Error(
      "The local API is unavailable. Check that the server is running.",
    );
  }
  notifyAuthExpired(response);
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(data.error || `Request failed (${response.status})`);
  return data as T;
}

export const jsonRequest = (
  method: "POST" | "PUT" | "PATCH",
  body: unknown,
): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
