/* global http, json, output, STUB_URL, PHONE, PREVIOUS */
// The newest code the WhatsApp stub recorded for PHONE (tools/whatsapp-stub, GET /v1/last-code).
// With PREVIOUS set, waits (polling) until a different code arrives: the worker relays the outbox
// row a few seconds after the request.
function read() {
  const response = http.get(`${STUB_URL}/v1/last-code?to=${encodeURIComponent(PHONE)}`);
  if (!response.ok) return undefined;
  return json(response.body).code;
}

const previous = typeof PREVIOUS === 'string' && PREVIOUS !== '' ? PREVIOUS : undefined;
let code = read();
for (let attempt = 0; attempt < 20000 && (code === undefined || code === previous); attempt += 1) {
  code = read();
}
if (code === undefined || code === previous) throw new Error(`no new code for ${PHONE}`);
output.code = code;
