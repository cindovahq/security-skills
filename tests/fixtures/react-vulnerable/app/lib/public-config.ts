export const publicConfig = {
  sentryDsn: import.meta.env.VITE_SENTRY_DSN as string | undefined,
  stripePublishableKey: import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY as string | undefined,
};
