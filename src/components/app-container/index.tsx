import { ConfigProvider } from "antd";
import zh_CN from "antd/lib/locale/zh_CN";
import styles from "./index.module.css";

export default function AppContainer({ children }: { children: React.ReactNode }) {
  return (
    <ConfigProvider locale={zh_CN}>
      <div className={styles["app-container"]}>{children}</div>
    </ConfigProvider>
  );
}
