import { createCspReportSink } from '@eeasy-logistics/ui/session/csp-sink';

// The CSP report sink (web §3.6, WEB-2 plan 2.6): browsers post violations here (`report-to csp`,
// `Reporting-Endpoints`). The shared handler takes only the report media types, within a
// per-address and a process-wide budget, and logs each (directive, blocked origin) once a minute,
// never the page URL, the sample or the rest of the body (adversary M-2).

export const POST = createCspReportSink();
