import { AppError } from "./app-error";
import MaomaoguKuku from "#assets/maomaogu_kuku_240x240.png";
import { Flex } from "antd";

const DocNotFound = ({ error }: { error: AppError }) => (
  <Flex vertical>
    <h1>光崽好像迷路了</h1>
    <p>
      <img src={MaomaoguKuku} alt="404" />
    </p>
    <p>
      <strong>{error.statusText || error.message}</strong>
    </p>
  </Flex>
);

export default DocNotFound;
