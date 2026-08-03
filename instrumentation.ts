export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateServerEnvironment } = await import('./lib/environment.server');
    validateServerEnvironment();
  }
}
