import { Flex } from "antd";
import { AppError } from "./app-error";

const Default = ({ error }: { error: AppError }) => (
  <Flex vertical>
    <h1>Oops!</h1>
    <p>Sorry, an unexpected error has occurred.</p>
    <p>
      <i>{error.statusText || error.message}</i>
    </p>
  </Flex>
);

export default Default;
