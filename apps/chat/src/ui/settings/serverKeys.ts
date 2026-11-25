import { keyFor, withKey } from "../../settings";

// Shared by every pair of server fields in the dialog, so each shows the key saved for its URL.
export interface SavedKeys {
  current: Record<string, string>;
}

export interface ServerFields {
  url: HTMLInputElement;
  key: HTMLInputElement;
}

// The key field always holds the key for the base URL shown, so a key is never tested against another host.
export interface KeyFollower {
  show(baseUrl: string, apiKey: string): void;
  follow(): void;
}

export function keyFollower(saved: SavedKeys, { url, key }: ServerFields): KeyFollower {
  let keyUrl = "";
  return {
    show: (baseUrl, apiKey) => {
      keyUrl = baseUrl;
      url.value = baseUrl;
      key.value = apiKey;
    },
    follow: () => {
      saved.current = withKey(saved.current, keyUrl, key.value.trim());
      keyUrl = url.value;
      key.value = keyFor(saved.current, keyUrl);
    },
  };
}
