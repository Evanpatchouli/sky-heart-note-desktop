import { useRef, useState, type FormEvent } from "react";
import { authRequest, RequestError } from "@sky-club/common/web-auth";

type Registration = { id: string; employeeUrl: string };

export default function ClubInvitation() {
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("token"));
  const [registration, setRegistration] = useState<Registration>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (locked.current) return;
    const form = new FormData(event.currentTarget);
    const password = form.get("password");
    if (password !== form.get("confirmation")) {
      setError("两次输入的密码不一致");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    try {
      const account = await authRequest<Registration>("/client/club-invitations/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, username: form.get("username"), password }),
      });
      window.history.replaceState(null, "", window.location.pathname);
      setRegistration(account);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "未收到注册结果，请重试");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  return <main className="sky-signin">
    <h1>注册并加入俱乐部</h1>
    {registration ? <div role="status">
      <p>已加入俱乐部。你的团员 ID 为 <strong>{registration.id}</strong>。</p>
      <a href={registration.employeeUrl}>前往团员端登录</a>
    </div> : !token || !/^[A-Za-z0-9_-]{43}$/.test(token) ?
      <p role="alert">注册邀请链接无效，请联系团员获取新链接。</p> :
      <form onSubmit={submit}>
        <label>用户名<input name="username" autoComplete="username" maxLength={100} required /></label>
        <label>密码<input name="password" type="password" autoComplete="new-password" maxLength={256} required /></label>
        <label>确认密码<input name="confirmation" type="password" autoComplete="new-password" maxLength={256} required /></label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={busy}>{busy ? "注册中…" : "注册并加入"}</button>
      </form>}
  </main>;
}
