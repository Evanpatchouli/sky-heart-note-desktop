import useEmitter from "#/utils/useEmitter";
import { DatePicker, Flex, Form, Input, Modal, Radio, Select, Switch } from "antd";
import FormItem from "antd/es/form/FormItem";
import { useEffect, useState } from "react";
import "./index.css";
import FormItemLabel from "antd/es/form/FormItemLabel";
import { App } from "#/types";
import { CNDateToDate, sql } from "#/utils";
import dayjs from "dayjs";
import { nanoid } from "nanoid";
import { useForm } from "antd/es/form/Form";
import { updateBooking } from "#/service";
import toast from "#/utils/toast";

const paipaiOptions = [
  { value: "鸢", label: <span>鸢</span> },
  { value: "琼", label: <span>琼</span> },
  { value: "西瓜", label: <span>西瓜</span> },
  { value: "长安", label: <span>长安</span> },
  { value: "阿莓", label: <span>阿莓</span> },
  { value: "池遇", label: <span>池遇</span> },
  { value: "忘晴", label: <span>忘晴</span> },
  { value: "妙妙", label: <span>妙妙</span> },
  { value: "岁岁", label: <span>岁岁</span> },
  { value: "离", label: <span>离</span> },
  { value: "鹤", label: <span>鹤</span> },
  { value: "竹子", label: <span>竹子</span> },
  { value: "阿念", label: <span>阿念</span> },
  { value: "义", label: <span>义</span> },
  { value: "涵", label: <span>涵</span> },
  { value: "渊", label: <span>渊</span> },
  { value: "楠黎", label: <span>楠黎</span> },
  { value: "森", label: <span>森</span> },
  { value: "阿数", label: <span>阿数</span> },
  { value: "欣", label: <span>欣</span> },
  { value: "冷少", label: <span>冷少</span> },
  { value: "阿颜", label: <span>阿颜</span> },
  { value: "葡萄", label: <span>葡萄</span> },
];
const zhipaiOptions = [
  { value: "虹", label: <span>虹</span> },
  { value: "兰", label: <span>兰</span> },
];
const statusOptions = [
  { value: "未开始", label: <span>未开始</span> },
  { value: "进行中", label: <span>进行中</span> },
  { value: "暂停", label: <span>暂停</span> },
  { value: "完成", label: <span>完成</span> },
  { value: "退单", label: <span>退单</span> },
  { value: "延期", label: <span>延期</span> },
];

