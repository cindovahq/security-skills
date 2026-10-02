FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV VITE_API_URL=https://helpdesk.acme.example/api
ENV VITE_SENTRY_DSN=https://examplekey@o0.ingest.sentry.example/1
ENV VITE_STRIPE_PUBLISHABLE_KEY=pk_test_acme_demo_0000
ENV VITE_ADMIN_API_TOKEN=acme_admin_token_demo_0000
ENV SUPPORT_API_KEY=acme_support_key_demo_0000
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/build ./build
RUN npm ci --omit=dev
EXPOSE 3000
CMD ["npm", "run", "start"]
