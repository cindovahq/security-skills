export const config = {
  apiUrl: import.meta.env.VITE_API_URL as string,
  adminToken: import.meta.env.VITE_ADMIN_API_TOKEN as string,
  supportKey: process.env.SUPPORT_API_KEY as string,
  buildId: process.env.BUILD_ID as string,
};
