export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { EnvironmentConfigurationError, validateServerEnvironment } = await import('./lib/environment.server');
    try {
      validateServerEnvironment();
    } catch (error) {
      if (error instanceof EnvironmentConfigurationError) {
        console.error('[Brain configuration] startup rejected', error.toJSON());
      }
      throw error;
    }
  }
}
