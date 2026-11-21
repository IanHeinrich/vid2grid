export type IsLatest = () => boolean;

export function latestCalls(): () => IsLatest {
  let latest = 0;
  return () => {
    latest += 1;
    const call = latest;
    return () => call === latest;
  };
}
