import { useEffect, useId, useRef, useState } from "react";
import { Alert, Button, Flex, Modal } from "antd";
import { getAppToken, RequestError, useAuthSession, useSessionActions } from "@webapp-template/common/web-auth";
import { employeeRequest } from "#/service/request";
import { type PersonalSchedule, type ScheduleDates, requestMessage } from "./types";

export default function PersonalScheduleDialog({ route, orderName, schedule, proposed = schedule, onClose, onSaved, onReload }: {
  route: string;
  orderName: string;
  schedule: PersonalSchedule;
  proposed?: ScheduleDates;
  onClose: () => void;
  onSaved: (schedule: PersonalSchedule) => void;
  onReload: () => void;
}) {
  const fieldId = useId();
  const { token } = useAuthSession();
  const { loggingOut } = useSessionActions();
  const [startDate, setStart] = useState(proposed.startDate ?? "");
  const [endDate, setEnd] = useState(proposed.endDate ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const request = useRef<AbortController>(undefined);
  useEffect(() => () => request.current?.abort(), []);

  const dateError = !!startDate !== !!endDate ? "请同时填写两个日期，或同时清空。"
    : startDate && startDate > endDate ? "结束日期不能早于开始日期。" : "";

  async function save() {
    if (request.current || loggingOut || conflict || dateError || getAppToken("employee") !== token) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    request.current = controller;
    setSaving(true);
    setError("");
    try {
      const next = await employeeRequest<PersonalSchedule>(`${route}/personal-schedule`, "PATCH", {
        startDate: startDate || null, endDate: endDate || null, expectedRevision: schedule.revision,
      }, controller.signal);
      if (!controller.signal.aborted && getAppToken("employee") === token) onSaved(next);
    } catch (err) {
      if (getAppToken("employee") === token) {
        setConflict(err instanceof RequestError && err.status === 409);
        setError(requestMessage(err));
      }
    } finally {
      window.clearTimeout(timeout);
      request.current = undefined;
      setSaving(false);
    }
  }

  return <Modal open title="调整本人排期" okText="保存排期" cancelText="取消" onOk={() => void save()}
    onCancel={onClose} confirmLoading={saving} closable={!saving} keyboard={!saving}
    cancelButtonProps={{ disabled: saving }} okButtonProps={{ disabled: !!dateError || loggingOut || conflict }}
    mask={{ closable: !saving }} styles={{ body: { maxHeight: "62dvh", overflowY: "auto" } }}>
    <p className="assignment-schedule-name">{orderName}</p>
    <div className="assignment-form-dates">
      <label htmlFor={`${fieldId}-start`}>开始日期<input id={`${fieldId}-start`} type="date" value={startDate}
        min="0001-01-01" max={endDate || "9999-12-31"} disabled={saving} onChange={event => setStart(event.target.value)} /></label>
      <label htmlFor={`${fieldId}-end`}>结束日期<input id={`${fieldId}-end`} type="date" value={endDate}
        min={startDate || "0001-01-01"} max="9999-12-31" disabled={saving} onChange={event => setEnd(event.target.value)} /></label>
    </div>
    <p>排期包含首尾两天。清空日期并保存后，承接会回到「未排期」。</p>
    <Flex gap="small" wrap>
      <Button disabled={saving || (!startDate && !endDate)} onClick={() => { setStart(""); setEnd(""); }}>清空日期</Button>
      {conflict ? <Button onClick={onReload}>刷新排期</Button> : null}
    </Flex>
    {dateError || error ? <Alert type="error" showIcon title={dateError || error} style={{ marginTop: 12 }} /> : null}
  </Modal>;
}
