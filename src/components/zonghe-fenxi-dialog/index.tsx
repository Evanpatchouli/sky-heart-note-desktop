import useEmitter from "#/utils/useEmitter";
import { Button, Collapse, Input, Modal } from "antd";
import { useState } from "react";

export function ZongheFenxiDialog() {
  const [open, setOpen] = useState(false);
  const [haos, setHaos] = useState<
    Array<{
      name: string;
      lazhu: number;
    }>
  >([
    {
      name: "G1",
      lazhu: 286,
    },
  ]);
  const emitter = useEmitter();
  emitter.useSubscription("OPEN_ZONGHE_FENXI_DIALOG_REQUEST", (e) => {
    setOpen(true);
  });
  return (
    <Modal title="综合分析" open={open} footer={null} onCancel={() => setOpen(false)} width={600}>
      <Collapse
        items={[
          {
            key: "1",
            label: "账号情况",
            children: (
              <>
                {haos.map((hao) => {
                  return (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        padding: "10px 0",
                        gap: 10,
                        alignItems: "center",
                      }}
                    >
                      <Input value={hao.name} placeholder="号名称" />
                      <Input defaultValue={hao.lazhu} type="number" placeholder="蜡烛数" />
                    </div>
                  );
                })}
              </>
            ),
          },
        ]}
        defaultActiveKey={["1"]}
      />
      <Button>开始分析</Button>
    </Modal>
  );
}
