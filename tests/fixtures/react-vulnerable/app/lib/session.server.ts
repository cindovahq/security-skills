import { createCookieSessionStorage } from "react-router";

export const sessionStorage = createCookieSessionStorage({
  cookie: {
    name: "__acme_session",
    secrets: [process.env.SESSION_SECRET ?? "acme-helpdesk-dev-secret"],
    sameSite: "lax",
    httpOnly: true,
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  },
});

export const { getSession, commitSession, destroySession } = sessionStorage;
