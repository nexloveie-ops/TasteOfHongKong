/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DEFAULT_STORE_SLUG?: string;
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
