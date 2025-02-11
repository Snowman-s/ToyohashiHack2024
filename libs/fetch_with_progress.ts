export async function fetchWithProgress(url: string, onProgress: (progress: number) => void): Promise<Response> {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const reader = response.body?.getReader();
  let receivedLength = 0;
  const chunks = [];

  while (true) {
    const { done, value } = await reader!.read();
    if (done) {
      break;
    }
    chunks.push(value);
    receivedLength += value.length;
    onProgress(receivedLength);
  }

  const chunksAll = new Uint8Array(receivedLength);
  let position = 0;
  for (let chunk of chunks) {
    chunksAll.set(chunk, position);
    position += chunk.length;
  }

  const result = new TextDecoder("utf-8").decode(chunksAll);
  return new Response(result, {
    headers: { 'Content-Type': 'application/json' }
  });
}
