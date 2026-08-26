import type { FastifyInstance } from "fastify";
import { pool } from "../db/client.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { signToken } from "../auth/jwt.js";

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "org"
  );
}

interface RegisterBody {
  organizationName: string;
  email: string;
  password: string;
}

interface LoginBody {
  email: string;
  password: string;
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: RegisterBody }>("/auth/register", async (request, reply) => {
    const { organizationName, email, password } = request.body ?? ({} as RegisterBody);
    if (!organizationName || !email || !password) {
      return reply.code(400).send({ error: "organizationName, email, and password are required" });
    }
    if (password.length < 8) {
      return reply.code(400).send({ error: "password must be at least 8 characters" });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const baseSlug = slugify(organizationName);
      let slug = baseSlug;
      for (let attempt = 0; attempt < 5; attempt++) {
        const { rows } = await client.query("SELECT 1 FROM tenants WHERE slug = $1", [slug]);
        if (rows.length === 0) break;
        slug = `${baseSlug}-${Math.random().toString(36).slice(2, 6)}`;
      }

      const tenantResult = await client.query(
        "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id",
        [organizationName, slug]
      );
      const tenantId = tenantResult.rows[0].id as string;

      const passwordHash = await hashPassword(password);
      let userResult;
      try {
        userResult = await client.query(
          `INSERT INTO users (tenant_id, email, password_hash, role)
           VALUES ($1, $2, $3, 'owner') RETURNING id, email, role, tenant_id`,
          [tenantId, email.toLowerCase(), passwordHash]
        );
      } catch (err) {
        await client.query("ROLLBACK");
        if ((err as { code?: string }).code === "23505") {
          return reply.code(409).send({ error: "An account with that email already exists" });
        }
        throw err;
      }

      await client.query("COMMIT");

      const user = userResult.rows[0];
      const token = signToken({
        sub: user.id,
        tenantId: user.tenant_id,
        role: user.role,
        email: user.email,
      });
      return reply.code(201).send({
        token,
        user: { id: user.id, email: user.email, role: user.role },
        tenant: { id: tenantId, name: organizationName, slug },
      });
    } finally {
      client.release();
    }
  });

  app.post<{ Body: LoginBody }>("/auth/login", async (request, reply) => {
    const { email, password } = request.body ?? ({} as LoginBody);
    if (!email || !password) {
      return reply.code(400).send({ error: "email and password are required" });
    }

    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.password_hash, u.role, u.tenant_id, t.name AS tenant_name, t.slug AS tenant_slug
       FROM users u JOIN tenants t ON t.id = u.tenant_id
       WHERE u.email = $1`,
      [email.toLowerCase()]
    );
    const row = rows[0];
    const ok = row ? await verifyPassword(password, row.password_hash) : false;
    if (!ok || !row) {
      return reply.code(401).send({ error: "Invalid email or password" });
    }

    const token = signToken({ sub: row.id, tenantId: row.tenant_id, role: row.role, email: row.email });
    return reply.send({
      token,
      user: { id: row.id, email: row.email, role: row.role },
      tenant: { id: row.tenant_id, name: row.tenant_name, slug: row.tenant_slug },
    });
  });
}