export default function BookingDetailDialog() {
  const emitter = useEmitter();
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
  };
  const [form] = useForm();
  const [detial, setDetail] = useState<App.Booking>({});
  emitter.useSubscription<Record<string, any>>("OPEN_BOOKING_DETAIL_DIALOG_REQUEST", (e) => {
    // console.log(e.payload.record);
    setDetail(e.payload.record);
    setStartDate(e.payload.record.date?.split("-")[0] || "");
    setEndDate(e.payload.record.date?.split("-")[1] || "");
    if (e.payload.record.date?.split("-")[1]) {
      setHasEndDate(true);
    } else {
      setHasEndDate(false);
    }
    setOpen(true);
  });
  const handleCancel = () => {
    close();
  };
  const handleOk = () => {
    form.submit();
  };

  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [hasEndDate, setHasEndDate] = useState<boolean>(false);

  const [xiaoqunOptions, setXiaoqunOptions] = useState<{ value: string }[]>([
    { value: "QQ" },
    { value: "微信" },
    { value: "微信1" },
    { value: "微信2" },
  ]);

  emitter.useSubscription<{
    id: string;
    content: string;
    created_at: string;
  }>("ADD_PINGLUN_REQUEST", (e) => {
    setDetail((prev) => {
      const prevPinglun = JSON.parse(prev.pinglun || "[]");
      return {
        ...prev,
        pinglun: JSON.stringify([...prevPinglun, e.payload]),
      };
    });
  });

  return (
    <Modal
      open={open}
      onClose={close}
      onCancel={handleCancel}
      onOk={handleOk}
      width={800}
      destroyOnClose
      bodyProps={{
        style: {
          paddingInline: "4rem",
        },
      }}
    >
      <div className="components__booking-detail-dialog">
        <Form
          labelCol={{ span: 4 }}
          labelAlign="left"
          className="components__booking-detail-dialog__form"
          form={form}
          onFinish={async () => {
            const ok = await updateBooking(detial.id, detial);
            if (ok) {
              toast.success("更新成功");
            } else {
              toast.error("更新失败");
            }
            close();
            emitter.emit({
              type: "REFRESH_BOOKINGS",
              payload: null,
            });
          }}
        >
          <FormItem name="title">
            <Input
              defaultValue={detial.title || "未设置标题"}
              placeholder="标题"
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__title"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, title: e.target.value };
                });
              }}
            />
          </FormItem>
          <FormItem label="日期" name="date">
            {hasEndDate ? (
              <DatePicker.RangePicker
                defaultValue={[dayjs(CNDateToDate(startDate)), dayjs(CNDateToDate(endDate))]}
                onChange={(dates) => {
                  const _startDate = dates?.[0]?.format("YYYY年MM月DD日") || "";
                  setStartDate(_startDate);
                  const _endDate = dates?.[1]?.format("YYYY年MM月DD日") || "";
                  setEndDate(_endDate);
                  const date = hasEndDate ? `${_startDate}-${_endDate}` : _startDate;
                  setDetail((prev) => {
                    return { ...prev, date };
                  });
                }}
                renderExtraFooter={() => (
                  <Flex justify="space-between" align="center" gap={8}>
                    <label>
                      <span>结束日期</span>
                    </label>
                    <Switch
                      checked={hasEndDate}
                      onChange={(checked) => {
                        setHasEndDate(checked);
                        if (!checked) {
                          setDetail((prev) => {
                            return { ...prev, date: startDate };
                          });
                        } else {
                          setDetail((prev) => {
                            return { ...prev, date: `${startDate}-${endDate}` };
                          });
                        }
                      }}
                    />
                  </Flex>
                )}
              />
            ) : (
              <DatePicker
                defaultValue={startDate ? dayjs(CNDateToDate(startDate)) : undefined}
                onChange={(date) => {
                  const _date = date?.format("YYYY年MM月DD日") || "";
                  setStartDate(_date);
                  setDetail((prev) => {
                    return { ...prev, date: _date };
                  });
                }}
                renderExtraFooter={() => (
                  <Flex justify="space-between" align="center" gap={8}>
                    <label>
                      <span>结束日期</span>
                    </label>
                    <Switch
                      checked={hasEndDate}
                      onChange={(checked) => {
                        setHasEndDate(checked);
                      }}
                    />
                  </Flex>
                )}
              />
            )}
          </FormItem>
          <FormItem label="板板" name="banban">
            <Input
              defaultValue={detial.banban || ""}
              placeholder="老板名称"
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, banban: e.target.value };
                });
              }}
            />
          </FormItem>
          <FormItem label="派派" name="paipai">
            <Select
              options={paipaiOptions}
              placeholder="派单员"
              mode="tags"
              defaultValue={detial.paipai ? detial.paipai.split(",") : []}
              onChange={(value) => {
                setDetail((prev) => {
                  return { ...prev, paipai: value.join(",") };
                });
              }}
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
            />
          </FormItem>
          {/* <FormItem label="送心员">
            <Select options={songxinyuanOptions} mode="tags" />
          </FormItem> */}
          <FormItem label="状态" name="status">
            <Select
              options={statusOptions}
              placeholder="订单状态"
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              defaultValue={detial.status}
              onChange={(value) => {
                setDetail((prev) => {
                  return { ...prev, status: value };
                });
              }}
            />
          </FormItem>
          <FormItem label="总量" name="total">
            <Input
              type="number"
              defaultValue={detial.total || 0}
              placeholder="爱心总数"
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, total: Number(e.target.value) };
                });
              }}
            />
          </FormItem>
          {/* <FormItem label="总日出">
            <Input type="number" value={detial.daily || 0} autoComplete="off" variant="borderless" />
          </FormItem>
          <FormItem label="总进度">
            <Input type="number" value={detial.daily || 0} autoComplete="off" variant="borderless" />
          </FormItem> */}
          <FormItem label="应出" name="yingchu">
            <Input
              type="number"
              defaultValue={detial.yingchu || 0}
              placeholder="应送出爱心数"
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, yingchu: Number(e.target.value) };
                });
              }}
            />
          </FormItem>
          <FormItem label="日出" name="richu">
            <Input
              type="number"
              placeholder="每天送几颗"
              defaultValue={detial.richu || 0}
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, richu: Number(e.target.value) };
                });
              }}
            />
          </FormItem>
          <FormItem label="指派" name="zhipai">
            <Select
              options={zhipaiOptions}
              mode="tags"
              variant="borderless"
              placeholder="送心号"
              defaultValue={detial.zhipai?.split(",")}
              onChange={(value) => {
                setDetail((prev) => {
                  return { ...prev, zhipai: value.join(",") };
                });
              }}
              className="components__booking-detail-dialog__form__item"
            />
          </FormItem>
          <FormItem label="实送" name="shisong">
            <Input
              type="number"
              defaultValue={detial.yichu || 0}
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, shisong: Number(e.target.value) };
                });
              }}
            />
          </FormItem>
          <FormItem label="工资" name="gongzi">
            <Input
              type="number"
              defaultValue={(detial.gongzi || "¥0").replace("¥", "")}
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, gongzi: `¥${e.target.value}` };
                });
              }}
            />
          </FormItem>
          <FormItem label="预期结算" name="yuqiJiesuan">
            <Input
              type="number"
              prefix="¥"
              defaultValue={(detial.yuqiJiesuan || "¥0").replace("¥", "")}
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, yuqiJiesuan: `¥${e.target.value}` };
                });
              }}
            />
          </FormItem>
          <FormItem label="实际结算" name="shijiJiesuan">
            <Input
              type="number"
              prefix="¥"
              defaultValue={(detial.shijiJiesuan || "¥0").replace("¥", "")}
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, shijiJiesuan: `¥${e.target.value}` };
                });
              }}
            />
          </FormItem>
          <FormItem label="小群" name="xiaoqun">
            <Select
              options={xiaoqunOptions.map((xq) => ({
                value: xq.value,
                label: <span>{xq.value}</span>,
              }))}
              mode="tags"
              placeholder="请选择小群"
              defaultValue={detial.xiaoqun}
              variant="borderless"
              className="components__booking-detail-dialog__form__item"
              onChange={(value) => {
                setDetail((prev) => {
                  return { ...prev, xiaoqun: value };
                });
              }}
            />
          </FormItem>
          <FormItem label="备注" name="remark">
            <Input.TextArea
              defaultValue={detial.remark || ""}
              autoComplete="off"
              variant="borderless"
              className="components__booking-detail-dialog__form__item input"
              onChange={(e) => {
                setDetail((prev) => {
                  return { ...prev, remark: e.target.value };
                });
              }}
            />
          </FormItem>
        </Form>
        <div>
          <label>每日记录</label>
          <Daily
            data={[
              {
                id: nanoid(),
                yisong: "清",
                date: dayjs().format("YYYY-MM-DD"),
              },
            ]}
            zhipai={detial.zhipai}
          />
        </div>
        <div>
          <label>评论</label>
          <Pinglun data={JSON.parse(detial.pinglun || "[]")} />
        </div>
      </div>
    </Modal>
  );
}

