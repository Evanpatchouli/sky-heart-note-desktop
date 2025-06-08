export default function TimelineOutlined(props: {
  style?: React.CSSProperties;
  className?: string;
  fill?: string;
  width?: number;
  height?: number;
}) {
  return (
    <svg
      className={props.className}
      style={props.style}
      viewBox="0 0 1024 780"
      version="1.1"
      xmlns="http://www.w3.org/2000/svg"
      p-id="5241"
      width={props.width || 14}
      height={props.height || 14}
      display={"inline-block"}
    >
      <path
        d="M 631.467 631.467 m -358.4 0 a 358.4 358.4 0 1 0 716.8 0 a 358.4 358.4 0 1 0 -716.8 0 Z"
        fill="#ffffff"
        fill-opacity="0.1"
        p-id="5392"
      ></path>
      <path
        d="M 204.8 546.133 v -68.2667 H 102.4 V 204.8 h 102.4 V 136.533 h 68.2667 v 68.2667 h 102.4 v 273.067 H 273.067 v 68.2667 h 102.4 v 273.067 H 273.067 v 102.4 H 204.8 v -102.4 H 102.4 v -273.067 h 102.4 Z m 68.2667 -273.067 H 170.667 v 136.533 h 136.533 V 273.067 H 273.067 Z M 170.667 614.4 v 136.533 h 136.533 v -136.533 H 170.667 Z M 409.6 273.067 h 529.067 V 204.8 H 409.6 Z"
        fill="currentColor"
        p-id="5393"
      ></path>
      <path d="M 409.6 443.733 h 290.133 V 375.467 H 409.6 Z" fill="currentColor" p-id="5394"></path>
      <path d="M 409.6 614.4 h 529.067 v -68.2667 H 409.6 Z" fill="currentColor" p-id="5395"></path>
      <path d="M 409.6 785.067 h 324.267 v -68.2667 H 409.6 Z" fill="currentColor" p-id="5396"></path>
    </svg>
  );
}
