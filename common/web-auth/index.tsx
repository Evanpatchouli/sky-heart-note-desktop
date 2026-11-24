import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import type { ComponentType, FormEvent, ReactNode } from "react";
import { appNames, authRequest, getAppToken, invalidateSession, postLogin, RequestError, saveToken, subscribeToken, verifySession } from "./api";
import type { AppSession, Candidate, WebApp } from "./api";
import "./style.css";

export * from "./api";
const SessionContext = createContext<AppSession | null>(null);
interface SessionActions {
  logout: () => Promise<void>;
  loggingOut: boolean;
  logoutError: string;
}
const ActionsContext = createContext<SessionActions | null>(null);

export function useAuthSession() {
  const user = useContext(SessionContext);
  if (!user) throw new Error("请在 AuthGate 内使用 useAuthSession");
  return user;
}

export function useSessionActions() {
  const actions = useContext(ActionsContext);
  if (!actions) throw new Error("请在 AuthGate 内使用 useSessionActions");
  return actions;
}

const errorText = (error: unknown) => error instanceof Error ? error.message : "请求失败，请重试";

function accountName(account: Pick<Candidate, "id" | "username" | "nickname">) {
  if (account.username && account.nickname && account.username !== account.nickname) {
    return `${account.nickname}（${account.username}）`;
  }
  return account.username || account.nickname || account.id;
}

export function SharedAccounts({ app, onLogin }: { app: WebApp; onLogin: (user: AppSession) => void }) {
  const [accounts, setAccounts] = useState<Candidate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    authRequest<Candidate[]>(`/user/login/candidates?app=${app}`, { signal: controller.signal })
      .then(setAccounts)
      .catch(() => { if (!controller.signal.aborted) setAccounts([]); });
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("focus", refresh);
    return () => { controller.abort(); window.removeEventListener("focus", refresh); };
  }, [app, revision]);

  async function redeem(account: Candidate) {
    setBusy(true);
    setError("");
    try {
      onLogin(await postLogin(app, "shared", { sourceApp: account.sourceApp, sourceUserId: account.id }));
    } catch (err) {
      setError(errorText(err));
      setRevision((value) => value + 1);
    } finally { setBusy(false); }
  }

  return <>
    {accounts.length > 0 && <section className="sky-accounts" aria-label="使用已登录账号">
      <p>使用已登录账号</p>
      {accounts.map(account => <button key={account.sourceApp} type="button" disabled={busy} onClick={() => redeem(account)}>
        使用 {accountName(account)} 登录（来自{appNames[account.sourceApp]}）
      </button>)}
    </section>}
    {error && <p role="alert">{error}</p>}
  </>;
}

export interface SignInProps {
  app: WebApp;
  onLogin: (user: AppSession) => void;
}

export function useAuthCaptcha(app: WebApp, purpose: "login" | "register" = "login") {
  const [image, setImage] = useState("");
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setImage("");
    setError("");
    authRequest<string>(`/captcha/${purpose}?app=${app}`, { signal: controller.signal })
      .then(setImage).catch(err => { if (!controller.signal.aborted) setError(errorText(err)); });
    return () => controller.abort();
  }, [app, purpose, revision]);
  return { image, error, refresh: () => setRevision(value => value + 1) };
}

function SignIn({ app, onLogin }: SignInProps) {
  const [register, setRegister] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const captcha = useAuthCaptcha(app, register ? "register" : "login");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const fields = {
        username: String(data.get("username")), password: String(data.get("password")), captcha: String(data.get("captcha")),
      };
      if (register) {
        await authRequest("/user/register?type=account", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...fields, app }),
        });
        setRegister(false);
        setNotice("账号已创建，请输入新的验证码登录。");
      } else onLogin(await postLogin(app, "account", fields));
    } catch (err) { setError(errorText(err)); captcha.refresh(); }
    finally { setBusy(false); }
  }

  return <main className="sky-signin">
    <h1>{appNames[app]}{register ? "注册" : "登录"}</h1>
    {!register && <SharedAccounts app={app} onLogin={onLogin} />}
    {notice && <p role="status">{notice}</p>}
    <form onSubmit={submit}>
      <label>账号<input name="username" autoComplete="username" required /></label>
      <label>密码<input name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required /></label>
      <label>验证码<input key={captcha.image} name="captcha" autoComplete="off" maxLength={4} required /></label>
      <button type="button" aria-label="刷新验证码" onClick={captcha.refresh}>
        {captcha.image ? <img src={`data:image/svg+xml;base64,${captcha.image}`} alt="图形验证码" /> : "重新获取验证码"}
      </button>
      {(error || captcha.error) && <p role="alert">{error || captcha.error}</p>}
      <button type="submit" disabled={busy || !captcha.image}>{busy ? "提交中…" : register ? "注册" : "登录"}</button>
      {app === "client" && <button type="button" disabled={busy} onClick={() => {
        setRegister(value => !value); setError(""); setNotice("");
      }}>{register ? "已有账号，前往登录" : "注册账号"}</button>}
    </form>
  </main>;
}

interface AuthGateProps {
  app: WebApp;
  children: ReactNode;
  signInView?: ComponentType<SignInProps>;
  showSessionBar?: boolean;
}

export function AuthGate({ app, children, signInView: SignInView = SignIn, showSessionBar = true }: AuthGateProps) {
  const subscribe = useCallback((fn: () => void) => subscribeToken(app, fn), [app]);
  const token = useSyncExternalStore(subscribe, () => getAppToken(app));
  const [user, setUser] = useState<AppSession | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState("");

  useEffect(() => {
    if (!token) { setUser(null); return; }
    if (user?.token === token) return;
    const controller = new AbortController();
    setError("");
    verifySession(app, token, controller.signal).then(setUser).catch(err => {
      if (controller.signal.aborted) return;
      if (err instanceof RequestError && [401, 403].includes(err.status)) invalidateSession(app);
      else setError(errorText(err));
    });
    return () => controller.abort();
  }, [app, token, user?.token, revision]);

  async function logout() {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutError("");
    const clearCurrent = () => { if (getAppToken(app) === token) invalidateSession(app); };
    try {
      await authRequest("/user/logout", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      clearCurrent();
    } catch (err) {
      if (err instanceof RequestError && [401, 403].includes(err.status)) clearCurrent();
      else if (getAppToken(app) === token) setLogoutError(errorText(err));
    } finally { setLoggingOut(false); }
  }

  if (!token) return <SignInView app={app} onLogin={result => {
    setError(""); setLogoutError(""); setUser(result); saveToken(app, result.token);
  }} />;
  if (!user || user.token !== token) return <main className="sky-signin">
    {error ? <><p role="alert">{error}</p><button onClick={() => setRevision(v => v + 1)}>重试</button></> : "正在验证登录…"}
  </main>;
  return <SessionContext.Provider key={user.id} value={user}>
    <ActionsContext.Provider value={{ logout, loggingOut, logoutError }}>
      {showSessionBar && <div className="sky-session"><span>{user.nickname || user.username}</span><button disabled={loggingOut} onClick={logout}>退出登录</button>
        {logoutError && <span role="alert">{logoutError}</span>}
      </div>}
      {children}
    </ActionsContext.Provider>
  </SessionContext.Provider>;
}
