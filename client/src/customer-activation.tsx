import { useEffect, useState, type FormEvent } from "react";
import { authRequest, RequestError } from "@webapp-template/common/web-auth";

const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const readToken = () => new URLSearchParams(window.location.hash.slice(1)).get("token");

export function CustomerActivation() {
  const [token, setToken] = useState(readToken);

  useEffect(() => {
    const readLink = () => setToken(readToken());
    window.addEventListener("hashchange", readLink);
    return () => window.removeEventListener("hashchange", readLink);
  }, []);

  return <main className="sky-signin">
    <h1>激活老板账号</h1>
    <ActivationForm key={token} token={token} />
    <p><a href="/">前往客户端</a></p>
  </main>;
}

function ActivationForm({ token }: { token: string | null }) {
  const [activated, setActivated] = useState(() => !token && window.history.state?.customerActivated === true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const username = String(data.get("username"));
    const password = String(data.get("password"));
    if (password !== data.get("confirmation")) {
      setError("两次输入的密码不一致");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await authRequest("/user/activate-dispatch-customer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, username, password }),
      });
      if (readToken() !== token) return;
      window.history.replaceState({ customerActivated: true }, "", window.location.pathname);
      setActivated(true);
    } catch (err) {
      setError(err instanceof RequestError ? err.message : "未收到激活结果，请重试。如提示链接已使用，请用刚设置的账号和密码登录");
    } finally {
      setBusy(false);
    }
  }

  if (activated) return <div role="status">
    <p>账号已激活，请用刚设置的账号和密码登录查看历史订单。</p>
    <p>如果客户端已登录其他账号，请先退出，再登录新账号。</p>
  </div>;
  if (!token || !tokenPattern.test(token)) return <p role="alert">激活链接无效，请联系原派单人获取新链接。</p>;
  return <form onSubmit={submit}>
    <label>用户名<input name="username" autoComplete="username" maxLength={100} required /></label>
    <label>密码<input name="password" type="password" autoComplete="new-password" maxLength={256} required /></label>
    <label>确认密码<input name="confirmation" type="password" autoComplete="new-password" maxLength={256} required /></label>
    {error && <p role="alert">{error}</p>}
    <button type="submit" disabled={busy}>{busy ? "激活中…" : "激活账号"}</button>
  </form>;
}
