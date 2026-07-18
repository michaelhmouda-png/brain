/**
 * Retired development endpoint.
 *
 * User provisioning must never be exposed through an HTTP route because it
 * requires service-role authority. Local users must be provisioned through a
 * trusted administrative control plane instead.
 */
export async function POST(): Promise<Response> {
  return new Response(null, { status: 404 });
}
