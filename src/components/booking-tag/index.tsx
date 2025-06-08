import { Tag, TagProps } from "antd";
// ['heart', 'candle', 'riceroll', 'sacrifice', 'task', 'trial', 'gift', 'complex, 'other']
const tagMap: Record<string, { color: string; text: string }> = {
  heart: {
    color: "red",
    text: "送心",
  },
  candle: {
    color: "green",
    text: "跑图",
  },
  riceroll: {
    color: "blue",
    text: "饭团",
  },
  sacrifice: {
    color: "orange",
    text: "献祭",
  },
  task: {
    color: "purple",
    text: "任务",
  },
  trial: {
    color: "cyan",
    text: "试炼",
  },
  gift: {
    color: "magenta",
    text: "代送",
  },
  complex: {
    color: "volcano",
    text: "复合",
  },
  other: {
    color: "geekblue",
    text: "其他",
  },
};

export default function BookingTag({ children, color, ...rest }: Omit<TagProps, "children"> & { children: string }) {
  return (
    <Tag color={tagMap[children].color} {...rest}>
      {tagMap[children].text}
    </Tag>
  );
}
