import type { SimController } from './controller';

/** Debug and end-to-end test hooks exposed by src/main.tsx. */
declare global {
  interface Window {
    __squib?: {
      snapshot: () => unknown;
      input: () => unknown;
      determinism: (seconds: number) => string;
      determinismState: (seconds: number) => number[];
      advance: (seconds: number) => void;
      controller: SimController;
    };
  }
}
export {};
