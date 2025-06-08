import useEmitter from "#/utils/useEmitter";
import { Modal } from "antd";
import { useState } from "react";

export default function OverviewDialog() {
  const emitter = useEmitter();
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  emitter.useSubscription<Record<string, any>>("OPEN_OVERVIEW_DIALOG_REQUEST", (e) => {
    console.log(e.payload.record);
    setOpen(true);
  });
  const handleCancel = () => {
    close();
  };
  const handleOk = () => {
    close();
  };
  return (
    <Modal open={open} onClose={close} onCancel={handleCancel} onOk={handleOk} width={800}>
      <div>
        <h2>Overview</h2>
        <p>
          今天共有 <strong>{12}</strong> 个订单进行
        </p>
        <p>
          今天共有 <strong>{3}</strong> 个订单完成
        </p>
        <p>
          当前共有 <strong>{9}</strong> 个订单进行中
        </p>
        <p>
          当前共有 <strong>{0}</strong> 个订单暂停
        </p>
        <p>
          当前共有 <strong>{0}</strong> 个订单暂停
        </p>
        <p>
          今天一共送出 <strong>{60}</strong> 颗爱心
        </p>
        <p>
          近七天共送出 <strong>{420}</strong> 颗爱心
        </p>
        <p>
          近七天平均送出 <strong>{60}</strong> 颗爱心/天
        </p>
      </div>
    </Modal>
  );
}
