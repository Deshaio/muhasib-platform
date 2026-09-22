import "dotenv/config";
import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pg from "pg";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
});

const db = {
  query: async (text, params) => await pool.query(text, params),
  exec: async (sql) => await pool.query(sql),
};
// ═══════════════════════════════════════════════
//  Database Init
// ═══════════════════════════════════════════════
async function initDatabase() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      tax_id VARCHAR(50) UNIQUE NOT NULL,
      plan VARCHAR(30) DEFAULT 'starter',
      monthly_tx_limit INT DEFAULT 500,
      current_month_tx INT DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      trial_ends_at TIMESTAMPTZ,
      subscription_ends_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(30) DEFAULT 'owner',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS admins (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role VARCHAR(30) DEFAULT 'super_admin',
      is_active BOOLEAN DEFAULT TRUE,
      last_login TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(100) NOT NULL,
      slug VARCHAR(50) UNIQUE NOT NULL,
      price NUMERIC(10,2) NOT NULL DEFAULT 0,
      monthly_tx_limit INT NOT NULL DEFAULT 500,
      features TEXT,
      is_popular BOOLEAN DEFAULT FALSE,
      is_active BOOLEAN DEFAULT TRUE,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      plan_slug VARCHAR(50) NOT NULL,
      type VARCHAR(20) DEFAULT 'paid',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      amount NUMERIC(10,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'active',
      notes TEXT,
      created_by UUID,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS products (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      sku VARCHAR(100),
      barcode VARCHAR(100),
      name VARCHAR(255) NOT NULL,
      category VARCHAR(100),
      tax_rate NUMERIC(5,4) DEFAULT 0.14,
      price NUMERIC(15,2) DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS partners (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      type VARCHAR(20) DEFAULT 'customer',
      name VARCHAR(255) NOT NULL,
      tax_id VARCHAR(50),
      phone VARCHAR(30),
      email VARCHAR(255),
      address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      invoice_number VARCHAR(50) NOT NULL,
      invoice_type VARCHAR(20) DEFAULT 'sale',
      partner_id UUID,
      partner_name VARCHAR(255),
      issue_date DATE NOT NULL,
      subtotal NUMERIC(15,2) NOT NULL,
      vat_amount NUMERIC(15,2) NOT NULL,
      total NUMERIC(15,2) NOT NULL,
      discount NUMERIC(15,2) DEFAULT 0,
      notes TEXT,
      status VARCHAR(30) DEFAULT 'issued',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      invoice_id UUID,
      product_id UUID,
      description VARCHAR(255),
      quantity NUMERIC(15,3) NOT NULL,
      unit_price NUMERIC(15,2) NOT NULL,
      tax_rate NUMERIC(5,4) NOT NULL,
      tax_amount NUMERIC(15,2) NOT NULL,
      line_total NUMERIC(15,2) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS declarations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID,
      period_year INT NOT NULL,
      period_month INT NOT NULL,
      sales_standard NUMERIC(15,2) DEFAULT 0,
      sales_table NUMERIC(15,2) DEFAULT 0,
      sales_exports NUMERIC(15,2) DEFAULT 0,
      sales_exempt NUMERIC(15,2) DEFAULT 0,
      vat_output NUMERIC(15,2) DEFAULT 0,
      vat_input NUMERIC(15,2) DEFAULT 0,
      net_vat_due NUMERIC(15,2) DEFAULT 0,
      status VARCHAR(30) DEFAULT 'draft',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id UUID,
      admin_id UUID,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50),
      entity_id UUID,
      details TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // إنشاء خطط افتراضية
  const plansCount = await db.query("SELECT COUNT(*) as c FROM plans");
  if (Number(plansCount.rows[0].c) === 0) {
    await db.query(
      `INSERT INTO plans (name, slug, price, monthly_tx_limit, features, is_popular, sort_order) VALUES
       ('Starter', 'starter', 299, 500, 'حتى 500 معاملة شهرياً، ربط نظام POS واحد، إقرار شهري', false, 1),
       ('Business', 'business', 699, 2500, 'حتى 2,500 معاملة شهرياً، 3 أنظمة POS، الخصم تحت حساب الضريبة، تقارير متقدمة', true, 2),
       ('Growth', 'growth', 1199, 5000, 'حتى 5,000 معاملة شهرياً، 5 أنظمة POS، تقارير تحليلية، دعم أولوية', false, 3),
       ('Enterprise', 'enterprise', 0, 999999, 'معاملات غير محدودة، API كامل، مدير حساب مخصص، جرد ضريبي سنوي', false, 4)`
    );
    console.log("✅ Default plans inserted");
  }

  // إنشاء أدمن افتراضي
  const adminCount = await db.query("SELECT COUNT(*) as c FROM admins");
  if (Number(adminCount.rows[0].c) === 0) {
    const defaultEmail = process.env.ADMIN_EMAIL || "admin@muhasibmisr.com";
    const defaultPassword = process.env.ADMIN_PASSWORD || "Admin@2025";
    const hash = await bcrypt.hash(defaultPassword, 10);
    await db.query(
      `INSERT INTO admins (email, password_hash, full_name, role)
       VALUES ($1, $2, 'Super Admin', 'super_admin')`,
      [defaultEmail, hash]
    );
    console.log(`✅ Default admin created: ${defaultEmail} / ${defaultPassword}`);
  }

  console.log("✅ Database ready");
}

// ═══════════════════════════════════════════════
//  Express App
// ═══════════════════════════════════════════════
const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

// ═══ Auth middleware (للعملاء) ═══
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "NO_TOKEN" });
  try {
    const payload = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    if (payload.type !== "user") {
      return res.status(401).json({ error: "INVALID_TOKEN_TYPE" });
    }
    req.user = payload;
    req.tenantId = payload.tenantId;
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

// ═══ Admin Auth middleware ═══
function adminAuth(req, res, next) {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return res.status(401).json({ error: "NO_TOKEN" });
  try {
    const payload = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    if (payload.type !== "admin") {
      return res.status(401).json({ error: "NOT_ADMIN" });
    }
    req.admin = payload;
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

// ═══ Helper: التحقق من صلاحية الاشتراك ═══
async function checkTenantActive(tenantId) {
  const r = await db.query(
    "SELECT is_active, subscription_ends_at, trial_ends_at FROM tenants WHERE id=$1",
    [tenantId]
  );
  if (!r.rows.length) return { active: false, reason: "NOT_FOUND" };
  const t = r.rows[0];
  if (!t.is_active) return { active: false, reason: "SUSPENDED" };
  if (t.subscription_ends_at && new Date(t.subscription_ends_at) < new Date()) {
    return { active: false, reason: "SUBSCRIPTION_EXPIRED" };
  }
  if (t.trial_ends_at && new Date(t.trial_ends_at) < new Date()) {
    return { active: false, reason: "TRIAL_EXPIRED" };
  }
  return { active: true };
}

// ═══ Helper: log audit ═══
async function logAudit({ tenantId, adminId, action, entityType, entityId, details }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (tenant_id, admin_id, action, entity_type, entity_id, details)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId || null, adminId || null, action, entityType || null, entityId || null, details || null]
    );
  } catch (e) { console.error("Audit log error:", e.message); }
}

