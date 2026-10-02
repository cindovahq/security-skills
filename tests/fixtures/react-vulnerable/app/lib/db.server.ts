import { randomUUID } from "node:crypto";

const databaseUrl = process.env.DATABASE_URL;

export type Role = "customer" | "agent" | "admin";

export type User = {
  id: string;
  orgId: string;
  email: string;
  name: string;
  handle: string;
  role: Role;
  passwordHash: string;
  apiKey: string;
  resetToken: string | null;
  website: string | null;
  bio: string;
  preferences: Record<string, unknown>;
};

export type TicketComment = { id: string; authorId: string; text: string };

export type Ticket = {
  id: string;
  orgId: string;
  requesterId: string;
  subject: string;
  bodyHtml: string;
  emailHtml: string | null;
  status: "open" | "closed";
  comments: TicketComment[];
};

export type Article = { slug: string; title: string; markdown: string; authorId: string };

export type ReportColumn = { id: string; label: string; expression: string };

const users: User[] = [
  {
    id: "u_1",
    orgId: "org_1",
    email: "ada@globex.example",
    name: "Ada Admin",
    handle: "ada",
    role: "admin",
    passwordHash: "scrypt$c2FsdHNhbHQ$0f1e2d3c4b5a69788796a5b4c3d2e1f0",
    apiKey: "acme_key_demo_0001",
    resetToken: null,
    website: "https://ada.example",
    bio: "<p>Platform lead</p>",
    preferences: { theme: "dark" },
  },
  {
    id: "u_2",
    orgId: "org_2",
    email: "bob@initech.example",
    name: "Bob Customer",
    handle: "bob",
    role: "customer",
    passwordHash: "scrypt$c2FsdHNhbHQ$1a2b3c4d5e6f708192a3b4c5d6e7f801",
    apiKey: "acme_key_demo_0002",
    resetToken: "reset_demo_0002",
    website: null,
    bio: "",
    preferences: {},
  },
];

const tickets: Ticket[] = [
  {
    id: "t_100",
    orgId: "org_1",
    requesterId: "u_1",
    subject: "Quarterly invoice export",
    bodyHtml: "<p>Please export our invoices.</p>",
    emailHtml: null,
    status: "open",
    comments: [],
  },
  {
    id: "t_200",
    orgId: "org_2",
    requesterId: "u_2",
    subject: "Cannot reset password",
    bodyHtml: "<p>The reset email never arrives.</p>",
    emailHtml: "<p>Hello support</p>",
    status: "open",
    comments: [],
  },
];

const articles: Article[] = [
  { slug: "getting-started", title: "Getting started", markdown: "# Welcome\n\nCreate your first ticket.", authorId: "u_2" },
];

const reportColumns: Record<string, ReportColumn[]> = {
  org_1: [{ id: "c1", label: "Age (days)", expression: "Math.round((Date.now() - row.createdAt) / 86400000)" }],
};

export const db = {
  user: {
    byId: (id: string) => users.find((u) => u.id === id) ?? null,
    byEmail: (email: string) => users.find((u) => u.email === email) ?? null,
    byHandle: (handle: string) => users.find((u) => u.handle === handle) ?? null,
    list: () => users,
    update: (id: string, data: Record<string, unknown>) => {
      const user = users.find((u) => u.id === id);
      if (user) Object.assign(user, data);
      return user ?? null;
    },
  },
  ticket: {
    byId: (id: string) => tickets.find((t) => t.id === id) ?? null,
    forOrg: (orgId: string) => tickets.filter((t) => t.orgId === orgId),
    setStatus: (id: string, status: Ticket["status"]) => {
      const ticket = tickets.find((t) => t.id === id);
      if (ticket) ticket.status = status;
    },
    addComment: (id: string, comment: Omit<TicketComment, "id">) => {
      tickets.find((t) => t.id === id)?.comments.push({ id: randomUUID(), ...comment });
    },
  },
  article: {
    bySlug: (slug: string) => articles.find((a) => a.slug === slug) ?? null,
  },
  report: {
    columns: (orgId: string) => reportColumns[orgId] ?? [],
    addColumn: (orgId: string, column: Omit<ReportColumn, "id">) => {
      (reportColumns[orgId] ??= []).push({ id: randomUUID(), ...column });
    },
  },
  org: {
    setPlan: (orgId: string, plan: string) => {
      console.info("plan updated", orgId, plan, databaseUrl ? "db" : "memory");
    },
  },
  audit: {
    recent: () => [{ id: "a1", actor: "ada@globex.example", action: "login" }],
  },
};
