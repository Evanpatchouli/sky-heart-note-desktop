import { useEffect, useState, useSyncExternalStore } from "react";
import { getAppToken, invalidateSession, RequestError, saveToken, subscribeToken, verifySession } from "@sky-club/common/web-auth";
import { RouterView } from "./router";
import { useEvent } from "./hooks/useEmitter";
import { acceptSession, useLoginStore } from "./auth/store";
import "./App.css";

const subscribe = (notify: () => void) => subscribeToken("admin", notify);

export default function App() {
  const token = useSyncExternalStore(subscribe, () => getAppToken("admin"));
  const verified = useLoginStore(s => s.token);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEvent("user.login", (event) => {
    const result = event.getPayload();
    acceptSession(result);
    saveToken("admin", result.token);
  });

  useEffect(() => {
    if (!token) { acceptSession(null); return; }
    if (verified === token) return;
    const controller = new AbortController();
    setError("");
    verifySession("admin", token, controller.signal).then(acceptSession).catch(err => {
      if (controller.signal.aborted) return;
      if (err instanceof RequestError && [401, 403].includes(err.status)) invalidateSession("admin");
      else setError("无法连接登录服务");
    });
    return () => controller.abort();
  }, [token, verified, attempt]);

  if (token !== verified) return <main className="sky-signin">
    {error ? <><p role="alert">{error}</p><button onClick={() => setAttempt(a => a + 1)}>重试</button></> : "正在验证登录…"}
  </main>;
  return <RouterView key={verified} />;
}
