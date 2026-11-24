import { useEffect, useState } from "react";
import { Button, Collapse, Modal } from "antd";
import type { Songxinhao } from "#/model/Songxinhao";
import { getAllSongsinhao } from "#/service";
import useEmitter from "#/utils/useEmitter";

export function ZongheFenxiDialog() {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<Songxinhao[] | null>(null);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEmitter().useSubscription("OPEN_ZONGHE_FENXI_DIALOG_REQUEST", () => setOpen(true));
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setAccounts(null);
    setError("");
    getAllSongsinhao(controller.signal).then(rows => {
      if (!controller.signal.aborted) setAccounts(rows);
    }).catch(err => {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "账号加载失败");
    });
    return () => controller.abort();
  }, [open, revision]);
  return <Modal title="综合分析" open={open} onCancel={() => setOpen(false)} footer={null} width={600}>
    <Collapse defaultActiveKey={["accounts"]} items={[{ key: "accounts", label: "账号情况", children:
      error ? <p role="alert">{error} <Button onClick={() => setRevision(v => v + 1)}>重试</Button></p>
        : !accounts ? "正在加载账号…" : !accounts.length ? "暂无送心号"
          : accounts.map(row => <p key={row.id}>{row.name}　{row.candles} 根蜡烛</p>)
    }]} />
  </Modal>;
}
