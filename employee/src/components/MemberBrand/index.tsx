import { SendOutlined } from "@ant-design/icons";
import styles from "./index.module.css";

export default function MemberBrand({ compact = false }: { compact?: boolean }) {
  return (
    <span className={compact ? styles.compact : styles.onArt}>
      <span className={styles.mark} aria-hidden="true"><SendOutlined rotate={-18} /></span>
      <span>Sky Club</span>
    </span>
  );
}
