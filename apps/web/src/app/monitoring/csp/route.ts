import { readCappedBody } from '@eeasy-logistics/ui/observability';
import { cspViolations } from '@eeasy-logistics/ui/session/headers';

// The CSP report sink (web §3.6, WEB-2 plan 2.6): browsers post violations here (`report-to csp`,
// `Reporting-Endpoints`). One log line per violation with the directive and the blocked origin
// only, never the page URL, the sample or the rest of the body; the log pipeline counts them.
// Always 204, so a report never tells the sender anything.

const maxReportBytes = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const read = await readCappedBody(request, maxReportBytes);
  if (!read.ok) return new Response(null, { status: read.status });
  for (const violation of cspViolations(new TextDecoder().decode(read.body))) {
    console.warn(
      JSON.stringify({
        event: 'csp.violation',
        directive: violation.directive,
        blocked_origin: violation.blockedOrigin,
      }),
    );
  }
  return new Response(null, { status: 204 });
}
