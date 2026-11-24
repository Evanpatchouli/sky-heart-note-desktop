import { useState } from "react";
import { DatePicker, Flex, Form, Input, InputNumber, Modal, Select, Switch } from "antd";
import dayjs from "dayjs";
import { nanoid } from "nanoid";
import type { App } from "#/types";
import { createBooking, updateBooking } from "#/service";
import { bookingDates, CNDateToDateString } from "#/utils";
import useEmitter from "#/utils/useEmitter";
import toast from "#/utils/toast";
import "./index.css";

const paipaiOptions = "鸢 琼 西瓜 长安 阿莓 池遇 忘晴 妙妙 岁岁 离 鹤 竹子 阿念 义 涵 渊 楠黎 森 阿数 欣 冷少 阿颜 葡萄".split(" ");
export const bookingStatuses = ["未开始", "进行中", "暂停", "完成", "退单", "延期"];
const format = "YYYY年MM月DD日";
type Draft = Partial<App.Booking>;
type Comment = { id: string; content: string; created_at: string };

function readComments(raw?: string): Comment[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (Array.isArray(value)) return value.filter((item) => item && typeof item.content === "string");
  } catch { /* Older notes may contain plain text. */ }
  return [{ id: "legacy", content: raw, created_at: "" }];
}

export default function BookingDetailDialog() {
  const emitter = useEmitter();
  const [original, setOriginal] = useState<Draft | null>(null);
  const [changes, setChanges] = useState<Draft>({});
  const [endDateEnabled, setEndDateEnabled] = useState(false);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  emitter.useSubscription<{ record?: Draft; type: string }>("OPEN_BOOKING_DETAIL_DIALOG_REQUEST", ({ payload }) => {
    const data = payload.type === "ADD" ? { date: dayjs().format(format), status: "未开始" } : payload.record || {};
    setOriginal(data);
    setChanges({});
    setText("");
    setEndDateEnabled(Boolean(bookingDates(data.date)[1]));
  });
  const data = { ...original, ...changes };
  const [start, end] = bookingDates(data.date);
  const update = (fields: Draft) => setChanges(previous => ({ ...previous, ...fields }));
  const refresh = () => emitter.emit({ type: "REFRESH_BOOKINGS", payload: null });
  const close = () => setOriginal(null);
  const comments = readComments(data.pinglun);
  const comment = (content: string): Comment => ({ id: nanoid(), content, created_at: dayjs().format("YYYY-MM-DD HH:mm:ss") });
  const save = async () => {
    if (saving || !original) return;
    if (!data.title?.trim()) { toast.error("请输入订单标题"); return; }
    const fields = text.trim() ? { ...changes, pinglun: JSON.stringify([...comments, comment(text.trim())]) } : changes;
    setSaving(true);
    try {
      if (original.id !== undefined) {
        if (Object.keys(fields).length && !await updateBooking(original.id, fields)) throw new Error("订单已不存在");
      } else {
        await createBooking({ ...original, ...fields });
      }
      close();
      refresh();
      toast.success("订单已保存");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "订单保存失败");
    } finally { setSaving(false); }
  };
  const tags = (key: "paipai" | "zhipai" | "xiaoqun", options: string[]) => (
    <Select mode="tags" value={data[key]?.split(",").filter(Boolean) || []}
      onChange={values => update({ [key]: values.join(",") })}
      options={options.map(value => ({ value }))} />
  );

  return (
    <Modal open={original !== null} onCancel={saving ? undefined : close} width={800} title={original?.id === undefined ? "添加订单" : "订单详情"}
      onOk={save} confirmLoading={saving} okText="保存" cancelText="取消" destroyOnHidden>
      <div className="components__booking-detail-dialog">
        <Form labelCol={{ span: 4 }} labelAlign="left" className="components__booking-detail-dialog__form">
          <Form.Item label="标题" required><Input value={data.title || ""} onChange={e => update({ title: e.target.value })} placeholder="订单标题" /></Form.Item>
          <Form.Item label="日期">
            <Flex gap={8} align="center" wrap>
              <DatePicker value={start ? dayjs(CNDateToDateString(start)) : null} onChange={value => {
                const next = value?.format(format) || "";
                update({ date: endDateEnabled && end ? `${next}-${end}` : next });
              }} />
              <Switch aria-label="结束日期" checkedChildren="结束日期" unCheckedChildren="结束日期" checked={endDateEnabled}
                onChange={enabled => { setEndDateEnabled(enabled); if (!enabled) update({ date: start }); }} />
              {endDateEnabled && <DatePicker value={end ? dayjs(CNDateToDateString(end)) : null}
                disabledDate={value => Boolean(start && value.isBefore(dayjs(CNDateToDateString(start)), "day"))}
                onChange={value => update({ date: value ? `${start}-${value.format(format)}` : start })} />}
            </Flex>
          </Form.Item>
          <Form.Item label="板板"><Input value={data.banban || ""} onChange={e => update({ banban: e.target.value })} /></Form.Item>
          <Form.Item label="派派">{tags("paipai", paipaiOptions)}</Form.Item>
          <Form.Item label="状态"><Select value={data.status} options={bookingStatuses.map(value => ({ value }))} onChange={status => update({ status })} /></Form.Item>
          {([["total", "总量"], ["yingchu", "应出"], ["richu", "日出"], ["yichu", "实送"], ["jinriYichu", "今日已送"]] as const).map(([key, label]) => (
            <Form.Item key={key} label={label}><InputNumber value={Number(data[key]) || 0} onChange={value => update({ [key]: value ?? 0 })} /></Form.Item>
          ))}
          <Form.Item label="今日状态"><Input value={data.jinriStatus || ""} onChange={e => update({ jinriStatus: e.target.value })} /></Form.Item>
          <Form.Item label="指派">{tags("zhipai", ["虹", "兰"])}</Form.Item>
          {([["gongzi", "工资"], ["yuqiJiesuan", "预期结算"], ["shijiJiesuan", "实际结算"]] as const).map(([key, label]) => (
            <Form.Item key={key} label={label}><InputNumber prefix="¥" value={Number(String(data[key] || "0").replace("¥", "")) || 0}
              onChange={value => update({ [key]: `¥${value ?? 0}` })} /></Form.Item>
          ))}
          <Form.Item label="小群">{tags("xiaoqun", ["QQ", "微信", "微信1", "微信2"])}</Form.Item>
          <Form.Item label="备注"><Input.TextArea value={data.remark || ""} onChange={e => update({ remark: e.target.value })} /></Form.Item>
          <Form.Item label="评论">
            {comments.map((item, index) => <p key={item.id || index}><small>{item.created_at}</small> {item.content}</p>)}
            <Input placeholder="添加评论" value={text} onChange={e => setText(e.target.value)} onPressEnter={e => {
              e.preventDefault();
              if (text.trim()) { update({ pinglun: JSON.stringify([...comments, comment(text.trim())]) }); setText(""); }
            }} />
          </Form.Item>
        </Form>
      </div>
    </Modal>
  );
}
