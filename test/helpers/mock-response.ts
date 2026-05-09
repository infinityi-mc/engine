export function makeMockResponse(mockResponse: unknown, status = 200): Response {
  const headers = new Headers();
  return {
    ok: status >= 200 && status < 300,
    status,
    headers,
    json: async () => mockResponse,
    text: async () => JSON.stringify(mockResponse),
    bodyUsed: false,
    body: null,
    url: "",
    redirected: false,
    type: "basic",
    statusText: "",
    clone: () => { throw new Error("not implemented"); },
    arrayBuffer: async () => new ArrayBuffer(0),
    blob: async () => new Blob(),
    formData: async () => new FormData(),
  } as unknown as Response;
}
