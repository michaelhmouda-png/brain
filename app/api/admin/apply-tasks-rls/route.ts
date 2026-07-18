/**
 * Retired database-administration endpoint.
 *
 * Schema and RLS changes must run through the controlled migration/deployment
 * path, never from a user-triggerable HTTP request. Keeping a uniform 404
 * response also avoids revealing whether internal administration exists.
 */
export async function POST(): Promise<Response> {
  return new Response(null, { status: 404 });
}
