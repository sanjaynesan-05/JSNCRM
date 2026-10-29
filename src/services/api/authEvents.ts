export function notifyAuthExpired(response: Response) {
  if (response.status === 401) window.dispatchEvent(new Event("jsn-auth-expired"));
}
