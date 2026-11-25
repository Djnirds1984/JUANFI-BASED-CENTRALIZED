import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { config } from './config';

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

const db = new Database(config.dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initializeDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS routers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 8728,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      use_rest_api INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS hotspot_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT 'default',
      uptime_limit TEXT DEFAULT '00:00:00',
      bytes_in_quota INTEGER DEFAULT 0,
      bytes_out_quota INTEGER DEFAULT 0,
      comment TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bandwidth_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      rate_limit TEXT NOT NULL,
      burst TEXT,
      priority INTEGER DEFAULT 8,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ppp_customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      username TEXT NOT NULL,
      password TEXT NOT NULL,
      profile TEXT NOT NULL DEFAULT 'default',
      service TEXT NOT NULL DEFAULT 'pppoe',
      local_address TEXT,
      remote_address TEXT,
      uptime_limit TEXT DEFAULT '00:00:00',
      bytes_in_quota INTEGER DEFAULT 0,
      bytes_out_quota INTEGER DEFAULT 0,
      comment TEXT,
      disabled INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS vouchers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      code TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      password TEXT,
      profile TEXT NOT NULL,
      duration_minutes INTEGER,
      data_limit_mb INTEGER,
      price REAL NOT NULL DEFAULT 0,
      is_used INTEGER NOT NULL DEFAULT 0,
      used_at TEXT,
      expires_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS monitoring_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      cpu_load INTEGER,
      memory_total INTEGER,
      memory_used INTEGER,
      uptime INTEGER,
      version TEXT,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS portal_files (
      path TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS active_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      mac_address TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      hostname TEXT NOT NULL DEFAULT '',
      custom_hostname TEXT NOT NULL DEFAULT '',
      user TEXT NOT NULL DEFAULT '',
      server TEXT NOT NULL DEFAULT '',
      login_by TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      uptime TEXT NOT NULL DEFAULT '',
      session_time_left TEXT NOT NULL DEFAULT '',
      bytes_in INTEGER NOT NULL DEFAULT 0,
      bytes_out INTEGER NOT NULL DEFAULT 0,
      rx_rate TEXT NOT NULL DEFAULT '0 bps',
      tx_rate TEXT NOT NULL DEFAULT '0 bps',
      mikrotik_active_id TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT,
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_token TEXT NOT NULL UNIQUE,
      mac_address TEXT NOT NULL DEFAULT '',
      previous_mac TEXT,
      username TEXT NOT NULL DEFAULT '',
      password TEXT,
      profile TEXT,
      router_id INTEGER NOT NULL DEFAULT 1,
      hotspot_server TEXT NOT NULL DEFAULT '',
      total_seconds INTEGER NOT NULL DEFAULT 0,
      remaining_seconds INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      is_online INTEGER NOT NULL DEFAULT 0,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_rebind_at TEXT,
      expires_at TEXT
      -- No FK on router_id: the portal can't know the controller's router id
      -- and defaults to 1; router_id is only used for admin grouping.
    );

    CREATE TABLE IF NOT EXISTS device_macs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mac_address TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL DEFAULT '',
      router_id INTEGER,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS session_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      old_mac TEXT NOT NULL DEFAULT '',
      new_mac TEXT NOT NULL DEFAULT '',
      hotspot_server TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL DEFAULT 'login',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES device_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS radius_clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL UNIQUE,
      shared_secret TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS radius_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER,
      log_type TEXT NOT NULL DEFAULT 'info',
      username TEXT DEFAULT '',
      source_ip TEXT DEFAULT '',
      response_code INTEGER,
      message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS radius_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      rate_rx INTEGER NOT NULL DEFAULT 0,
      rate_tx INTEGER NOT NULL DEFAULT 0,
      burst_rx INTEGER NOT NULL DEFAULT 0,
      burst_tx INTEGER NOT NULL DEFAULT 0,
      burst_threshold_rx INTEGER NOT NULL DEFAULT 0,
      burst_threshold_tx INTEGER NOT NULL DEFAULT 0,
      burst_time_rx INTEGER NOT NULL DEFAULT 0,
      burst_time_tx INTEGER NOT NULL DEFAULT 0,
      session_timeout INTEGER NOT NULL DEFAULT 0,
      idle_timeout INTEGER NOT NULL DEFAULT 0,
      quota_rx INTEGER NOT NULL DEFAULT 0,
      quota_tx INTEGER NOT NULL DEFAULT 0,
      quota_total INTEGER NOT NULL DEFAULT 0,
      validity_period INTEGER NOT NULL DEFAULT 0,
      validity_fixed_expiry TEXT,
      shared_users INTEGER NOT NULL DEFAULT 1,
      price REAL NOT NULL DEFAULT 0,
      is_default INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS radius_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      username TEXT NOT NULL,
      session_id TEXT NOT NULL,
      nas_ip TEXT,
      profile_id INTEGER,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      stopped_at TEXT,
      input_octets INTEGER NOT NULL DEFAULT 0,
      output_octets INTEGER NOT NULL DEFAULT 0,
      input_packets INTEGER NOT NULL DEFAULT 0,
      output_packets INTEGER NOT NULL DEFAULT 0,
      session_time INTEGER NOT NULL DEFAULT 0,
      terminate_cause TEXT,
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_radius_logs_router ON radius_logs(router_id);
    CREATE INDEX IF NOT EXISTS idx_radius_logs_created ON radius_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_radius_profiles_router ON radius_profiles(router_id);
    CREATE INDEX IF NOT EXISTS idx_radius_sessions_router ON radius_sessions(router_id, status);
    CREATE INDEX IF NOT EXISTS idx_radius_sessions_user ON radius_sessions(username);
    CREATE INDEX IF NOT EXISTS idx_radius_sessions_sid ON radius_sessions(session_id);

    CREATE INDEX IF NOT EXISTS idx_hotspot_users_router ON hotspot_users(router_id);
    CREATE INDEX IF NOT EXISTS idx_vouchers_router ON vouchers(router_id);
    CREATE INDEX IF NOT EXISTS idx_vouchers_code ON vouchers(code);
    CREATE INDEX IF NOT EXISTS idx_monitoring_logs_router ON monitoring_logs(router_id);
    CREATE INDEX IF NOT EXISTS idx_monitoring_logs_recorded ON monitoring_logs(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_active_devices_router ON active_devices(router_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_active_devices_mac ON active_devices(router_id, mac_address) WHERE mac_address <> '';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_device_sessions_mac ON device_sessions(router_id, mac_address) WHERE mac_address <> '';
    CREATE INDEX IF NOT EXISTS idx_device_sessions_username ON device_sessions(username);
    CREATE INDEX IF NOT EXISTS idx_device_macs_username ON device_macs(username);
    CREATE INDEX IF NOT EXISTS idx_session_bindings_session ON session_bindings(session_id);
    CREATE INDEX IF NOT EXISTS idx_radius_clients_router ON radius_clients(router_id);

    CREATE TABLE IF NOT EXISTS payment_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 0,
      provider TEXT NOT NULL DEFAULT 'paymongo',
      public_key TEXT NOT NULL DEFAULT '',
      secret_key TEXT NOT NULL DEFAULT '',
      webhook_secret TEXT NOT NULL DEFAULT '',
      currency TEXT NOT NULL DEFAULT 'PHP',
      amount REAL NOT NULL DEFAULT 0,
      minutes INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT 'Internet Time',
      methods TEXT NOT NULL DEFAULT 'qrph',
      button_label TEXT NOT NULL DEFAULT 'PAY GCASH',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL DEFAULT 'paymongo',
      router_id INTEGER,
      mac_address TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      minutes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      provider_ref TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      paid_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

    CREATE TABLE IF NOT EXISTS payment_rates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL DEFAULT 0,
      minutes INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS system_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      currency TEXT NOT NULL DEFAULT 'PHP',
      company_name TEXT NOT NULL DEFAULT 'MikroTik',
      logo_path TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Panel-tracked free trial (the portal TRIAL button). The router's own
    -- trial login bypasses RADIUS entirely (ghost "connected" devices with no
    -- tracked time), so the panel strips it and hands the trial out as real
    -- MAC-account time instead. One claim per device per day.
    CREATE TABLE IF NOT EXISTS trial_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      mac_address TEXT NOT NULL,
      claimed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(router_id, mac_address)
    );

    CREATE TABLE IF NOT EXISTS chat_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mac TEXT NOT NULL,
      router_id INTEGER NOT NULL DEFAULT 0,
      last_message_at TEXT,
      last_preview TEXT NOT NULL DEFAULT '',
      unread_admin INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(mac, router_id)
    );

    CREATE INDEX IF NOT EXISTS idx_chat_threads_last ON chat_threads(last_message_at DESC);

    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      image_path TEXT NOT NULL DEFAULT '',
      read_by_admin INTEGER NOT NULL DEFAULT 0,
      read_by_user INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (thread_id) REFERENCES chat_threads(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, id);

    /*
     * ---- Customer wallet -----------------------------------------------------
     * Money is stored as INTEGER centavos (1 peso = 100) everywhere in the
     * database: REAL pesos drift once they are added and subtracted, and a
     * wallet holds real money. Only the API speaks pesos.
     */
    CREATE TABLE IF NOT EXISTS wallet_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      pin_hash TEXT NOT NULL DEFAULT '',
      full_name TEXT NOT NULL DEFAULT '',
      mobile TEXT NOT NULL DEFAULT '',
      balance_centavos INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active',
      verified INTEGER NOT NULL DEFAULT 1,
      token_epoch INTEGER NOT NULL DEFAULT 0,
      registered_mac TEXT NOT NULL DEFAULT '',
      registered_router_id INTEGER NOT NULL DEFAULT 0,
      last_mac TEXT NOT NULL DEFAULT '',
      failed_logins INTEGER NOT NULL DEFAULT 0,
      locked_until TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Append-only ledger: a row is never edited or deleted, corrections are new
    -- rows, so balance_centavos can always be re-derived by summing the ledger.
    -- reference is UNIQUE, which is what makes a retried coin claim idempotent.
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      amount_centavos INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0,
      mac_address TEXT NOT NULL DEFAULT '',
      device_id INTEGER,
      device_name TEXT NOT NULL DEFAULT '',
      reference TEXT NOT NULL UNIQUE,
      note TEXT NOT NULL DEFAULT '',
      created_by TEXT NOT NULL DEFAULT 'portal',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_tx_account ON wallet_transactions(account_id, id DESC);

    -- A coin top-up in flight. The code doubles as the coin machine's active
    -- voucher key, so the machine itself only ever settles a session once.
    -- open -> settled (coins read from the machine) -> credited (ledger row).
    -- A crash between settled and credited is recovered by re-reading the
    -- stored coins instead of asking the machine again (its counter is gone).
    CREATE TABLE IF NOT EXISTS wallet_topup_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      account_id INTEGER NOT NULL,
      device_id INTEGER NOT NULL,
      device_ip TEXT NOT NULL,
      device_name TEXT NOT NULL DEFAULT '',
      router_id INTEGER NOT NULL DEFAULT 0,
      client_mac TEXT NOT NULL DEFAULT '',
      coins INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open',
      cleanup_needed INTEGER NOT NULL DEFAULT 0,
      cleanup_error TEXT NOT NULL DEFAULT '',
      tx_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      settled_at TEXT,
      FOREIGN KEY (account_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_topup_account ON wallet_topup_sessions(account_id, status);

    -- Devices an account has signed in on. Password restore is only honoured
    -- from one of these, because the code is delivered into that device's own
    -- portal chat - a stranger typing someone's email gets nothing.
    CREATE TABLE IF NOT EXISTS wallet_devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      mac TEXT NOT NULL,
      router_id INTEGER NOT NULL DEFAULT 0,
      hostname TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(account_id, mac),
      FOREIGN KEY (account_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE
    );

    -- One-shot restore codes. Only the SHA-256 is stored, so a database dump
    -- cannot be used to take over an account.
    CREATE TABLE IF NOT EXISTS wallet_auth_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'reset',
      code_hash TEXT NOT NULL,
      device_mac TEXT NOT NULL DEFAULT '',
      used_at TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (account_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_wallet_codes_account ON wallet_auth_codes(account_id, purpose);

    CREATE TABLE IF NOT EXISTS wallet_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      enabled INTEGER NOT NULL DEFAULT 1,
      -- A coin machine counts pulses; its rate table is priced in pesos, so the
      -- number it reports as totalCoin is a peso figure. Kept configurable for
      -- machines wired to a different denomination.
      coin_value_centavos INTEGER NOT NULL DEFAULT 100,
      min_topup_centavos INTEGER NOT NULL DEFAULT 100,
      max_topup_centavos INTEGER NOT NULL DEFAULT 500000,
      min_convert_centavos INTEGER NOT NULL DEFAULT 100,
      daily_convert_centavos INTEGER NOT NULL DEFAULT 0,
      require_verification INTEGER NOT NULL DEFAULT 0,
      topup_validity_min INTEGER NOT NULL DEFAULT 15,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- ============================================================
    -- PPPoE subscription billing
    -- ============================================================

    -- One row per RouterOS '/interface pppoe-server server' entry. The panel
    -- keeps the definition locally so the list still renders when the router is
    -- unreachable, and mikrotik_id holds the RouterOS .id of the last sync.
    CREATE TABLE IF NOT EXISTS pppoe_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      interface TEXT NOT NULL,
      service_name TEXT NOT NULL DEFAULT '',
      default_profile TEXT NOT NULL DEFAULT 'default',
      authentication TEXT NOT NULL DEFAULT 'pap,chap,mschap1,mschap2',
      one_session_per_host INTEGER NOT NULL DEFAULT 1,
      max_sessions INTEGER NOT NULL DEFAULT 0,
      max_mtu INTEGER NOT NULL DEFAULT 1480,
      max_mru INTEGER NOT NULL DEFAULT 1480,
      keepalive_timeout TEXT NOT NULL DEFAULT '10',
      disabled INTEGER NOT NULL DEFAULT 0,
      comment TEXT,
      mikrotik_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(router_id, name),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    -- A monthly plan IS a PPP profile plus a price: paying moves the subscriber
    -- onto pppoe_profile, not paying moves them to the cut-off profile.
    -- What a plan deliberately does NOT carry is the billing model: whether an
    -- account is postpaid or prepaid belongs to the subscriber, not to the price.
    CREATE TABLE IF NOT EXISTS billing_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL DEFAULT 0,
      cycle_days INTEGER NOT NULL DEFAULT 30,
      currency TEXT NOT NULL DEFAULT 'PHP',
      pppoe_profile TEXT NOT NULL,
      description TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(router_id, name),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    -- Per router because profiles are router objects. cutoff_day is the day of
    -- the month every bill on this router is due, so the whole book is collected
    -- on one date instead of scattered per install date.
    CREATE TABLE IF NOT EXISTS billing_settings (
      router_id INTEGER PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      cutoff_day INTEGER NOT NULL DEFAULT 1,
      grace_days INTEGER NOT NULL DEFAULT 3,
      expiry_time TEXT NOT NULL DEFAULT '00:00',
      non_payment_profile TEXT NOT NULL DEFAULT 'non-payment',
      default_plan_id INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Append-only money record. due_before/due_after make a collection audit
    -- possible without trusting the customer row's current state.
    CREATE TABLE IF NOT EXISTS ppp_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      plan_id INTEGER,
      amount REAL NOT NULL DEFAULT 0,
      cycle_days INTEGER NOT NULL DEFAULT 30,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      reference TEXT,
      due_before TEXT,
      due_after TEXT NOT NULL,
      recorded_by TEXT NOT NULL DEFAULT '',
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ppp_payments_customer ON ppp_payments(customer_id, created_at);

    -- Pisonet: a Windows desktop is sold minutes at a time, so the panel, not the
    -- hotspot session, owns the countdown. The machine is left bypassed on the
    -- router (it never has to log in) and the agent on the PC is what locks it.
    CREATE TABLE IF NOT EXISTS cafe_settings (
      router_id INTEGER PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'PHP',
      rate_list TEXT NOT NULL DEFAULT '',
      default_minutes INTEGER NOT NULL DEFAULT 60,
      admin_password_hash TEXT NOT NULL DEFAULT '',
      pause_on_admin INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cafe_machines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      mac_address TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      hostname TEXT NOT NULL DEFAULT '',
      device_id INTEGER,
      token TEXT NOT NULL DEFAULT '',
      -- 'client' is a paying customer sitting in front of the lock screen, 'admin'
      -- is the shop owner who unlocked the machine to service it.
      mode TEXT NOT NULL DEFAULT 'client',
      -- expires_at is the whole truth about the paid time: a deadline in UTC.
      -- Extending a running session pushes it out, and while an admin has the
      -- machine unlocked paused_at holds the instant the meter stopped so the
      -- remaining time survives being handed to the shop owner and back.
      expires_at TEXT,
      paused_at TEXT,
      running INTEGER NOT NULL DEFAULT 0,
      agent_version TEXT NOT NULL DEFAULT '',
      boot_id TEXT NOT NULL DEFAULT '',
      last_seen TEXT,
      unlocked_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cafe_machines_mac ON cafe_machines(router_id, mac_address) WHERE mac_address <> '';
    CREATE INDEX IF NOT EXISTS idx_cafe_machines_token ON cafe_machines(token);

    -- Beacons from an agent that is installed but has not been added to the shop
    -- yet. This is how the Add dialog can say "the app is already on this PC".
    CREATE TABLE IF NOT EXISTS cafe_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hostname TEXT NOT NULL,
      ip_address TEXT NOT NULL DEFAULT '',
      mac_address TEXT NOT NULL DEFAULT '',
      agent_version TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      added INTEGER NOT NULL DEFAULT 0
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_cafe_candidates_host ON cafe_candidates(hostname, ip_address);

    -- One row per sold minute block: what started it, what extended it, what
    -- locked it. The sales report reads this.
    CREATE TABLE IF NOT EXISTS cafe_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      router_id INTEGER NOT NULL,
      machine_id INTEGER NOT NULL,
      event TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 0,
      amount REAL NOT NULL DEFAULT 0,
      detail TEXT,
      operator TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_cafe_sessions_machine ON cafe_sessions(machine_id, created_at);
  `);

  const columns = db.prepare("PRAGMA table_info('routers')").all() as any[];
  if (!columns.some((c: any) => c.name === 'use_rest_api')) {
    db.exec("ALTER TABLE routers ADD COLUMN use_rest_api INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((c: any) => c.name === 'auth_mode')) {
    db.exec("ALTER TABLE routers ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'api'");
  }
  if (!columns.some((c: any) => c.name === 'portal_mode')) {
    db.exec("ALTER TABLE routers ADD COLUMN portal_mode TEXT NOT NULL DEFAULT 'mikrotik'");
  }
  if (!columns.some((c: any) => c.name === 'radius_local_users')) {
    // 0 = PURE RADIUS (never touch the router's local user list),
    // 1 = HYBRID (reuse/refresh an existing local user as a fallback).
    db.exec("ALTER TABLE routers ADD COLUMN radius_local_users INTEGER NOT NULL DEFAULT 0");
  }
  if (!columns.some((c: any) => c.name === 'panel_url')) {
    db.exec("ALTER TABLE routers ADD COLUMN panel_url TEXT NOT NULL DEFAULT ''");
  }
  // Migrate old portal_mode values to new values
  db.exec("UPDATE routers SET portal_mode = 'mikrotik' WHERE portal_mode IN ('local', 'radius')");

  const payCols = db.prepare("PRAGMA table_info('payment_settings')").all() as any[];
  if (payCols.length && !payCols.some((c: any) => c.name === 'methods')) {
    db.exec("ALTER TABLE payment_settings ADD COLUMN methods TEXT NOT NULL DEFAULT 'qrph'");
  }
  if (payCols.length && !payCols.some((c: any) => c.name === 'button_label')) {
    db.exec("ALTER TABLE payment_settings ADD COLUMN button_label TEXT NOT NULL DEFAULT 'PAY GCASH'");
  }

  const sysCols = db.prepare("PRAGMA table_info('system_settings')").all() as any[];
  if (!sysCols.some((c: any) => c.name === 'company_name')) {
    db.exec("ALTER TABLE system_settings ADD COLUMN company_name TEXT NOT NULL DEFAULT 'MikroTik'");
  }
  if (!sysCols.some((c: any) => c.name === 'logo_path')) {
    db.exec("ALTER TABLE system_settings ADD COLUMN logo_path TEXT NOT NULL DEFAULT ''");
  }
  // Coin sounds for the customer portal, uploaded on Portal > Sounds. Empty
  // means "use the sound shipped in hotspot/assets", never "play nothing".
  if (!sysCols.some((c: any) => c.name === 'insert_coin_sound')) {
    db.exec("ALTER TABLE system_settings ADD COLUMN insert_coin_sound TEXT NOT NULL DEFAULT ''");
  }
  if (!sysCols.some((c: any) => c.name === 'coin_drop_sound')) {
    db.exec("ALTER TABLE system_settings ADD COLUMN coin_drop_sound TEXT NOT NULL DEFAULT ''");
  }
  // Free-trial offer shown as the portal TRIAL button (tracked via RADIUS/coin
  // account path). On by default: the operator can turn it off per shop.
  if (!sysCols.some((c: any) => c.name === 'trial_enabled')) {
    db.exec("ALTER TABLE system_settings ADD COLUMN trial_enabled INTEGER NOT NULL DEFAULT 1");
  }
  if (!sysCols.some((c: any) => c.name === 'trial_minutes')) {
    db.exec("ALTER TABLE system_settings ADD COLUMN trial_minutes INTEGER NOT NULL DEFAULT 15");
  }

  const deviceCols = db.prepare("PRAGMA table_info('active_devices')").all() as any[];
  if (!deviceCols.some((c: any) => c.name === 'custom_hostname')) {
    db.exec("ALTER TABLE active_devices ADD COLUMN custom_hostname TEXT NOT NULL DEFAULT ''");
  }

  if (!deviceCols.some((c: any) => c.name === 'access_mode')) {
    db.exec("ALTER TABLE active_devices ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'normal'");
  }

  // PPP subscribers gained a monthly billing book: the plan they pay for, when
  // the next cycle is due, and what they were moved off. original_profile keeps
  // the paid plan profile while a subscriber is cut off so a payment restores
  // exactly what they had instead of guessing from the plan list.
  const pppCols = db.prepare("PRAGMA table_info('ppp_customers')").all() as any[];
  if (!pppCols.some((c: any) => c.name === 'plan_id')) {
    db.exec("ALTER TABLE ppp_customers ADD COLUMN plan_id INTEGER");
  }
  if (!pppCols.some((c: any) => c.name === 'due_date')) {
    db.exec("ALTER TABLE ppp_customers ADD COLUMN due_date TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_ppp_customers_due ON ppp_customers(router_id, due_date)");
  }
  if (!pppCols.some((c: any) => c.name === 'billing_status')) {
    db.exec("ALTER TABLE ppp_customers ADD COLUMN billing_status TEXT NOT NULL DEFAULT 'unbilled'");
  }
  if (!pppCols.some((c: any) => c.name === 'original_profile')) {
    db.exec("ALTER TABLE ppp_customers ADD COLUMN original_profile TEXT");
  }
  if (!pppCols.some((c: any) => c.name === 'last_paid_at')) {
    db.exec("ALTER TABLE ppp_customers ADD COLUMN last_paid_at TEXT");
  }
  // The API has always tagged a subscriber with the side that created it, but
  // the column was only ever added to hotspot_users, so creating a PPP customer
  // through the panel died on "no column named source".
  if (!pppCols.some((c: any) => c.name === 'source')) {
    db.exec("ALTER TABLE ppp_customers ADD COLUMN source TEXT NOT NULL DEFAULT 'api'");
  }
  // A subscriber now carries the day the line went in and the exact instant
  // their paid period ends, so the panel can arm a RouterOS scheduler job per
  // account instead of only relying on the panel-side sweep.
  if (!pppCols.some((c: any) => c.name === 'install_date')) {
    db.exec("ALTER TABLE ppp_customers ADD COLUMN install_date TEXT");
  }
  if (!pppCols.some((c: any) => c.name === 'scheduled_at')) {
    db.exec("ALTER TABLE ppp_customers ADD COLUMN scheduled_at TEXT");
  }
  // How this particular account is billed, chosen when the line is sold and
  // changeable per subscriber: postpaid owes on the shared cut-off day and gets
  // the grace period, prepaid runs a real cycle from the day it paid and is cut
  // off on the due date itself. Every account that existed before this is
  // postpaid, which is exactly how it has always been billed.
  if (!pppCols.some((c: any) => c.name === 'billing_type')) {
    db.exec("ALTER TABLE ppp_customers ADD COLUMN billing_type TEXT NOT NULL DEFAULT 'postpaid'");
  }

  // The billing model briefly lived on billing_plans. It never belonged there -
  // two subscribers on the same price can be billed differently - so databases
  // created while it was there lose the column. Older SQLite builds without
  // DROP COLUMN simply leave it unused.
  const planCols = db.prepare("PRAGMA table_info('billing_plans')").all() as any[];
  if (planCols.length && planCols.some((c: any) => c.name === 'plan_type')) {
    try {
      db.exec('ALTER TABLE billing_plans DROP COLUMN plan_type');
    } catch (err) {
      console.warn('[db] could not drop billing_plans.plan_type (harmless, the column is unused):', (err as Error).message);
    }
  }

  const sessCols = db.prepare("PRAGMA table_info('radius_sessions')").all() as any[];
  if (!sessCols.some((c: any) => c.name === 'mac_address')) {
    db.exec("ALTER TABLE radius_sessions ADD COLUMN mac_address TEXT NOT NULL DEFAULT ''");
    db.exec("CREATE INDEX IF NOT EXISTS idx_radius_sessions_mac ON radius_sessions(router_id, mac_address) WHERE mac_address <> ''");
  }
  if (!sessCols.some((c: any) => c.name === 'binding_id')) {
    db.exec("ALTER TABLE radius_sessions ADD COLUMN binding_id TEXT");
  }

  const portalCols = db.prepare("PRAGMA table_info('portal_files')").all() as any[];
  if (portalCols.some((c: any) => c.name === 'name') && !portalCols.some((c: any) => c.name === 'path')) {
    db.exec("ALTER TABLE portal_files RENAME COLUMN name TO path");
  }

  const voucherCols = db.prepare("PRAGMA table_info('vouchers')").all() as any[];
  const passwordCol = voucherCols.find((c: any) => c.name === 'password');
  if (passwordCol && passwordCol.notnull === 1) {
    db.exec(`
      CREATE TABLE vouchers_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        router_id INTEGER NOT NULL,
        code TEXT NOT NULL UNIQUE,
        username TEXT NOT NULL,
        password TEXT,
        profile TEXT NOT NULL,
        duration_minutes INTEGER,
        data_limit_mb INTEGER,
        is_used INTEGER NOT NULL DEFAULT 0,
        used_at TEXT,
        expires_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (router_id) REFERENCES routers(id) ON DELETE CASCADE
      );
      INSERT INTO vouchers_new SELECT * FROM vouchers;
      DROP TABLE vouchers;
      ALTER TABLE vouchers_new RENAME TO vouchers;
      CREATE INDEX idx_vouchers_router ON vouchers(router_id);
      CREATE INDEX idx_vouchers_code ON vouchers(code);
    `);
  }

  const hotspotUserCols = db.prepare("PRAGMA table_info('hotspot_users')").all() as any[];
  if (!hotspotUserCols.some((c: any) => c.name === 'source')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN source TEXT NOT NULL DEFAULT 'api'");
    db.exec("UPDATE hotspot_users SET source = 'api' WHERE source = ''");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'radius_profile_id')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN radius_profile_id INTEGER");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'total_bytes_in')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN total_bytes_in INTEGER NOT NULL DEFAULT 0");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'total_bytes_out')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN total_bytes_out INTEGER NOT NULL DEFAULT 0");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'total_session_time')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN total_session_time INTEGER NOT NULL DEFAULT 0");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'last_login_at')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN last_login_at TEXT");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'last_logout_at')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN last_logout_at TEXT");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'first_login_at')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN first_login_at TEXT");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'expiry_at')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN expiry_at TEXT");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'price')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN price REAL NOT NULL DEFAULT 0");
  }
  if (!hotspotUserCols.some((c: any) => c.name === 'shared_users')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN shared_users INTEGER NOT NULL DEFAULT 1");
  }
  // Portal "Pause Time": the account is disabled while paused so RADIUS rejects
  // re-auth (time cannot drain), but it must stay distinguishable from a logout
  // (which also disables). The frozen balance lives in device_sessions.
  if (!hotspotUserCols.some((c: any) => c.name === 'paused')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN paused INTEGER NOT NULL DEFAULT 0");
  }
  // One-shot expired grace: marks when the 60s "reach the portal" grace was
  // granted for the CURRENT expiry cycle, so re-auth/refresh cannot farm free
  // time. A top-up pushes expiry_at past this stamp, re-arming the next cycle.
  if (!hotspotUserCols.some((c: any) => c.name === 'grace_used_at')) {
    db.exec("ALTER TABLE hotspot_users ADD COLUMN grace_used_at TEXT");
  }

  const voucherCols2 = db.prepare("PRAGMA table_info('vouchers')").all() as any[];
  if (!voucherCols2.some((c: any) => c.name === 'radius_profile_id')) {
    db.exec("ALTER TABLE vouchers ADD COLUMN radius_profile_id INTEGER");
  }
  if (!voucherCols2.some((c: any) => c.name === 'price')) {
    db.exec("ALTER TABLE vouchers ADD COLUMN price REAL NOT NULL DEFAULT 0");
  }

  const allFiles = listHotspotFiles();
  const seedStmt = db.prepare('INSERT OR IGNORE INTO portal_files (path, content) VALUES (?, ?)');
  for (const f of allFiles) {
    if (!f.editable) continue;
    const content = getPortalDefaultContent(f.path);
    if (content !== null) {
      seedStmt.run(f.path, content);
    }
  }
}

export const EDITABLE_EXTENSIONS = new Set(['.html', '.htm', '.txt', '.css', '.js', '.svg']);

export interface HotspotFile {
  path: string;
  editable: boolean;
  size: number;
}

export function listHotspotFiles(folder?: string): HotspotFile[] {
  const root = path.join(__dirname, '..', folder === 'stub' ? 'stub' : 'hotspot');
  const files: HotspotFile[] = [];
  if (!fs.existsSync(root)) return files;
  const walk = (dir: string, prefix: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        walk(path.join(dir, e.name), rel);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        const editable = EDITABLE_EXTENSIONS.has(ext);
        const stat = fs.statSync(path.join(dir, e.name));
        files.push({ path: rel, editable, size: stat.size });
      }
    }
  };
  walk(root, '');
  return files;
}

export function getPortalDefaultContent(filePath: string, folder?: string): string | null {
  const root = path.join(__dirname, '..', folder === 'stub' ? 'stub' : 'hotspot');
  const fullPath = path.join(root, filePath);
  const realRoot = path.resolve(root);
  const realFull = path.resolve(fullPath);
  if (!realFull.startsWith(realRoot + path.sep) && realFull !== realRoot) return null;
  try {
    return fs.readFileSync(realFull, 'utf8');
  } catch {
    return null;
  }
}

export function getDb(): Database.Database {
  return db;
}

export function closeDb(): void {
  db.close();
}
