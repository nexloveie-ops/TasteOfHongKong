/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_STORE_SLUG?: string;
  /** 后端公开访问根 URL（与提供 `/api`、`/uploads` 的服务一致），前后端分域名部署时必填 */
  readonly VITE_API_ORIGIN?: string;
}

/* Type declarations for @google/model-viewer web component */
declare namespace React.JSX {
  interface IntrinsicElements {
    'model-viewer': React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        src?: string;
        alt?: string;
        ar?: boolean;
        'ar-modes'?: string;
        'camera-controls'?: boolean;
        poster?: string;
      },
      HTMLElement
    >;
  }
}