// ═══ Health ═══
app.get("/api/health", (req, res) =>
  res.json({ status: "ok", service: "Muhasib Misr", version: "3.0.0" })
);

// ═══════════════════════════════════════════════
//  AUTH (للعملاء)
// ═══════════════════════════════════════════════
app.post("/api/auth/register", async (req, res) => {
  try {
    const { tenant_name, tax_id, email, password, full_name } = req.body;
    if (!tenant_name || !tax_id || !email || !password || !full_name)
      return res.status(400).json({ error: "بيانات ناقصة" });

    const ex = await db.query("SELECT id FROM users WHERE email=$1", [email]);
    if (ex.rows.length) return res.status(409).json({ error: "البريد مسجل" });

    const hash = await bcrypt.hash(password, 10);

    // كل حساب جديد بياخد تجربة 14 يوم على باقة Business
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 14);

    const t = await db.query(
      `INSERT INTO tenants (name, tax_id, plan, monthly_tx_limit, trial_ends_at, is_active)
       VALUES ($1, $2, 'business', 2500, $3, TRUE) RETURNING *`,
      [tenant_name, tax_id, trialEnd]
    );

    const u = await db.query(
      `INSERT INTO users (tenant_id,email,password_hash,full_name,role)
       VALUES ($1,$2,$3,$4,'owner') RETURNING id,email,full_name,role,tenant_id`,
      [t.rows[0].id, email, hash, full_name]
    );

    // سجل الاشتراك التجريبي
    await db.query(
      `INSERT INTO subscriptions (tenant_id, plan_slug, type, start_date, end_date, status, notes)
       VALUES ($1, 'business', 'trial', $2, $3, 'active', 'تجربة مجانية 14 يوم')`,
      [t.rows[0].id, new Date().toISOString().split("T")[0], trialEnd.toISOString().split("T")[0]]
    );

    res.status(201).json({
      tenant: t.rows[0],
      user: u.rows[0],
      trial_ends_at: trialEnd,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await db.query(
      `SELECT u.*, t.is_active as tenant_active, t.subscription_ends_at, t.trial_ends_at
       FROM users u LEFT JOIN tenants t ON t.id=u.tenant_id
       WHERE u.email=$1`,
      [email]
    );
    if (!r.rows.length) return res.status(401).json({ error: "بيانات غير صحيحة" });
    const u = r.rows[0];
    if (!(await bcrypt.compare(password, u.password_hash)))
      return res.status(401).json({ error: "بيانات غير صحيحة" });

    // التحقق من صلاحية الحساب
    const check = await checkTenantActive(u.tenant_id);
    if (!check.active) {
      const messages = {
        SUSPENDED: "الحساب موقوف مؤقتاً، يرجى التواصل مع الدعم",
        SUBSCRIPTION_EXPIRED: "انتهى الاشتراك، يرجى التجديد",
        TRIAL_EXPIRED: "انتهت فترة التجربة المجانية، يرجى الاشتراك",
      };
      return res.status(403).json({
        error: "ACCOUNT_INACTIVE",
        reason: check.reason,
        message: messages[check.reason] || "الحساب غير مفعل",
      });
    }

    const token = jwt.sign(
      { userId: u.id, tenantId: u.tenant_id, role: u.role, type: "user" },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "7d" }
    );

    res.json({
      access_token: token,
      user: { id: u.id, email: u.email, full_name: u.full_name, tenant_id: u.tenant_id },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/auth/me", auth, async (req, res) => {
  const r = await db.query(
    `SELECT u.id,u.email,u.full_name,u.role,
            t.id as tenant_id,t.name as tenant_name,t.tax_id,t.plan,
            t.monthly_tx_limit,t.current_month_tx,t.is_active,
            t.trial_ends_at,t.subscription_ends_at
     FROM users u JOIN tenants t ON t.id=u.tenant_id WHERE u.id=$1`,
    [req.user.userId]
  );
  if (!r.rows.length) return res.status(404).json({ error: "غير موجود" });
  res.json(r.rows[0]);
});

// ═══════════════════════════════════════════════
//  ADMIN AUTH
// ═══════════════════════════════════════════════
app.post("/api/admin/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await db.query("SELECT * FROM admins WHERE email=$1", [email]);
    if (!r.rows.length) return res.status(401).json({ error: "بيانات غير صحيحة" });
    const admin = r.rows[0];
    if (!admin.is_active) return res.status(403).json({ error: "حساب موقوف" });
    if (!(await bcrypt.compare(password, admin.password_hash)))
      return res.status(401).json({ error: "بيانات غير صحيحة" });

    const token = jwt.sign(
      { adminId: admin.id, email: admin.email, role: admin.role, type: "admin" },
      process.env.JWT_SECRET,
      { expiresIn: "12h" }
    );

    await db.query("UPDATE admins SET last_login=NOW() WHERE id=$1", [admin.id]);
    await logAudit({ adminId: admin.id, action: "ADMIN_LOGIN", details: admin.email });

    res.json({
      access_token: token,
      admin: {
        id: admin.id,
        email: admin.email,
        full_name: admin.full_name,
        role: admin.role,
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/me", adminAuth, async (req, res) => {
  const r = await db.query(
    "SELECT id,email,full_name,role,last_login FROM admins WHERE id=$1",
    [req.admin.adminId]
  );
  if (!r.rows.length) return res.status(404).json({ error: "غير موجود" });
  res.json(r.rows[0]);
});

// ═══════════════════════════════════════════════
//  ADMIN - STATS
// ═══════════════════════════════════════════════
app.get("/api/admin/stats", adminAuth, async (req, res) => {
  try {
    const totalTenants = await db.query("SELECT COUNT(*) as c FROM tenants");
    const activeTenants = await db.query(
      `SELECT COUNT(*) as c FROM tenants
       WHERE is_active=TRUE
       AND (subscription_ends_at IS NULL OR subscription_ends_at > NOW())
       AND (trial_ends_at IS NULL OR trial_ends_at > NOW())`
    );
    const trialTenants = await db.query(
      `SELECT COUNT(*) as c FROM tenants
       WHERE trial_ends_at IS NOT NULL AND trial_ends_at > NOW()
       AND (subscription_ends_at IS NULL OR subscription_ends_at < NOW())`
    );
    const totalUsers = await db.query("SELECT COUNT(*) as c FROM users");
    const totalInvoices = await db.query("SELECT COUNT(*) as c FROM invoices");
    const totalRevenue = await db.query(
      `SELECT COALESCE(SUM(amount),0) as s FROM subscriptions WHERE status='active'`
    );

    // شركات جديدة آخر 30 يوم
    const newTenants = await db.query(
      `SELECT COUNT(*) as c FROM tenants WHERE created_at > NOW() - INTERVAL '30 days'`
    );

    // إيراد آخر 6 شهور
    const monthlyRevenue = await db.query(
      `SELECT to_char(created_at,'YYYY-MM') as month, SUM(amount) as revenue
       FROM subscriptions
       WHERE status='active' AND created_at > NOW() - INTERVAL '6 months'
       GROUP BY month ORDER BY month`
    );

    // آخر 5 شركات مسجلة
    const recent = await db.query(
      `SELECT id, name, tax_id, plan, is_active, trial_ends_at, subscription_ends_at, created_at
       FROM tenants ORDER BY created_at DESC LIMIT 5`
    );

    res.json({
      total_tenants: Number(totalTenants.rows[0].c),
      active_tenants: Number(activeTenants.rows[0].c),
      trial_tenants: Number(trialTenants.rows[0].c),
      total_users: Number(totalUsers.rows[0].c),
      total_invoices: Number(totalInvoices.rows[0].c),
      total_revenue: Number(totalRevenue.rows[0].s),
      new_tenants_30d: Number(newTenants.rows[0].c),
      monthly_revenue: monthlyRevenue.rows,
      recent_tenants: recent.rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
//  ADMIN - TENANTS
// ═══════════════════════════════════════════════
app.get("/api/admin/tenants", adminAuth, async (req, res) => {
  try {
    const { q, status } = req.query;
    const conds = ["1=1"];
    const params = [];
    let i = 1;

    if (q) {
      conds.push(`(name ILIKE $${i} OR tax_id ILIKE $${i})`);
      params.push(`%${q}%`); i++;
    }
    if (status === "active") {
      conds.push(`is_active=TRUE AND (subscription_ends_at IS NULL OR subscription_ends_at > NOW()) AND (trial_ends_at IS NULL OR trial_ends_at > NOW())`);
    } else if (status === "trial") {
      conds.push(`trial_ends_at IS NOT NULL AND trial_ends_at > NOW() AND (subscription_ends_at IS NULL OR subscription_ends_at < NOW())`);
    } else if (status === "suspended") {
      conds.push(`is_active=FALSE`);
    } else if (status === "expired") {
      conds.push(`is_active=TRUE AND ((subscription_ends_at IS NOT NULL AND subscription_ends_at < NOW()) OR (trial_ends_at IS NOT NULL AND trial_ends_at < NOW() AND (subscription_ends_at IS NULL OR subscription_ends_at < NOW())))`);
    }

    const r = await db.query(
      `SELECT t.*,
        (SELECT COUNT(*) FROM users u WHERE u.tenant_id=t.id) as users_count,
        (SELECT COUNT(*) FROM invoices i WHERE i.tenant_id=t.id) as invoices_count,
        (SELECT email FROM users u WHERE u.tenant_id=t.id ORDER BY created_at LIMIT 1) as owner_email
       FROM tenants t
       WHERE ${conds.join(" AND ")}
       ORDER BY t.created_at DESC
       LIMIT 200`,
      params
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/admin/tenants/:id/toggle", adminAuth, async (req, res) => {
  try {
    const r = await db.query("SELECT is_active, name FROM tenants WHERE id=$1", [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ error: "غير موجود" });

    const newStatus = !r.rows[0].is_active;
    await db.query("UPDATE tenants SET is_active=$1 WHERE id=$2", [newStatus, req.params.id]);

    await logAudit({
      tenantId: req.params.id,
      adminId: req.admin.adminId,
      action: newStatus ? "TENANT_ACTIVATED" : "TENANT_SUSPENDED",
      entityType: "tenant",
      entityId: req.params.id,
      details: r.rows[0].name,
    });

    res.json({ is_active: newStatus });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/admin/tenants/:id/plan", adminAuth, async (req, res) => {
  try {
    const { plan_slug, months = 12 } = req.body;
    const plan = await db.query("SELECT * FROM plans WHERE slug=$1", [plan_slug]);
    if (!plan.rows.length) return res.status(404).json({ error: "الباقة غير موجودة" });

    const p = plan.rows[0];
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + Number(months));

    await db.query(
      `UPDATE tenants SET plan=$1, monthly_tx_limit=$2, subscription_ends_at=$3, trial_ends_at=NULL, is_active=TRUE
       WHERE id=$4`,
      [plan_slug, p.monthly_tx_limit, endDate, req.params.id]
    );

    await db.query(
      `INSERT INTO subscriptions (tenant_id, plan_slug, type, start_date, end_date, amount, status, created_by)
       VALUES ($1, $2, 'paid', $3, $4, $5, 'active', $6)`,
      [req.params.id, plan_slug, new Date().toISOString().split("T")[0],
       endDate.toISOString().split("T")[0], p.price, req.admin.adminId]
    );

    await logAudit({
      tenantId: req.params.id,
      adminId: req.admin.adminId,
      action: "SUBSCRIPTION_GRANTED",
      entityType: "tenant",
      entityId: req.params.id,
      details: `Plan: ${plan_slug} for ${months} months`,
    });

    res.json({ ok: true, plan_slug, subscription_ends_at: endDate });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/admin/tenants/:id/grant-trial", adminAuth, async (req, res) => {
  try {
    const { days = 14 } = req.body;
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + Number(days));

    await db.query(
      `UPDATE tenants SET trial_ends_at=$1, is_active=TRUE WHERE id=$2`,
      [trialEnd, req.params.id]
    );

    await db.query(
      `INSERT INTO subscriptions (tenant_id, plan_slug, type, start_date, end_date, status, created_by, notes)
       VALUES ($1, 'business', 'trial', $2, $3, 'active', $4, 'تجربة مجانية بيد الأدمن')`,
      [req.params.id, new Date().toISOString().split("T")[0],
       trialEnd.toISOString().split("T")[0], req.admin.adminId]
    );

    await logAudit({
      tenantId: req.params.id,
      adminId: req.admin.adminId,
      action: "TRIAL_GRANTED",
      entityType: "tenant",
      entityId: req.params.id,
      details: `${days} days`,
    });

    res.json({ ok: true, trial_ends_at: trialEnd });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/admin/tenants/:id", adminAuth, async (req, res) => {
  try {
    const t = await db.query("SELECT * FROM tenants WHERE id=$1", [req.params.id]);
    if (!t.rows.length) return res.status(404).json({ error: "غير موجود" });

    const users = await db.query(
      "SELECT id,email,full_name,role,is_active,created_at FROM users WHERE tenant_id=$1",
      [req.params.id]
    );
    const subs = await db.query(
      "SELECT * FROM subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC",
      [req.params.id]
    );
    const stats = await db.query(
      `SELECT
        (SELECT COUNT(*) FROM invoices WHERE tenant_id=$1) as invoices,
        (SELECT COUNT(*) FROM products WHERE tenant_id=$1) as products,
        (SELECT COUNT(*) FROM partners WHERE tenant_id=$1) as partners,
        (SELECT COUNT(*) FROM declarations WHERE tenant_id=$1) as declarations`,
      [req.params.id]
    );

    res.json({
      tenant: t.rows[0],
      users: users.rows,
      subscriptions: subs.rows,
      stats: stats.rows[0],
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
//  ADMIN - PLANS
// ═══════════════════════════════════════════════
app.get("/api/admin/plans", adminAuth, async (req, res) => {
  const r = await db.query("SELECT * FROM plans ORDER BY sort_order, price");
  res.json(r.rows);
});

app.post("/api/admin/plans", adminAuth, async (req, res) => {
  try {
    const { name, slug, price, monthly_tx_limit, features, is_popular } = req.body;
    if (!name || !slug) return res.status(400).json({ error: "الاسم وال slug مطلوبان" });

    const r = await db.query(
      `INSERT INTO plans (name, slug, price, monthly_tx_limit, features, is_popular)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, slug, Number(price) || 0, Number(monthly_tx_limit) || 500, features || null, !!is_popular]
    );

    await logAudit({
      adminId: req.admin.adminId,
      action: "PLAN_CREATED",
      entityType: "plan",
      entityId: r.rows[0].id,
      details: name,
    });

    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch("/api/admin/plans/:id", adminAuth, async (req, res) => {
  try {
    const { name, price, monthly_tx_limit, features, is_popular, is_active } = req.body;
    const r = await db.query(
      `UPDATE plans SET
        name = COALESCE($1, name),
        price = COALESCE($2, price),
        monthly_tx_limit = COALESCE($3, monthly_tx_limit),
        features = COALESCE($4, features),
        is_popular = COALESCE($5, is_popular),
        is_active = COALESCE($6, is_active)
       WHERE id=$7 RETURNING *`,
      [name, price, monthly_tx_limit, features, is_popular, is_active, req.params.id]
    );
    if (!r.rows.length) return res.status(404).json({ error: "غير موجود" });

    await logAudit({
      adminId: req.admin.adminId,
      action: "PLAN_UPDATED",
      entityType: "plan",
      entityId: req.params.id,
    });

    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/admin/plans/:id", adminAuth, async (req, res) => {
  try {
    await db.query("UPDATE plans SET is_active=FALSE WHERE id=$1", [req.params.id]);
    await logAudit({
      adminId: req.admin.adminId,
      action: "PLAN_DISABLED",
      entityType: "plan",
      entityId: req.params.id,
    });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
//  ADMIN - AUDIT LOG
// ═══════════════════════════════════════════════
app.get("/api/admin/audit-logs", adminAuth, async (req, res) => {
  const r = await db.query(
    `SELECT a.*, t.name as tenant_name
     FROM audit_logs a
     LEFT JOIN tenants t ON t.id = a.tenant_id
     ORDER BY a.created_at DESC LIMIT 200`
  );
  res.json(r.rows);
});

// ═══════════════════════════════════════════════
//  INVOICES (للعملاء)
// ═══════════════════════════════════════════════
app.post("/api/invoices", auth, async (req, res) => {
  try {
    const check = await checkTenantActive(req.tenantId);
    if (!check.active) return res.status(403).json({ error: check.reason });

    const { invoice_number, partner_name, partner_id, issue_date, discount = 0, notes, items } = req.body;
    if (!items?.length) return res.status(400).json({ error: "لا توجد سطور" });

    let subtotal = 0, vatTotal = 0;
    for (const it of items) {
      const base = Number(it.quantity) * Number(it.unit_price);
      subtotal += base;
      vatTotal += base * Number(it.tax_rate);
    }
    const r2 = (n) => Math.round(n * 100) / 100;
    const subAfterDiscount = r2(subtotal - Number(discount));
    const vatAfterDiscount = subAfterDiscount > 0 ? r2(vatTotal * (subAfterDiscount / subtotal)) : 0;
    const total = r2(subAfterDiscount + vatAfterDiscount);

    const inv = await db.query(
      `INSERT INTO invoices (tenant_id, invoice_number, invoice_type, partner_id, partner_name,
        issue_date, subtotal, vat_amount, total, discount, notes)
       VALUES ($1,$2,'sale',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.tenantId, invoice_number, partner_id || null, partner_name || null,
       issue_date || new Date().toISOString().split("T")[0],
       subAfterDiscount, vatAfterDiscount, total, Number(discount), notes || null]
    );

    const invoice = inv.rows[0];
    for (const it of items) {
      const base = Number(it.quantity) * Number(it.unit_price);
      const v = base * Number(it.tax_rate);
      await db.query(
        `INSERT INTO invoice_items (invoice_id, product_id, description, quantity, unit_price, tax_rate, tax_amount, line_total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [invoice.id, it.product_id || null, it.description,
         Number(it.quantity), Number(it.unit_price), Number(it.tax_rate),
         r2(v), r2(base + v)]
      );
    }

    await db.query("UPDATE tenants SET current_month_tx = current_month_tx + 1 WHERE id=$1", [req.tenantId]);
    res.status(201).json(invoice);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/invoices", auth, async (req, res) => {
  try {
    const { q, from, to, status, page = 1, limit = 50 } = req.query;
    const conds = ["tenant_id = $1"];
    const params = [req.tenantId];
    let i = 2;

    if (q) { conds.push(`(invoice_number ILIKE $${i} OR partner_name ILIKE $${i})`); params.push(`%${q}%`); i++; }
    if (from) { conds.push(`issue_date >= $${i++}`); params.push(from); }
    if (to) { conds.push(`issue_date <= $${i++}`); params.push(to); }
    if (status) { conds.push(`status = $${i++}`); params.push(status); }

    const offset = (Number(page) - 1) * Number(limit);
    const result = await db.query(
      `SELECT * FROM invoices WHERE ${conds.join(" AND ")}
       ORDER BY issue_date DESC, created_at DESC LIMIT $${i} OFFSET $${i + 1}`,
      [...params, Number(limit), offset]
    );
    const total = await db.query(`SELECT COUNT(*) FROM invoices WHERE ${conds.join(" AND ")}`, params);

    res.json({
      data: result.rows,
      pagination: {
        page: Number(page), limit: Number(limit),
        total: Number(total.rows[0].count),
        pages: Math.ceil(Number(total.rows[0].count) / Number(limit)),
      },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/invoices/:id", auth, async (req, res) => {
  try {
    const inv = await db.query("SELECT * FROM invoices WHERE id=$1 AND tenant_id=$2", [req.params.id, req.tenantId]);
    if (!inv.rows.length) return res.status(404).json({ error: "الفاتورة غير موجودة" });
    const items = await db.query("SELECT * FROM invoice_items WHERE invoice_id=$1", [req.params.id]);
    res.json({ ...inv.rows[0], items: items.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/invoices/:id", auth, async (req, res) => {
  try {
    const r = await db.query(
      `UPDATE invoices SET status='cancelled' WHERE id=$1 AND tenant_id=$2 RETURNING id`,
      [req.params.id, req.tenantId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "الفاتورة غير موجودة" });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
//  PRODUCTS
// ═══════════════════════════════════════════════
app.get("/api/products", auth, async (req, res) => {
  const r = await db.query(
    "SELECT * FROM products WHERE tenant_id=$1 AND is_active=TRUE ORDER BY name",
    [req.tenantId]
  );
  res.json(r.rows);
});

app.post("/api/products", auth, async (req, res) => {
  try {
    const { name, sku, barcode, price, tax_rate, category } = req.body;
    if (!name) return res.status(400).json({ error: "الاسم مطلوب" });
    const r = await db.query(
      `INSERT INTO products (tenant_id, name, sku, barcode, price, tax_rate, category)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.tenantId, name, sku || null, barcode || null,
       Number(price) || 0, Number(tax_rate) || 0.14, category || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/products/:id", auth, async (req, res) => {
  await db.query("UPDATE products SET is_active=FALSE WHERE id=$1 AND tenant_id=$2", [req.params.id, req.tenantId]);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════
//  PARTNERS
// ═══════════════════════════════════════════════
app.get("/api/partners", auth, async (req, res) => {
  const r = await db.query("SELECT * FROM partners WHERE tenant_id=$1 ORDER BY name", [req.tenantId]);
  res.json(r.rows);
});

app.post("/api/partners", auth, async (req, res) => {
  try {
    const { name, type = "customer", tax_id, phone, email, address } = req.body;
    if (!name) return res.status(400).json({ error: "الاسم مطلوب" });
    const r = await db.query(
      `INSERT INTO partners (tenant_id, name, type, tax_id, phone, email, address)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.tenantId, name, type, tax_id || null, phone || null, email || null, address || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
//  DECLARATIONS
// ═══════════════════════════════════════════════
app.post("/api/declarations/generate", auth, async (req, res) => {
  try {
    const year = Number(req.body.year) || new Date().getFullYear();
    const month = Number(req.body.month) || new Date().getMonth() + 1;

    const sales = await db.query(
      `SELECT ii.tax_rate,
              SUM(ii.quantity * ii.unit_price) as base,
              SUM(ii.tax_amount) as vat
       FROM invoices i
       JOIN invoice_items ii ON ii.invoice_id = i.id
       WHERE i.tenant_id=$1 AND i.invoice_type='sale' AND i.status != 'cancelled'
         AND EXTRACT(YEAR FROM i.issue_date)=$2 AND EXTRACT(MONTH FROM i.issue_date)=$3
       GROUP BY ii.tax_rate`,
      [req.tenantId, year, month]
    );

    let s14 = 0, s5 = 0, s10 = 0, s0 = 0, vatOut = 0;
    for (const r of sales.rows) {
      const rate = Number(r.tax_rate);
      const base = Number(r.base);
      vatOut += Number(r.vat);
      if (rate === 0.14) s14 += base;
      else if (rate === 0.05) s5 += base;
      else if (rate === 0.10) s10 += base;
      else if (rate === 0) s0 += base;
    }
    const r2 = (n) => Math.round(n * 100) / 100;

    const existing = await db.query(
      `SELECT id FROM declarations WHERE tenant_id=$1 AND period_year=$2 AND period_month=$3`,
      [req.tenantId, year, month]
    );

    let result;
    if (existing.rows.length) {
      result = await db.query(
        `UPDATE declarations SET sales_standard=$1, sales_table=$2, sales_exports=$3, vat_output=$4, net_vat_due=$5
         WHERE id=$6 RETURNING *`,
        [r2(s14), r2(s5 + s10), r2(s0), r2(vatOut), r2(vatOut), existing.rows[0].id]
      );
    } else {
      result = await db.query(
        `INSERT INTO declarations (tenant_id, period_year, period_month, sales_standard, sales_table, sales_exports, vat_output, net_vat_due)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.tenantId, year, month, r2(s14), r2(s5 + s10), r2(s0), r2(vatOut), r2(vatOut)]
      );
    }

    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/declarations", auth, async (req, res) => {
  const r = await db.query(
    `SELECT * FROM declarations WHERE tenant_id=$1 ORDER BY period_year DESC, period_month DESC`,
    [req.tenantId]
  );
  res.json(r.rows);
});

app.get("/api/declarations/:id/eta-json", auth, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT d.*, t.name as tenant_name, t.tax_id as tenant_tax_id
       FROM declarations d JOIN tenants t ON t.id = d.tenant_id
       WHERE d.id=$1 AND d.tenant_id=$2`,
      [req.params.id, req.tenantId]
    );
    if (!r.rows.length) return res.status(404).json({ error: "غير موجود" });
    const d = r.rows[0];
    const payload = {
      taxpayer: { name: d.tenant_name, tax_id: d.tenant_tax_id },
      period: `${d.period_year}-${String(d.period_month).padStart(2, "0")}`,
      declaration_type: "VAT_MONTHLY",
      sales: {
        standard_14: Number(d.sales_standard),
        table_5: Number(d.sales_table),
        exports_0: Number(d.sales_exports),
      },
      vat: {
        output: Number(d.vat_output),
        input: Number(d.vat_input),
        net_due: Number(d.net_vat_due),
      },
      generated_at: new Date().toISOString(),
    };
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="declaration-${d.period_year}-${d.period_month}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
//  REPORTS
// ═══════════════════════════════════════════════
app.get("/api/reports/dashboard", auth, async (req, res) => {
  try {
    const current = await db.query(
      `SELECT COALESCE(SUM(subtotal),0) as sales, COALESCE(SUM(vat_amount),0) as vat, COUNT(*) as count
       FROM invoices WHERE tenant_id=$1 AND status != 'cancelled'
         AND EXTRACT(YEAR FROM issue_date)=EXTRACT(YEAR FROM NOW())
         AND EXTRACT(MONTH FROM issue_date)=EXTRACT(MONTH FROM NOW())`,
      [req.tenantId]
    );

    const monthly = await db.query(
      `SELECT to_char(issue_date,'YYYY-MM') as month, SUM(subtotal) as sales, SUM(vat_amount) as vat
       FROM invoices WHERE tenant_id=$1 AND status != 'cancelled' AND issue_date >= NOW() - INTERVAL '6 months'
       GROUP BY month ORDER BY month`,
      [req.tenantId]
    );

    const taxBreakdown = await db.query(
      `SELECT ii.tax_rate, SUM(ii.tax_amount) as vat
       FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id
       WHERE i.tenant_id=$1 AND i.status != 'cancelled' GROUP BY ii.tax_rate`,
      [req.tenantId]
    );

    res.json({
      currentMonth: {
        sales: Number(current.rows[0].sales),
        vat: Number(current.rows[0].vat),
        invoiceCount: Number(current.rows[0].count),
      },
      monthly: monthly.rows.map((r) => ({ month: r.month, sales: Number(r.sales || 0), vat: Number(r.vat || 0) })),
      taxBreakdown: taxBreakdown.rows.map((r) => ({ rate: Number(r.tax_rate), vat: Number(r.vat || 0) })),
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════
const PORT = process.env.PORT || 4000;
(async () => {
  await initDatabase();
  app.listen(PORT, () => {
    console.log("🚀 Muhasib Misr API on http://localhost:" + PORT);
    console.log("📍 Health: http://localhost:" + PORT + "/api/health");
    console.log("👑 Admin login: http://localhost:" + PORT + "/api/admin/login");
  });
})();
