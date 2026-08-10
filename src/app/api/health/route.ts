// Liveness probe for the container HEALTHCHECK and Railway's healthcheckPath.
// Deliberately does not touch the NestJS API: this answers "is the Next server
// up", not "is the backend reachable" — otherwise a backend blip would restart
// a perfectly healthy admin container.
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ status: 'ok' });
}
