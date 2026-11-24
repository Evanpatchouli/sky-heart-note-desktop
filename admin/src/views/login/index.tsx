import { Card } from "antd";
import { useNavigate } from "react-router";
import { SharedAccounts } from "@webapp-template/common/web-auth";
import { UserLoginEvent } from "@/events/user.event";
import { useEmit } from "@/hooks/useEmitter";
import LoginForm from "./LoginForm";

export default function LoginView() {
  const emitter = useEmit();
  const nav = useNavigate();
  return <main style={{ maxWidth: 460, margin: "8vh auto", padding: 16 }}>
    <Card title="送心手记 · 管理端登录">
      <SharedAccounts app="admin" onLogin={user => {
        emitter.emit("user.login", new UserLoginEvent(user));
        nav("/", { replace: true });
      }} />
      <LoginForm />
    </Card>
  </main>;
}
