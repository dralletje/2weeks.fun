export let interval = async function* (
  interval: number,
  { signal }: { signal: AbortSignal }
) {
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, interval));
    if (signal.aborted) {
      return;
    }
    yield;
  }
};
