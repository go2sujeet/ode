declare module "svelte/store" {
  export type Subscriber<T> = (value: T) => void;
  export type Unsubscriber = () => void;

  export interface Readable<T> {
    subscribe(run: Subscriber<T>): Unsubscriber;
  }

  export interface Writable<T> extends Readable<T> {
    set(value: T): void;
    update(updater: (value: T) => T): void;
  }

  export function writable<T>(value: T): Writable<T>;
  export function readable<T>(value: T): Readable<T>;
  export function get<T>(store: Readable<T>): T;
}

declare module "@sveltejs/kit/vite" {
  export function sveltekit(): unknown;
}

declare module "vite" {
  export function defineConfig<T>(config: T): T;
}
