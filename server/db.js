import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

console.log("🔍 DEBUG - DB_URL:", process.env.DB_URL ? "Present" : "Missing");
console.log("🔍 DEBUG - NODE_ENV:", process.env.NODE_ENV);

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DB_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: false,
    require: true
  },
  allowExitOnIdle: false,
  maxUses: 7500
});

// Retry connection function
export async function openDB() {
  let retries = 3;
  while (retries > 0) {
    try {
      const client = await pool.connect();
      console.log("✅ Connected to PostgreSQL successfully!");
      await client.query("SELECT 1 AS test");
      console.log("✅ Database connection test passed!");
      client.release();
      return pool;
    } catch (err) {
      retries--;
      console.error(`❌ PostgreSQL connection error (${retries} retries left):`, err.message);
      if (retries === 0) {
        console.error("❌ All connection attempts failed");
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

// Safer query helper
export const query = async (text, params) => {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } catch (err) {
    console.error("❌ PostgreSQL query error:", {
      query: text.substring(0, 100) + "...",
      params,
      error: err.message
    });
    throw err;
  } finally {
    client.release();
  }
};

// Event listeners
pool.on("error", (err) => console.error("❌ Database pool error:", err.message));
pool.on("connect", () => console.log("🔗 New database connection established"));
pool.on("remove", () => console.log("🔗 Database connection removed"));

// Initialize ALL DB tables
export async function initDB() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ========================
    // 1. LOCATIONS TABLE (Cities → Regions)
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS locations (
        id SERIAL PRIMARY KEY,
        city_name VARCHAR(100) NOT NULL UNIQUE,
        region VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ========================
    // 2. DEPARTMENTS TABLE
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS departments (
        id SERIAL PRIMARY KEY,
        code VARCHAR(10) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ========================
    // 3. EMPLOYEES TABLE
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS employees (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        email VARCHAR(255) UNIQUE,
        ext VARCHAR(10),
        department_id INTEGER REFERENCES departments(id),
        responsible_location_id INTEGER REFERENCES locations(id),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ========================
    // 4. CLIENTS TABLE (with location_id)
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        location_id INTEGER REFERENCES locations(id),
        color TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ========================
    // 5. MACHINES TABLE (with installation_date)
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS machines (
        id SERIAL PRIMARY KEY,
        serial_number VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        client_id INTEGER REFERENCES clients(id),
        installation_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ========================
    // 6. STATUSES TABLE 
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS statuses (
        id SERIAL PRIMARY KEY,
        label TEXT NOT NULL UNIQUE,
        color TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ========================
    // 6a. SCHEDULE_TYPES TABLE 
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS schedule_types (
        id SERIAL PRIMARY KEY,
        type_name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ========================
    // 6b. SCHEDULE_STATES TABLE 
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS schedule_states (
        id SERIAL PRIMARY KEY,
        state_name VARCHAR(100) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // ========================
// 6c. CANCELLATION_REASONS TABLE 
// ========================
await client.query(`
  CREATE TABLE IF NOT EXISTS cancellation_reasons (
    id SERIAL PRIMARY KEY,
    reason TEXT NOT NULL,
    note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

// Add cancellation_reason_id to employee_schedule table
await client.query(`
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns 
      WHERE table_name = 'employee_schedule' 
      AND column_name = 'cancellation_reason_id'
    ) THEN
      ALTER TABLE employee_schedule 
      ADD COLUMN cancellation_reason_id INTEGER REFERENCES cancellation_reasons(id) ON DELETE SET NULL;
    END IF;
  END $$;
`);

// Create index for cancellation reasons
await client.query(`
  CREATE INDEX IF NOT EXISTS idx_schedule_cancellation 
  ON employee_schedule(cancellation_reason_id);
`);

    // ========================
    // X. EMPLOYEE_CLIENTS (join table for employee responsibilities)
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_clients (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        client_id INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
        role VARCHAR(50),
        primary_responsible BOOLEAN DEFAULT false,
        start_date DATE,
        end_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, client_id)
      );
    `);

    // Indexes for employee_clients
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emp_clients_employee ON employee_clients(employee_id);
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_emp_clients_client ON employee_clients(client_id);
    `);

    // ========================
    // 7. EMPLOYEE_SCHEDULE TABLE 
    // ========================
    await client.query(`
  CREATE TABLE IF NOT EXISTS employee_schedule (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    with_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL,
    status_id INTEGER REFERENCES statuses(id) ON DELETE SET NULL,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);
 
    // Add schedule_type_id column if it doesn't exist
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'employee_schedule' 
          AND column_name = 'schedule_type_id'
        ) THEN
          ALTER TABLE employee_schedule 
          ADD COLUMN schedule_type_id INTEGER REFERENCES schedule_types(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add schedule_state_id column if it doesn't exist
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'employee_schedule' 
          AND column_name = 'schedule_state_id'
        ) THEN
          ALTER TABLE employee_schedule 
          ADD COLUMN schedule_state_id INTEGER REFERENCES schedule_states(id) ON DELETE SET NULL;
        END IF;
      END $$;
    `);

    // Add postponed_date column if it doesn't exist
    await client.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'employee_schedule' 
          AND column_name = 'postponed_date'
        ) THEN
          ALTER TABLE employee_schedule 
          ADD COLUMN postponed_date DATE;
        END IF;
      END $$;
    `);

    // ========================
    // 8. EMPLOYEE_RELATIONSHIPS TABLE
    // ========================
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_relationships (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        linked_employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
        relationship_type VARCHAR(50) DEFAULT 'with',
        date DATE NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(employee_id, linked_employee_id, date, relationship_type)
      );
    `);

    // ========================
    // 9. EMAIL_SETTINGS TABLE
    // ========================
    await client.query(`
  CREATE TABLE IF NOT EXISTS email_settings (
    id SERIAL PRIMARY KEY,
    recipients TEXT[] DEFAULT '{}',  -- PostgreSQL array of emails
    include_weekends BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );
`);

/* ========================
-- AUDIT LOGS TABLE
 ======================== */
await client.query(`
CREATE TABLE IF NOT EXISTS audit_logs (
  id SERIAL PRIMARY KEY,

  -- Who did it
  user_id UUID NOT NULL,                     -- stable identity from Supabase
  user_email VARCHAR(255) NOT NULL,          -- snapshot for readability

  -- What and where
  action VARCHAR(20) NOT NULL,               -- 'CREATE' | 'UPDATE' | 'DELETE' | 'IMPORT'
  table_name VARCHAR(100) NOT NULL,          -- e.g., 'employees', 'clients'
  record_id TEXT,                            -- store PK as text; supports int or composite IDs

  -- What changed
  before JSONB,                              -- previous state (null for CREATE)
  after JSONB,                               -- new state (null for DELETE)

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- keep action values constrained
  CONSTRAINT audit_logs_action_chk
    CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'IMPORT'))
);
`);

await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs (created_at DESC);`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs (user_id);`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_user_email ON audit_logs (user_email);`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_table_name ON audit_logs (table_name);`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs (action);`);
await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_logs (table_name, record_id);`);
    // ========================
    // CREATE INDEXES FOR ALL TABLES
    // ========================

    // Locations indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_locations_region 
      ON locations(region);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_locations_city 
      ON locations(city_name);
    `);

    // Departments indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_departments_code 
      ON departments(code);
    `);

    // Employees indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employees_department 
      ON employees(department_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employees_location 
      ON employees(responsible_location_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_employees_email 
      ON employees(email);
    `);

    // Clients indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_clients_location 
      ON clients(location_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_clients_name 
      ON clients(name);
    `);

    // Machines indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_machines_client 
      ON machines(client_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_machines_serial 
      ON machines(serial_number);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_machines_name 
      ON machines(name);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_machines_install_date 
      ON machines(installation_date);
    `);

    // Statuses indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_statuses_label 
      ON statuses(label);
    `);

    // Employee schedule indexes 
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_schedule_employee_date 
      ON employee_schedule(employee_id, date);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_schedule_status 
      ON employee_schedule(status_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_schedule_client 
      ON employee_schedule(client_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_schedule_date 
      ON employee_schedule(date);
    `);

    // Employee relationships indexes
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rel_employee_date 
      ON employee_relationships(employee_id, date);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rel_linked_employee 
      ON employee_relationships(linked_employee_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_rel_date 
      ON employee_relationships(date);
    `);
        // Schedule Types index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_schedule_types 
      ON schedule_types(type_name);
    `);

    // Schedule States index
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_schedule_states 
      ON schedule_states(state_name);
    `);

    // Employee schedule indexes 
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_schedule_type 
      ON employee_schedule(schedule_type_id);
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_schedule_state 
      ON employee_schedule(schedule_state_id);
    `);



    await client.query("COMMIT");
    console.log("🗄️ PostgreSQL database initialized successfully with 9+ tables!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("❌ Failed to initialize PostgreSQL DB:", err);
    throw err;
  } finally {
    client.release();
  }
}

export { pool };