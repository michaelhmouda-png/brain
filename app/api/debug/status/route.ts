/**
 * Development-only authenticated status check.
 *
 * The environment guard is intentionally the first operation. Outside local
 * development the route fails closed before loading authentication or database
 * code and returns no diagnostic information.
 */

interface AuthenticatedStatusClient {
  auth: {
    getUser(): Promise<{
      data: { user: unknown | null };
      error: unknown | null;
    }>;
  };
}

type LoadAuthenticatedClient = () => Promise<AuthenticatedStatusClient>;

async function loadAuthenticatedClient(): Promise<AuthenticatedStatusClient> {
  const { createSupabaseServerAuth } = await import('../../../../lib/supabaseServer');
  return createSupabaseServerAuth();
}

export function createStatusHandler(
  loadClient: LoadAuthenticatedClient = loadAuthenticatedClient
) {
  return async function GET(): Promise<Response> {
    if (process.env.NODE_ENV !== 'development') {
      return new Response(null, { status: 404 });
    }

    try {
      const client = await loadClient();
      const {
        data: { user },
        error,
      } = await client.auth.getUser();

      if (error || !user) {
        return new Response(null, { status: 404 });
      }

      return new Response(null, { status: 204 });
    } catch {
      return new Response(null, { status: 404 });
    }
  };
}

export const GET = createStatusHandler();