function Pinglun(props: {
  data: {
    id: string;
    content: string;
    created_at: string;
  }[];
}) {
  const [text, setText] = useState("");
  const emitter = useEmitter();
  return (
    <ul>
      {props.data.map((item: any) => (
        <li
          key={item.id}
          style={{
            marginBottom: "10px",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <span
            style={{
              color: "#999",
              fontSize: "12px",
              display: "block",
            }}
          >
            {item.created_at}
          </span>
          <p
            style={{
              margin: "0",
              padding: "0",
              fontSize: "14px",
            }}
          >
            {item.content}
          </p>
        </li>
      ))}

      <li>
        <Input
          className="components__booking-detail-dialog__form__item input"
          type="text"
          size="small"
          variant="borderless"
          placeholder="添加评论"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              // TODO: send pinglun
              emitter.emit({
                type: "ADD_PINGLUN_REQUEST",
                payload: {
                  id: nanoid(),
                  content: text,
                  created_at: dayjs().format("YYYY-MM-DD HH:mm:ss"),
                },
              });
              setText("");
            }
          }}
        />
      </li>
    </ul>
  );
}

function Daily(props: {
  zhipai?: string;
  data: {
    id: string;
    yisong: string;
    date: string;
  }[];
}) {
  return (
    <ul>
      {props.data.map((item) => (
        <li
          key={item.id}
          style={{
            marginBottom: "10px",
            borderBottom: "1px solid #f0f0f0",
          }}
        >
          <span
            style={{
              color: "#999",
              fontSize: "12px",
              display: "block",
            }}
          >
            {item.date}
          </span>
          <Select
            mode="tags"
            style={{
              width: "100%",
            }}
            defaultValue={item.yisong.split(",")}
            options={props.zhipai?.split(",")?.map((zhipai) => ({
              value: zhipai,
              label: <span>{zhipai}</span>,
            }))}
            placeholder="请选择小群"
            variant="borderless"
            className="components__booking-detail-dialog__form__item"
          />
        </li>
      ))}
    </ul>
  );
}
