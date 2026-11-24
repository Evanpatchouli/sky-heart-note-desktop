import { authRequest, getAppToken, invalidateSession, RequestError } from "@webapp-template/common/web-auth";

export async function employeeRequest<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = getAppToken("employee");
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  try {
    return await authRequest<T>(`/employee/${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal,
    });
  } catch (err) {
    if (err instanceof RequestError && [401, 403].includes(err.status) && token === getAppToken("employee")) {
      invalidateSession("employee");
    }
    throw err;
  }
}
