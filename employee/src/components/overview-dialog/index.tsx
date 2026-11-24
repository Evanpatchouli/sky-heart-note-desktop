import { Modal } from "antd";
import { useState } from "react";
import useEmitter from "#/utils/useEmitter";
import useHomeStore from "#/views/home/store";

export default function OverviewDialog() {
  const [open, setOpen] = useState(false);
  const bookings = useHomeStore(store => store.bookings);
  useEmitter().useSubscription("OPEN_OVERVIEW_DIALOG_REQUEST", () => setOpen(true));
  const count = (status: string) => bookings.filter(row => row.status === status).length;
  return (
    <Modal title="简要概览" open={open} onCancel={() => setOpen(false)} footer={null}>
      <p>订单总数　<strong>{bookings.length}</strong></p>
      <p>进行中　<strong>{count("进行中")}</strong></p>
      <p>已完成　<strong>{count("完成")}</strong></p>
      <p>已暂停　<strong>{count("暂停")}</strong></p>
      <p>累计送出爱心　<strong>{bookings.reduce((sum, row) => sum + (Number(row.yichu) || 0), 0)}</strong></p>
    </Modal>
  );
}
