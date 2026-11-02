/* global http, json, output, STUB_URL, PHONE */
// The code the stub holds for PHONE before a new request, so last-code.js can wait for a new one.
const response = http.get(`${STUB_URL}/v1/last-code?to=${encodeURIComponent(PHONE)}`);
output.previous = response.ok ? json(response.body).code : '';
