export function byteStream(options: { size?: number; chunkSize?: number; failAt?: number; prefix?: Uint8Array } = {}) {
  const { size = 16384, chunkSize = 1024, failAt = Infinity, prefix = new Uint8Array([0x50, 0x4b, 3, 4]) } = options;
  let emitted = 0;
  const stats = { pulls: 0, cancelled: false, emitted: 0 };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      stats.pulls++;
      if (emitted >= failAt) { controller.error(new Error("artificial_stream_failure")); return; }
      if (emitted >= size) { controller.close(); return; }
      const bytes = new Uint8Array(Math.min(chunkSize, size - emitted));
      for (let i = 0; i < bytes.length; i++) bytes[i] = emitted + i < prefix.length ? prefix[emitted + i] : (emitted + i) % 251;
      emitted += bytes.length;
      stats.emitted = emitted;
      controller.enqueue(bytes);
    },
    cancel() { stats.cancelled = true; },
  }, { highWaterMark: 0 });
  return { stream, stats };
}

export function fetchSequence(responses: (Response | Error)[]) {
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    requests.push(new Request(input, init));
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (!response) throw new Error("unexpected_external_request");
    return response;
  };
  return { fetcher, requests };
}
