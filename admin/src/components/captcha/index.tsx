import type { ValuesOf } from "@webapp-template/common";
import { CaptchaWay } from '@/constants/index';
import useCaptcha, { type UseCaptchaOptions } from "@/hooks/useCaptcha";

export type CaptchaProps = {
  way: ValuesOf<typeof CaptchaWay>,
  className?: string,
} & UseCaptchaOptions

export default function Captcha({ way, className, onSuccess, onError }: CaptchaProps) {
  const [data, refetch] = useCaptcha(way, { onSuccess, onError });
  const handleClick = () => {
    refetch();
  }

  return (
    <button type="button" className={className} aria-label="刷新验证码" title="刷新验证码" onClick={handleClick}>
      {data ? (
        <img
          src={`data:image/svg+xml;base64,${data}`}
          alt="验证码"
          style={{ height: '100%', width: '100%', objectFit: 'contain' }}
        />
      ) : (
        <span style={{ fontSize: 12, color: '#999' }}>加载中...</span>
      )}
    </button>
  )
}
