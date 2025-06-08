import { useViewContainerStore } from "./store";
import styles from "./index.module.css";

export default function ViewContainer(props: { children: React.ReactNode }) {
  const { state } = useViewContainerStore();
  return (
    <div className={styles["view-container"]}>
      <div
        className={styles["view-content"]}
        style={{
          gap: state.gap || 0,
        }}
      >
        {props.children}
      </div>
    </div>
  );
}
