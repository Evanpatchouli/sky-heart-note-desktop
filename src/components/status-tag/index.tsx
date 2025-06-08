import { Tag, TagProps } from "antd";
// ['pending', 'processing', 'delivered', 'cancelled']
const tagMap: Record<string, { color: string; text: string }> = {
  pending: {
    color: "blue",
    text: "待处理",
  },
  processing: {
    color: "orange",
    text: "处理中",
  },
  delivered: {
    color: "green",
    text: "已结单",
  },
  cancelled: {
    color: "red",
    text: "已取消",
  },
};

export default function StatusTag({ children, color, ...rest }: Omit<TagProps, "children"> & { children: string }) {
  return (
    <Tag color={tagMap[children].color} {...rest}>
      {tagMap[children].text}
    </Tag>
  );
}
