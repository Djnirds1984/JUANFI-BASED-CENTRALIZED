import { Router, Request, Response } from 'express';
import { getDb } from '../database';
import { mikroTikService } from '../services/mikrotik';
import { authMiddleware } from '../middleware/auth';
import {
  DEFAULT_BILLING_SETTINGS,
  assignPlan,
  computeDueDate,
  cutOffCustomer,
  formatDateOnly,
  getBillingOverview,
  getBillingPlan,
  getBillingSettings,
  listBillingPlans,
  normalizeBillingType,
  parseDueMoment,
  recordPayment,
  reconcileRouterProfiles,
  removeAccountCutoff,
  runCutoffSweep,
  saveBillingSettings,
  scheduleAccountCutoff,
} from '../services/pppBilling';

const router = Router();

router.use(authMiddleware);

// --- PPPoE Active Connections ---

router.get('/router/:routerId/active', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const connections = await mikroTikService.getPppActive(routerId);
    res.json(connections);
  } catch (error: any) {
    console.error('Get PPPoE active connections error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- PPP Customers (local) ---

router.get('/router/:routerId/customers', (_req: Request, res: Response) => {
  try {
    const routerId = parseInt((_req as any).params.routerId);
    const db = getDb();

    const customers = db
      .prepare(
        `SELECT c.*, p.name AS plan_name, p.price AS plan_price, p.cycle_days AS plan_cycle_days,
                p.currency AS plan_currency
         FROM ppp_customers c
         LEFT JOIN billing_plans p ON p.id = c.plan_id
         WHERE c.router_id = ? ORDER BY c.created_at DESC`
      )
      .all(routerId);
    res.json(customers);
  } catch (error) {
    console.error('Get PPP customers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


/**
 * Accept what a browser date/time input actually sends (`2026-11-22T14:30`) as
 * well as a bare day, and store it the way the billing code reads it. The wall
 * time is kept by string, never by Date arithmetic, so a picker set to 23:59
 * cannot drift an hour because of a timezone.
 */
function normalizeDateTime(value: any): string | null {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const raw = String(value).trim().replace('T', ' ');
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(raw);
  if (!match) return null;
  const day = `${match[1]}-${match[2]}-${match[3]}`;
  if (!parseDueMoment(day)) return null;
  if (match[4] === undefined) return day;
  const hour = Math.min(23, parseInt(match[4], 10));
  const minute = Math.min(59, parseInt(match[5], 10));
  return `${day} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * A skipped arming is normal behaviour, but saying nothing left the operator
 * looking at a customer with no router timer and no explanation. Word it as
 * information, never as a failure - the job was legitimately not needed.
 */
function scheduleNotice(skipped?: string): string | undefined {
  switch (skipped) {
    case 'billing disabled': return 'Billing is switched off on this router, so no cut-off timer was armed and the panel sweep will not cut this account off either';
    case 'no due date': return 'This account has no due date, so there is nothing for a cut-off timer to fire on';
    case 'already past': return 'The cut-off moment (due date plus grace) has already passed, so no timer was armed';
    default: return undefined;
  }
}


/**
 * An account is billed either postpaid (fixed cut-off day, grace period) or
 * prepaid (cycle counted from the day the money arrived, no grace). It is chosen
 * per subscriber, because two neighbours on the same plan price can be sold
 * different terms. Anything else is a typo in the form, so it is rejected rather
 * than filed under postpaid and quietly giving the subscriber grace days nobody
 * sold them.
 */
function readBillingType(value: any): { ok: true; type: string } | { ok: false; error: string } {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return { ok: true, type: 'postpaid' };
  if (raw !== 'postpaid' && raw !== 'prepaid') return { ok: false, error: 'Billing type is either postpaid or prepaid' };
  return { ok: true, type: raw };
}


router.post('/router/:routerId/customers', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const {
      name,
      username,
      password,
      planId,
      billingType,
      installDate,
      dueDate,
      profile,
      service,
      localAddress,
      remoteAddress,
      comment,
    } = req.body;

    if (!name || !username || !password) {
      res.status(400).json({ error: 'Name, username and password are required' });
      return;
    }
    const type = readBillingType(billingType);
    if (!type.ok) {
      res.status(400).json({ error: type.error });
      return;
    }

    const db = getDb();
    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }
    if (db.prepare('SELECT id FROM ppp_customers WHERE router_id = ? AND username = ?').get(routerId, username)) {
      res.status(409).json({ error: 'A customer with that username already exists on this router' });
      return;
    }

    // The speed comes from the billing plan, which already binds a PPPoE profile
    // carrying the rate-limit - which is why the customer form has no profile box.
    let plan = null as ReturnType<typeof getBillingPlan>;
    if (planId !== undefined && planId !== null && planId !== '' && Number(planId) !== 0) {
      plan = getBillingPlan(routerId, Number(planId));
      if (!plan) {
        res.status(400).json({ error: 'Pick a billing plan that exists on this router' });
        return;
      }
    }
    const effectiveProfile = String(plan?.pppoe_profile || profile || '').trim();
    if (!effectiveProfile) {
      res.status(400).json({ error: 'A billing plan (or a PPPoE profile) is required so the subscriber gets a speed' });
      return;
    }

    const install = normalizeDateTime(installDate);
    if (installDate && !install) {
      res.status(400).json({ error: 'Installation date is not a valid date' });
      return;
    }
    let due = normalizeDateTime(dueDate);
    if (dueDate && !due) {
      res.status(400).json({ error: 'Next due date is not a valid date and time' });
      return;
    }

    const settings = getBillingSettings(routerId);
    if (!due && plan) {
      // No explicit due date: give them the plan's own cycle from today. A
      // prepaid account counts that cycle in real months from the activation day,
      // so activating on the 23rd lands on the 23rd.
      due = formatDateOnly(computeDueDate({ anchorDate: null, settings, cycleDays: plan.cycle_days, billingType: type.type }).due);
    }

    let secretOnRouter = false;
    if (mikroTikService.isConnected(routerId)) {
      try {
        // The router login is the username; the display name only lives in the
        // panel, otherwise the subscriber could never authenticate.
        await mikroTikService.createPppSecret(routerId, {
          name: username,
          password,
          profile: effectiveProfile,
          service: service || 'pppoe',
          localAddress,
          remoteAddress,
          comment: comment || name,
        });
        secretOnRouter = true;
      } catch (err) {
        res.status(502).json({ error: `Router rejected the new login: ${(err as Error).message}` });
        return;
      }
    }

    const source = routerRow.auth_mode === 'radius' ? 'radius' : 'api';

    try {
      db.prepare(
        `INSERT INTO ppp_customers (router_id, name, username, password, profile, service, local_address, remote_address, comment, source, plan_id, due_date, install_date, billing_status, billing_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        routerId,
        name,
        username,
        password,
        effectiveProfile,
        service || 'pppoe',
        localAddress || null,
        remoteAddress || null,
        comment || null,
        source,
        plan?.id ?? null,
        due,
        install,
        due ? 'active' : 'unbilled',
        type.type,
      );
    } catch (error: any) {
      // The login already exists on the router; keeping it while the panel has
      // no record would leave a subscription nobody can bill or delete.
      if (secretOnRouter) {
        try {
          const secretId = await resolveSecretId(routerId, username);
          if (secretId) await mikroTikService.removePppSecret(routerId, secretId);
        } catch (rollbackErr) {
          console.error(`Could not roll back the login ${username} after the failed insert:`, (rollbackErr as Error).message);
        }
      }
      throw error;
    }

    // Arm this account's own cut-off timer on the router, so the subscriber is
    // moved to the non-payment profile at their due moment even if the panel is
    // down when it arrives.
    const created = db.prepare('SELECT id FROM ppp_customers WHERE router_id = ? AND username = ?').get(routerId, username) as any;
    const job = await scheduleAccountCutoff(routerId, username, due, { ...settings, billing_type: type.type });
    if (job.scheduledAt && created?.id) {
      db.prepare("UPDATE ppp_customers SET scheduled_at = ?, updated_at = datetime('now') WHERE id = ?").run(job.scheduledAt, created.id);
    }

    res.status(201).json({
      message: `PPP customer created${job.scheduledAt ? `, cut-off armed on the router for ${job.scheduledAt}` : ''}`,
      scheduledAt: job.scheduledAt,
      dueDate: due,
      profile: effectiveProfile,
      billingType: type.type,
      warning: job.error
        || scheduleNotice(job.skipped)
        || (secretOnRouter ? undefined : 'router was offline: the login was saved in the panel only'),
    });
  } catch (error: any) {
    console.error('Create PPP customer error:', error);
    res.status(500).json({ error: error.message });
  }
});


router.put('/router/:routerId/customers/:customerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);
    const {
      name,
      username,
      password,
      planId,
      billingType,
      installDate,
      dueDate,
      profile,
      service,
      localAddress,
      remoteAddress,
      comment,
    } = req.body;

    const db = getDb();
    const customer = db.prepare('SELECT * FROM ppp_customers WHERE id = ? AND router_id = ?').get(customerId, routerId) as any;
    if (!customer) {
      res.status(404).json({ error: 'PPP customer not found' });
      return;
    }
    const newUsername = username || customer.username;
    if (newUsername !== customer.username && db.prepare('SELECT id FROM ppp_customers WHERE router_id = ? AND username = ?').get(routerId, newUsername)) {
      res.status(409).json({ error: 'Another customer on this router already uses that username' });
      return;
    }

    // Same rule as the create form: picking a plan decides the speed.
    let plan = null as ReturnType<typeof getBillingPlan>;
    if (planId !== undefined && planId !== null && planId !== '' && Number(planId) !== 0) {
      plan = getBillingPlan(routerId, Number(planId));
      if (!plan) {
        res.status(400).json({ error: 'Pick a billing plan that exists on this router' });
        return;
      }
    }
    const nextProfile = String(plan?.pppoe_profile || profile || customer.profile || '').trim();

    // The billing model belongs to the account, so an edit that does not mention
    // it keeps whatever it was sold as. Switching an account to prepaid has to
    // re-arm its router timer for the due instant itself, with no grace added.
    const typeEdit = billingType === undefined ? null : readBillingType(billingType);
    if (typeEdit && !typeEdit.ok) {
      res.status(400).json({ error: typeEdit.error });
      return;
    }
    const nextBillingType = typeEdit?.type ?? normalizeBillingType(customer.billing_type);

    const installProvided = installDate !== undefined && installDate !== null;
    const install = installProvided ? normalizeDateTime(installDate) : null;
    if (installProvided && String(installDate).trim() !== '' && !install) {
      res.status(400).json({ error: 'Installation date is not a valid date' });
      return;
    }
    const dueProvided = dueDate !== undefined && dueDate !== null;
    const due = dueProvided ? normalizeDateTime(dueDate) : null;
    if (dueProvided && String(dueDate).trim() !== '' && !due) {
      res.status(400).json({ error: 'Next due date is not a valid date and time' });
      return;
    }
    // Pushing the due date out is the operator saying "they have paid me": the
    // record stops being flagged as overdue. Pulling it back does not fake a cut-off.
    const nextStatus = due && parseDueMoment(due) && parseDueMoment(due)! > new Date() ? 'active' : customer.billing_status;

    if (mikroTikService.isConnected(routerId)) {
      try {
        if (newUsername !== customer.username) {
          // RouterOS cannot rename a secret, so that one edit really does need
          // remove + re-add.
          const secretId = await resolveSecretId(routerId, customer.username);
          if (secretId) await mikroTikService.removePppSecret(routerId, secretId);
          await mikroTikService.createPppSecret(routerId, {
            name: newUsername,
            password: password || customer.password,
            profile: nextProfile,
            service: service || customer.service || 'pppoe',
            localAddress: localAddress ?? customer.local_address,
            remoteAddress: remoteAddress ?? customer.remote_address,
            comment: comment ?? customer.comment,
          });
        } else {
          // Everything else is a plain set on the existing login.
          const changes: Array<[string, string]> = [];
          if (password && password !== customer.password) changes.push(['password', password]);
          if (nextProfile && nextProfile !== customer.profile) changes.push(['profile', nextProfile]);
          if (service && service !== customer.service) changes.push(['service', service]);
          if (localAddress !== undefined) changes.push(['local-address', localAddress || '']);
          if (remoteAddress !== undefined) changes.push(['remote-address', remoteAddress || '']);
          if (comment !== undefined) changes.push(['comment', comment || '']);
          for (const [attr, value] of changes) {
            await mikroTikService.setPppSecretAttribute(routerId, customer.username, attr, value);
          }
          // A running session keeps the profile it authenticated with, so a
          // speed change only takes effect after a reconnect.
          if (nextProfile && nextProfile !== customer.profile) {
            await mikroTikService.disconnectPppSession(routerId, customer.username);
          }
        }
      } catch (err) {
        res.status(502).json({ error: `Router rejected the change: ${(err as Error).message}` });
        return;
      }
    }

    db.prepare(
      `UPDATE ppp_customers
       SET name = COALESCE(?, name), username = COALESCE(?, username), password = COALESCE(?, password),
           profile = COALESCE(?, profile), service = COALESCE(?, service), local_address = COALESCE(?, local_address),
           remote_address = COALESCE(?, remote_address), comment = COALESCE(?, comment),
           plan_id = COALESCE(?, plan_id),
           billing_type = COALESCE(?, billing_type),
           install_date = CASE WHEN ? = 1 THEN ? ELSE install_date END,
           due_date = CASE WHEN ? = 1 THEN ? ELSE due_date END,
           billing_status = COALESCE(?, billing_status),
           updated_at = datetime('now')
       WHERE id = ? AND router_id = ?`
    ).run(
      name ?? null, username ?? null, password ?? null, nextProfile || null, service ?? null,
      localAddress ?? null, remoteAddress ?? null, comment ?? null,
      plan?.id ?? null,
      nextBillingType,
      installProvided ? 1 : 0, install,
      dueProvided ? 1 : 0, due,
      nextStatus ?? null,
      customerId, routerId
    );

    const saved = db.prepare('SELECT due_date FROM ppp_customers WHERE id = ?').get(customerId) as any;
    let scheduledAt: string | null = null;
    let scheduleError: string | undefined;
    let scheduleSkipped: string | undefined;
    if (dueProvided || plan || nextProfile !== customer.profile || nextBillingType !== normalizeBillingType(customer.billing_type)) {
      // The timer belongs to the account, so renaming the login, moving the due
      // date or changing the billing model has to move the timer with it.
      if (newUsername !== customer.username) await removeAccountCutoff(routerId, customer.username);
      const job = await scheduleAccountCutoff(routerId, newUsername, saved?.due_date, { ...getBillingSettings(routerId), billing_type: nextBillingType });
      scheduledAt = job.scheduledAt;
      scheduleError = job.error;
      scheduleSkipped = job.skipped;
      db.prepare("UPDATE ppp_customers SET scheduled_at = ?, updated_at = datetime('now') WHERE id = ?").run(job.scheduledAt, customerId);
    }

    res.json({
      message: `PPP customer updated${scheduledAt ? `, cut-off armed on the router for ${scheduledAt}` : ''}`,
      scheduledAt,
      warning: scheduleError || scheduleNotice(scheduleSkipped),
    });
  } catch (error: any) {
    console.error('Update PPP customer error:', error);
    res.status(500).json({ error: error.message });
  }
});


router.delete('/router/:routerId/customers/:customerId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);

    const db = getDb();
    const customer = db.prepare('SELECT * FROM ppp_customers WHERE id = ? AND router_id = ?').get(customerId, routerId) as any;
    if (!customer) {
      res.status(404).json({ error: 'PPP customer not found' });
      return;
    }

    if (mikroTikService.isConnected(routerId)) {
      const secretId = await resolveSecretId(routerId, customer.username);
      if (secretId) {
        try {
          await mikroTikService.disconnectPppSession(routerId, customer.username);
          await mikroTikService.removePppSecret(routerId, secretId);
        } catch (err) {
          res.status(502).json({ error: `The router refused to remove the login: ${(err as Error).message}` });
          return;
        }
      }
      // A timer left behind would fire against a login that no longer exists.
      await removeAccountCutoff(routerId, customer.username);
    }

    db.prepare('DELETE FROM ppp_customers WHERE id = ? AND router_id = ?').run(customerId, routerId);

    res.json({ message: 'PPP customer deleted successfully' });
  } catch (error: any) {
    console.error('Delete PPP customer error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/customers/:customerId/enable', async (req: Request, res: Response) => {
  return togglePppCustomer(req, res, 0);
});

router.post('/router/:routerId/customers/:customerId/disable', async (req: Request, res: Response) => {
  return togglePppCustomer(req, res, 1);
});

async function togglePppCustomer(req: Request, res: Response, disabled: number) {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);

    const db = getDb();
    const customer = db.prepare('SELECT * FROM ppp_customers WHERE id = ? AND router_id = ?').get(customerId, routerId) as any;
    if (!customer) {
      res.status(404).json({ error: 'PPP customer not found' });
      return;
    }

    let warning: string | undefined;
    if (mikroTikService.isConnected(routerId)) {
      try {
        // Set by username: the panel row has no router-side id of its own.
        const applied = await mikroTikService.setPppSecretAttribute(routerId, customer.username, 'disabled', disabled === 1 ? 'yes' : 'no');
        if (!applied) warning = 'The login is not on the router anymore, the panel record was updated';
        else if (disabled === 1) await mikroTikService.disconnectPppSession(routerId, customer.username);
      } catch (err) {
        res.status(502).json({ error: `Router refused the change: ${(err as Error).message}` });
        return;
      }
    }

    db.prepare(
      'UPDATE ppp_customers SET disabled = ?, updated_at = datetime(\'now\') WHERE id = ? AND router_id = ?'
    ).run(disabled, customerId, routerId);

    res.json({ message: `PPP customer ${disabled === 1 ? 'disabled' : 'enabled'} successfully`, warning });
  } catch (error: any) {
    console.error('Toggle PPP customer error:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Panel rows carry no RouterOS `.id`, and the numeric id of a secret changes
 * whenever somebody recreates it in Winbox, so the username is the only
 * reliable way back to the live entry.
 */
async function resolveSecretId(routerId: number, username: string): Promise<string | null> {
  try {
    const secrets = await mikroTikService.getPppSecrets(routerId);
    const match = (Array.isArray(secrets) ? secrets : []).find((s: any) => String(s.name) === String(username));
    return match?.['.id'] ? String(match['.id']) : null;
  } catch (err) {
    console.error(`resolveSecretId lookup failed for ${username}:`, (err as Error).message);
    return null;
  }
}

// --- PPPoE servers (/interface pppoe-server server) ---

/**
 * Request body (camelCase) -> RouterOS property names. There is no `name`:
 * RouterOS gives a PPPoE server no name of its own, it is the (interface,
 * service-name) pair that identifies it.
 */
function serverParams(body: any): Record<string, any> {
  const params: Record<string, any> = {};
  if (body.interface !== undefined) params.interface = String(body.interface).trim();
  if (body.serviceName !== undefined) params['service-name'] = String(body.serviceName || '').trim();
  if (body.defaultProfile !== undefined) params['default-profile'] = body.defaultProfile || 'default';
  if (body.authentication !== undefined) params.authentication = body.authentication || 'pap,chap,mschap1,mschap2';
  if (body.oneSessionPerHost !== undefined) params['one-session-per-host'] = body.oneSessionPerHost ? 'yes' : 'no';
  if (body.maxSessions !== undefined) params['max-sessions'] = Number(body.maxSessions) || 0;
  if (body.maxMtu !== undefined) params['max-mtu'] = Number(body.maxMtu) || 1480;
  if (body.maxMru !== undefined) params['max-mru'] = Number(body.maxMru) || 1480;
  if (body.keepaliveTimeout !== undefined) params['keepalive-timeout'] = body.keepaliveTimeout || '10';
  if (body.comment !== undefined) params.comment = body.comment || '';
  return params;
}

/** Panel identity for a router-side server: `ether5`, or `ether5:speedy` when a service name is set. */
function serverKey(interfaceName: any, serviceName: any): string {
  const iface = String(interfaceName || '').trim();
  const svc = String(serviceName || '').trim();
  return svc ? `${iface}:${svc}` : iface;
}

/**
 * Mirror whatever the router is actually running into our table. Operators
 * create PPPoE servers in Winbox all the time; the sub-page should show those
 * too instead of only what was added through the panel.
 */
async function syncServersFromRouter(routerId: number): Promise<void> {
  if (!mikroTikService.isConnected(routerId)) return;
  const db = getDb();
  const live = await mikroTikService.getPppoeServers(routerId);
  const entries = Array.isArray(live) ? live : [];
  const upsert = db.prepare(
    `INSERT INTO pppoe_servers (router_id, name, interface, service_name, default_profile, authentication,
       one_session_per_host, max_sessions, max_mtu, max_mru, keepalive_timeout, disabled, comment, mikrotik_id, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(router_id, name) DO UPDATE SET
       interface = excluded.interface,
       service_name = excluded.service_name,
       default_profile = excluded.default_profile,
       authentication = excluded.authentication,
       one_session_per_host = excluded.one_session_per_host,
       max_sessions = excluded.max_sessions,
       max_mtu = excluded.max_mtu,
       max_mru = excluded.max_mru,
       keepalive_timeout = excluded.keepalive_timeout,
       disabled = excluded.disabled,
       comment = excluded.comment,
       mikrotik_id = excluded.mikrotik_id,
       updated_at = excluded.updated_at`
  );

  const seen: string[] = [];
  for (const entry of entries) {
    const interfaceName = String(entry.interface || '').trim();
    if (!interfaceName) continue;
    const key = serverKey(interfaceName, entry['service-name']);
    seen.push(key);
    upsert.run(
      routerId,
      key,
      interfaceName,
      String(entry['service-name'] || ''),
      String(entry['default-profile'] || 'default'),
      String(entry.authentication || 'pap,chap,mschap1,mschap2'),
      String(entry['one-session-per-host']) === 'true' || entry['one-session-per-host'] === true ? 1 : 0,
      String(entry['max-sessions'] ?? 0) === 'unlimited' ? 0 : Number(entry['max-sessions'] || 0),
      String(entry['max-mtu'] ?? 1480) === 'auto' ? 0 : Number(entry['max-mtu'] || 1480),
      String(entry['max-mru'] ?? 1480) === 'auto' ? 0 : Number(entry['max-mru'] || 1480),
      String(entry['keepalive-timeout'] || '10'),
      String(entry.disabled) === 'true' || entry.disabled === true ? 1 : 0,
      entry.comment ? String(entry.comment) : null,
      entry['.id'] ? String(entry['.id']) : null,
    );
  }

  // Anything the router no longer has is not a server we can talk about.
  const keep = seen.length ? seen : ['__none__'];
  db.prepare(
    `DELETE FROM pppoe_servers WHERE router_id = ? AND name NOT IN (${keep.map(() => '?').join(', ')})`
  ).run(routerId, ...keep);
}

router.get('/router/:routerId/pppoe-servers', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    try {
      await syncServersFromRouter(routerId);
    } catch (err) {
      // Offline router: fall back to the last known state rather than erroring.
      console.error(`pppoe-servers router sync failed for ${routerId}:`, (err as Error).message);
    }

    const rows = db.prepare('SELECT * FROM pppoe_servers WHERE router_id = ? ORDER BY name').all(routerId) as any[];
    let live: any[] = [];
    try {
      live = await mikroTikService.getPppoeServers(routerId);
    } catch {
      live = [];
    }
    const byName = new Map(
      (Array.isArray(live) ? live : [])
        .filter((e: any) => e.interface)
        .map((e: any) => [serverKey(e.interface, e['service-name']), e]),
    );

    // RouterOS flags a server `invalid` when the interface underneath it cannot
    // carry traffic at the moment. On a live box that is nearly always just an
    // unplugged port, so report the link state next to it and let the operator
    // reach for the cable instead of the config.
    let linkState: Map<string, boolean> | null = null;
    try {
      const interfaces = await mikroTikService.getInterfaces(routerId);
      if (Array.isArray(interfaces)) {
        linkState = new Map(interfaces.map((i: any) => [String(i.name), String(i.running) === 'true']));
      }
    } catch {
      linkState = null;
    }

    res.json(
      rows.map((row) => {
        const entry = byName.get(row.name);
        const invalid = entry ? String(entry.invalid) === 'true' : false;
        return {
          ...row,
          on_router: entry ? 1 : 0,
          running: entry ? (String(entry.disabled) === 'true' || invalid ? 0 : 1) : null,
          invalid: entry ? (invalid ? 1 : 0) : null,
          interface_down: entry && linkState ? (linkState.get(String(row.interface)) ? 0 : 1) : null,
          matches_any_service: entry ? String(entry['service-name'] || '') === '' : false,
          current_sessions: entry ? Number(entry['current-sessions'] || 0) : 0,
        };
      }),
    );
  } catch (error: any) {
    console.error('Get PPPoE servers error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/pppoe-servers', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();

    const routerRow = db.prepare('SELECT * FROM routers WHERE id = ?').get(routerId) as any;
    if (!routerRow) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    const params = serverParams(req.body);
    if (!params.interface) {
      res.status(400).json({ error: 'An interface is required' });
      return;
    }
    const key = serverKey(params.interface, params['service-name']);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(503).json({ error: 'Router is not connected; a PPPoE server only exists once the router accepts it' });
      return;
    }
    if (db.prepare('SELECT id FROM pppoe_servers WHERE router_id = ? AND name = ?').get(routerId, key)) {
      res.status(409).json({ error: `A PPPoE server is already defined on ${key}` });
      return;
    }

    try {
      await mikroTikService.createPppoeServer(routerId, params);
    } catch (err) {
      res.status(502).json({ error: `Router rejected the new PPPoE server: ${(err as Error).message}` });
      return;
    }

    // Store what the router really kept, not what we asked for.
    await syncServersFromRouter(routerId);
    const row = db.prepare('SELECT * FROM pppoe_servers WHERE router_id = ? AND name = ?').get(routerId, key) as any;
    if (!row) {
      res.status(502).json({ error: 'The router created the server but is not reporting it back yet' });
      return;
    }

    // RouterOS adds every new server disabled; only switch it on when asked to.
    if (req.body.disabled === false || req.body.disabled === 0) {
      try {
        await mikroTikService.setPppoeServerDisabled(routerId, String(row.mikrotik_id), false);
        db.prepare("UPDATE pppoe_servers SET disabled = 0, updated_at = datetime('now') WHERE id = ?").run(row.id);
      } catch (err) {
        res.status(502).json({ error: `Server created but it could not be started: ${(err as Error).message}` });
        return;
      }
    }

    res.status(201).json({ message: 'PPPoE server created', server: db.prepare('SELECT * FROM pppoe_servers WHERE id = ?').get(row.id) });
  } catch (error: any) {
    console.error('Create PPPoE server error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/pppoe-servers/:serverId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const serverId = parseInt(req.params.serverId);
    const db = getDb();

    const row = db.prepare('SELECT * FROM pppoe_servers WHERE id = ? AND router_id = ?').get(serverId, routerId) as any;
    if (!row) {
      res.status(404).json({ error: 'PPPoE server not found' });
      return;
    }
    if (!mikroTikService.isConnected(routerId)) {
      res.status(503).json({ error: 'Router is not connected; connect it before editing this server' });
      return;
    }

    const params = serverParams(req.body);
    if (req.body.disabled !== undefined) params.disabled = req.body.disabled ? 'yes' : 'no';
    if (!Object.keys(params).length) {
      res.status(400).json({ error: 'Nothing to update' });
      return;
    }

    const routerEntryId = await resolveRouterServerId(routerId, row);
    if (!routerEntryId) {
      res.status(409).json({ error: 'That server is no longer on the router. Delete it and add it again.' });
      return;
    }
    try {
      await mikroTikService.updatePppoeServer(routerId, routerEntryId, params);
    } catch (err) {
      res.status(502).json({ error: `Router rejected the change: ${(err as Error).message}` });
      return;
    }

    // The (interface, service-name) pair may have moved, so let the router
    // restate the whole list instead of patching our copy field by field.
    await syncServersFromRouter(routerId);
    const newKey = serverKey(
      params.interface !== undefined ? params.interface : row.interface,
      params['service-name'] !== undefined ? params['service-name'] : row.service_name,
    );
    const updated = db.prepare('SELECT * FROM pppoe_servers WHERE router_id = ? AND name = ?').get(routerId, newKey);
    res.json({ message: 'PPPoE server updated', server: updated || null });
  } catch (error: any) {
    console.error('Update PPPoE server error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * RouterOS has no name to match on, only the (interface, service-name) pair and
 * a numeric `.id` that goes stale the moment someone recreates the server in
 * Winbox, so trust a live pair lookup over what is in the database.
 */
async function resolveRouterServerId(routerId: number, row: any): Promise<string | null> {
  try {
    if (mikroTikService.isConnected(routerId)) {
      const live = await mikroTikService.getPppoeServers(routerId);
      const entries = Array.isArray(live) ? live : [];
      const match = entries.find((e: any) => serverKey(e.interface, e['service-name']) === row.name)
        || entries.find((e: any) => row.mikrotik_id && String(e['.id']) === String(row.mikrotik_id));
      if (match?.['.id']) return String(match['.id']);
      return null;
    }
  } catch (err) {
    console.error(`resolveRouterServerId lookup failed for ${row.name}:`, (err as Error).message);
  }
  return row.mikrotik_id ? String(row.mikrotik_id) : null;
}

router.delete('/router/:routerId/pppoe-servers/:serverId', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const serverId = parseInt(req.params.serverId);
    const db = getDb();

    const row = db.prepare('SELECT * FROM pppoe_servers WHERE id = ? AND router_id = ?').get(serverId, routerId) as any;
    if (!row) {
      res.status(404).json({ error: 'PPPoE server not found' });
      return;
    }

    if (!mikroTikService.isConnected(routerId)) {
      db.prepare('DELETE FROM pppoe_servers WHERE id = ? AND router_id = ?').run(serverId, routerId);
      res.json({ message: 'PPPoE server forgotten', warning: 'Router is not connected; it still runs whatever it had' });
      return;
    }

    const routerEntryId = await resolveRouterServerId(routerId, row);
    if (routerEntryId) {
      try {
        await mikroTikService.removePppoeServer(routerId, routerEntryId);
      } catch (err) {
        res.status(502).json({ error: `The router refused to remove it: ${(err as Error).message}` });
        return;
      }
    }

    await syncServersFromRouter(routerId);
    res.json({ message: 'PPPoE server deleted' });
  } catch (error: any) {
    console.error('Delete PPPoE server error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Pickers for the sub-pages (profiles and interfaces come from the router) ---

// RouterOS keeps PPPoE profiles in /ppp/profile and nowhere else, so the panel
// never mirrors them: the list is read live and enriched with who is using each
// one, because a profile with subscribers behind it must not be edited blindly.
function parseRateLimit(value: any): { rx: string; tx: string } {
  const raw = String(value || '').trim();
  if (!raw) return { rx: '', tx: '' };
  const [rx, tx] = raw.split('/');
  return { rx: rx || '', tx: tx || rx || '' };
}

function profileUsage(db: ReturnType<typeof getDb>, routerId: number) {
  const customers = db
    .prepare('SELECT profile, COUNT(*) AS n FROM ppp_customers WHERE router_id = ? GROUP BY profile')
    .all(routerId) as any[];
  const plans = db.prepare('SELECT name, pppoe_profile FROM billing_plans WHERE router_id = ?').all(routerId) as any[];
  const servers = db.prepare('SELECT name, default_profile FROM pppoe_servers WHERE router_id = ?').all(routerId) as any[];

  const byProfile = new Map<string, { customers: number; plans: string[]; servers: string[] }>();
  const entry = (profile: string) => {
    const key = String(profile || '').trim();
    if (!key) return null;
    if (!byProfile.has(key)) byProfile.set(key, { customers: 0, plans: [], servers: [] });
    return byProfile.get(key)!;
  };
  for (const row of customers) {
    const slot = entry(row.profile);
    if (slot) slot.customers += Number(row.n || 0);
  }
  for (const row of plans) {
    const slot = entry(row.pppoe_profile);
    if (slot) slot.plans.push(row.name);
  }
  for (const row of servers) {
    const slot = entry(row.default_profile);
    if (slot) slot.servers.push(row.name);
  }
  return byProfile;
}

router.get('/router/:routerId/ppp-profiles', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    if (!mikroTikService.isConnected(routerId)) {
      res.json([]);
      return;
    }

    const [profiles, secrets] = await Promise.all([
      mikroTikService.getPppProfiles(routerId),
      mikroTikService.getPppSecrets(routerId).catch(() => [] as any[]),
    ]);
    const db = getDb();
    const usage = profileUsage(db, routerId);
    const secretCounts = new Map<string, number>();
    for (const secret of Array.isArray(secrets) ? secrets : []) {
      const profile = String(secret.profile || '').trim();
      if (profile) secretCounts.set(profile, (secretCounts.get(profile) || 0) + 1);
    }

    res.json(
      (Array.isArray(profiles) ? profiles : []).map((p: any) => {
        const { rx, tx } = parseRateLimit(p['rate-limit']);
        const slot = usage.get(String(p.name || '')) || { customers: 0, plans: [], servers: [] };
        const secretCount = secretCounts.get(String(p.name || '')) || 0;
        return {
          id: p['.id'],
          name: p.name,
          rate_limit: String(p['rate-limit'] || ''),
          rx_limit: rx,
          tx_limit: tx,
          local_address: String(p['local-address'] || ''),
          remote_address: String(p['remote-address'] || ''),
          only_one: String(p['only-one'] || 'default'),
          change_tcp_mss: String(p['change-tcp-mss'] || 'default'),
          use_ipv6: String(p['use-ipv6'] || 'default'),
          use_encryption: String(p['use-encryption'] || 'default'),
          // default=true is a profile RouterOS shipped with; deleting it is not offered.
          built_in: String(p.default) === 'true',
          secrets: secretCount,
          customers: slot.customers,
          plans: slot.plans,
          servers: slot.servers,
          in_use: secretCount > 0 || slot.customers > 0 || slot.plans.length > 0 || slot.servers.length > 0,
        };
      }),
    );
  } catch (error: any) {
    console.error('Get PPP profiles error:', error);
    res.status(500).json({ error: error.message });
  }
});

// A profile name ends up inside RouterOS scripts and every secret refers to it
// by that text, so it is validated on the way in rather than repaired later.
function validProfileName(name: any): string | null {
  const value = String(name || '').trim();
  if (!value) return 'A profile name is required';
  if (value.length > 63) return 'Profile name is too long (63 characters max)';
  if (/["'\\;|&`$>\n\r]/.test(value)) return 'Profile name cannot contain quotes, backslashes or shell characters';
  return null;
}

/**
 * Build the RouterOS property set from the panel form. Only keys the caller
 * actually sent are included - the edit path relies on that so `set` never
 * touches a property the operator did not change.
 */
function profileParams(body: any, { forCreate }: { forCreate: boolean }): Record<string, any> {
  const data: Record<string, any> = {};

  if (body.name !== undefined) data.name = String(body.name).trim();

  if (body.rateLimit !== undefined) {
    // "10M" is how an operator writes a symmetrical cap; RouterOS wants rx/tx.
    const raw = String(body.rateLimit).trim();
    if (!raw) {
      // Clearing works on an existing profile, but an add with an empty
      // rate-limit is not something RouterOS was ever asked for here.
      if (!forCreate) data['rate-limit'] = '';
    } else if (raw.includes('/')) data['rate-limit'] = raw;
    else data['rate-limit'] = `${raw}/${raw}`;
  }

  // Proven on the hEX: an address can only be set to a real address or pool. An
  // empty value gets "ambiguous value of pool" and RouterOS' own default token
  // gets "input does not match any value of pool", so a blank is treated as
  // "not specified" - the create falls back to the RouterOS default and an edit
  // simply keeps whatever the profile already has.
  const local = String(body.localAddress ?? '').trim();
  if (body.localAddress !== undefined && local) data['local-address'] = local;
  const remote = String(body.remoteAddress ?? '').trim();
  if (body.remoteAddress !== undefined && remote) data['remote-address'] = remote;

  const switches: Array<[string, string]> = [
    ['onlyOne', 'only-one'],
    ['changeTcpMss', 'change-tcp-mss'],
    ['useIpv6', 'use-ipv6'],
    ['useEncryption', 'use-encryption'],
  ];
  for (const [from, to] of switches) {
    if (body[from] !== undefined && body[from] !== null && body[from] !== '') data[to] = String(body[from]);
  }

  if (forCreate && data['use-ipv6'] === undefined) data['use-ipv6'] = 'no';
  return data;
}

router.post('/router/:routerId/ppp-profiles', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const nameError = validProfileName(req.body.name);
    if (nameError) {
      res.status(400).json({ error: nameError });
      return;
    }
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const name = String(req.body.name).trim();
    const existing = await mikroTikService.getPppProfiles(routerId);
    if ((Array.isArray(existing) ? existing : []).some((p: any) => p.name === name)) {
      res.status(409).json({ error: `The router already has a profile called ${name}` });
      return;
    }

    const data = profileParams(req.body, { forCreate: true });
    try {
      await mikroTikService.createPppProfile(routerId, data);
    } catch (err) {
      res.status(502).json({ error: `Router rejected the profile: ${(err as Error).message}` });
      return;
    }

    res.status(201).json({ message: `Profile ${name} created on the router`, rate_limit: data['rate-limit'] || '' });
  } catch (error: any) {
    console.error('Create PPP profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function findProfile(routerId: number, name: string): Promise<any | null> {
  const profiles = await mikroTikService.getPppProfiles(routerId);
  return (Array.isArray(profiles) ? profiles : []).find((p: any) => p.name === name) || null;
}

router.put('/router/:routerId/ppp-profiles/:profileName', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const profileName = decodeURIComponent(req.params.profileName);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const profile = await findProfile(routerId, profileName);
    if (!profile?.['.id']) {
      res.status(404).json({ error: `No profile called ${profileName} on the router` });
      return;
    }

    const rename = req.body.name !== undefined && String(req.body.name).trim() !== profileName;
    if (rename) {
      // Secrets point at a profile by name, so a rename silently strands every
      // subscriber on it. They have to change the plan or the profile instead.
      res.status(400).json({ error: 'A profile cannot be renamed: subscribers refer to it by name. Create the new one and move the plans across.' });
      return;
    }

    const data = profileParams(req.body, { forCreate: false });
    delete data.name;
    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'Nothing to change' });
      return;
    }

    try {
      await mikroTikService.updatePppProfile(routerId, profile['.id'], data);
    } catch (err) {
      res.status(502).json({ error: `Router rejected the change: ${(err as Error).message}` });
      return;
    }

    // A profile change is a speed change, and a running session keeps the limits
    // it authenticated with, so the live sessions on it have to reconnect.
    const reconnected = data['rate-limit'] !== undefined
      ? await disconnectProfileSessions(routerId, profileName)
      : 0;

    res.json({ message: `Profile ${profileName} updated on the router`, reconnected });
  } catch (error: any) {
    console.error('Update PPP profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function disconnectProfileSessions(routerId: number, profileName: string): Promise<number> {
  try {
    const [secrets, sessions] = await Promise.all([
      mikroTikService.getPppSecrets(routerId),
      mikroTikService.getPppActive(routerId),
    ]);
    const onProfile = new Set(
      (Array.isArray(secrets) ? secrets : [])
        .filter((s: any) => String(s.profile || '') === profileName)
        .map((s: any) => String(s.name || '')),
    );
    let dropped = 0;
    for (const session of Array.isArray(sessions) ? sessions : []) {
      if (!onProfile.has(String(session.name || ''))) continue;
      try {
        await mikroTikService.removePppActive(routerId, session['.id']);
        dropped++;
      } catch (err) {
        console.error(`Could not drop ${session.name} after the profile change:`, (err as Error).message);
      }
    }
    return dropped;
  } catch (err) {
    // Nobody loses money over a reconnect that did not happen.
    console.error('disconnectProfileSessions failed:', (err as Error).message);
    return 0;
  }
}

router.delete('/router/:routerId/ppp-profiles/:profileName', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const profileName = decodeURIComponent(req.params.profileName);
    if (!mikroTikService.isConnected(routerId)) {
      res.status(400).json({ error: 'Router is not connected' });
      return;
    }

    const profile = await findProfile(routerId, profileName);
    if (!profile?.['.id']) {
      res.json({ message: `Profile ${profileName} is not on the router anymore`, gone: true });
      return;
    }
    if (String(profile.default) === 'true') {
      res.status(400).json({ error: `${profileName} is a built-in RouterOS profile and cannot be deleted` });
      return;
    }

    const secrets = await mikroTikService.getPppSecrets(routerId).catch(() => [] as any[]);
    const using = (Array.isArray(secrets) ? secrets : []).filter((s: any) => String(s.profile || '') === profileName);
    const slot = profileUsage(getDb(), routerId).get(profileName);
    if (using.length > 0 || (slot && (slot.customers > 0 || slot.plans.length > 0 || slot.servers.length > 0))) {
      const who = [
        using.length > 0 ? `${using.length} router login(s)` : '',
        slot?.customers ? `${slot.customers} customer record(s)` : '',
        slot?.plans.length ? `billing plan(s): ${slot.plans.join(', ')}` : '',
        slot?.servers.length ? `PPPoE server default(s): ${slot.servers.join(', ')}` : '',
      ].filter(Boolean).join('; ');
      // Deleting a profile that is handed out would drop those subscribers onto
      // RouterOS defaults, which is never what the operator meant.
      res.status(409).json({ error: `Still in use - ${who}. Move them first, or edit this profile's speed instead.` });
      return;
    }

    try {
      await mikroTikService.removePppProfile(routerId, profile['.id']);
    } catch (err) {
      res.status(502).json({ error: `The router refused to delete the profile: ${(err as Error).message}` });
      return;
    }

    res.json({ message: `Profile ${profileName} deleted from the router` });
  } catch (error: any) {
    console.error('Delete PPP profile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Billing plans ---

router.get('/router/:routerId/billing/plans', (req: Request, res: Response) => {
  try {
    res.json(listBillingPlans(parseInt(req.params.routerId)));
  } catch (error) {
    console.error('Get billing plans error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// A plan is only ever a price, a cycle and a profile. Whether the subscriber
// paying it is postpaid or prepaid is decided on the account, so nothing here
// validates a billing model.
router.post('/router/:routerId/billing/plans', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const { name, price, cycleDays, currency, pppoeProfile, description, isActive } = req.body;

    if (!name || !pppoeProfile) {
      res.status(400).json({ error: 'Plan name and PPPoE profile are required' });
      return;
    }

    const db = getDb();
    if (db.prepare('SELECT id FROM billing_plans WHERE router_id = ? AND name = ?').get(routerId, name)) {
      res.status(409).json({ error: 'A billing plan with that name already exists on this router' });
      return;
    }

    db.prepare(
      `INSERT INTO billing_plans (router_id, name, price, cycle_days, currency, pppoe_profile, description, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      routerId,
      name,
      Number(price) || 0,
      Math.max(1, parseInt(cycleDays, 10) || 30),
      currency || 'PHP',
      pppoeProfile,
      description || null,
      isActive === undefined || isActive ? 1 : 0,
    );

    res.status(201).json({ message: 'Billing plan created' });
  } catch (error: any) {
    console.error('Create billing plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.put('/router/:routerId/billing/plans/:planId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const planId = parseInt(req.params.planId);
    const { name, price, cycleDays, currency, pppoeProfile, description, isActive } = req.body;

    const db = getDb();
    if (!getBillingPlan(routerId, planId)) {
      res.status(404).json({ error: 'Billing plan not found' });
      return;
    }

    db.prepare(
      `UPDATE billing_plans SET
         name = COALESCE(?, name),
         price = COALESCE(?, price),
         cycle_days = COALESCE(?, cycle_days),
         currency = COALESCE(?, currency),
         pppoe_profile = COALESCE(?, pppoe_profile),
         description = COALESCE(?, description),
         is_active = COALESCE(?, is_active),
         updated_at = datetime('now')
       WHERE id = ? AND router_id = ?`
    ).run(
      name ?? null,
      price === undefined ? null : Number(price) || 0,
      cycleDays === undefined ? null : Math.max(1, parseInt(cycleDays, 10) || 30),
      currency ?? null,
      pppoeProfile ?? null,
      description === undefined ? null : (description || null),
      isActive === undefined ? null : (isActive ? 1 : 0),
      planId,
      routerId,
    );

    res.json({ message: 'Billing plan updated' });
  } catch (error: any) {
    console.error('Update billing plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.delete('/router/:routerId/billing/plans/:planId', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const planId = parseInt(req.params.planId);
    const db = getDb();

    if (!getBillingPlan(routerId, planId)) {
      res.status(404).json({ error: 'Billing plan not found' });
      return;
    }

    const inUse = db.prepare('SELECT COUNT(*) AS n FROM ppp_customers WHERE plan_id = ? AND router_id = ?').get(planId, routerId) as any;
    if (Number(inUse?.n || 0) > 0) {
      // Customers still point at this plan; disabling it keeps their history
      // readable and stops it showing up in the pickers.
      db.prepare("UPDATE billing_plans SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND router_id = ?").run(planId, routerId);
      res.json({ message: 'Plan has customers, deactivated instead of deleted', deactivated: true, customers: Number(inUse.n) });
      return;
    }

    db.prepare('DELETE FROM billing_plans WHERE id = ? AND router_id = ?').run(planId, routerId);
    res.json({ message: 'Billing plan deleted' });
  } catch (error: any) {
    console.error('Delete billing plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Billing settings ---

router.get('/router/:routerId/billing/settings', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    res.json({ ...DEFAULT_BILLING_SETTINGS, ...getBillingSettings(routerId) });
  } catch (error) {
    console.error('Get billing settings error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/router/:routerId/billing/settings', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();
    if (!db.prepare('SELECT id FROM routers WHERE id = ?').get(routerId)) {
      res.status(404).json({ error: 'Router not found' });
      return;
    }

    const { enabled, cutoffDay, graceDays, expiryTime, nonPaymentProfile, defaultPlanId } = req.body;
    const profile = nonPaymentProfile === undefined ? undefined : String(nonPaymentProfile).trim();
    if (profile === '') {
      res.status(400).json({ error: 'A non-payment profile is required before billing can be saved' });
      return;
    }

    const saved = saveBillingSettings(routerId, {
      enabled,
      cutoff_day: cutoffDay,
      grace_days: graceDays,
      expiry_time: expiryTime,
      non_payment_profile: profile,
      default_plan_id: defaultPlanId,
    });

    // Switching billing on is the moment customers start owing money, so run a
    // pass immediately instead of waiting for the next scheduler tick.
    if (saved.enabled) void runCutoffSweep(new Date(), routerId).catch(() => {});

    res.json(saved);
  } catch (error: any) {
    console.error('Save billing settings error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/billing/overview', (req: Request, res: Response) => {
  try {
    res.json(getBillingOverview(parseInt(req.params.routerId)));
  } catch (error) {
    console.error('Get billing overview error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/** Run the cut-off pass right now (the scheduler does the same every minute). */
router.post('/router/:routerId/billing/sweep', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const report = await runCutoffSweep(new Date(), routerId);
    res.json({ ...report, details: report.details.filter((d) => d.routerId === routerId) });
  } catch (error: any) {
    console.error('Billing sweep error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Ask the router what profile each of our accounts is really on and copy that
 * back into the panel. The account's own RouterOS timer cuts people off even
 * while we are restarting, and Winbox edits never pass through this server, so
 * this is how the table stops showing a profile the subscriber left behind.
 */
router.post('/router/:routerId/billing/reconcile', async (req: Request, res: Response) => {
  try {
    const report = await reconcileRouterProfiles(parseInt(req.params.routerId));
    res.json(report);
  } catch (error: any) {
    console.error('Billing reconcile error:', error);
    res.status(500).json({ error: error.message });
  }
});

// --- Per-customer billing actions ---

router.post('/router/:routerId/customers/:customerId/plan', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);
    const { planId, cycles } = req.body;

    if (!planId) {
      res.status(400).json({ error: 'planId is required' });
      return;
    }

    const result = await assignPlan(routerId, customerId, Number(planId), { cycles: cycles ? Number(cycles) : 1 });
    if (!result) {
      res.status(404).json({ error: 'PPP customer not found' });
      return;
    }
    res.json(result);
  } catch (error: any) {
    console.error('Assign billing plan error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/customers/:customerId/pay', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);

    const result = await recordPayment(routerId, customerId, {
      planId: req.body.planId ?? null,
      cycles: req.body.cycles ? Number(req.body.cycles) : 1,
      amount: req.body.amount === undefined || req.body.amount === '' ? null : Number(req.body.amount),
      paymentMethod: req.body.paymentMethod || 'cash',
      reference: req.body.reference ?? null,
      note: req.body.note ?? null,
      recordedBy: req.user?.username || '',
    });
    if (!result) {
      res.status(404).json({ error: 'PPP customer not found' });
      return;
    }
    res.json(result);
  } catch (error: any) {
    console.error('Record PPP payment error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/router/:routerId/customers/:customerId/cutoff', async (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);

    const result = await cutOffCustomer(routerId, customerId, {
      profile: req.body.profile ? String(req.body.profile) : undefined,
    });
    if (!result) {
      res.status(404).json({ error: 'PPP customer not found' });
      return;
    }
    res.json(result);
  } catch (error: any) {
    console.error('Manual PPP cut-off error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/router/:routerId/customers/:customerId/payments', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const customerId = parseInt(req.params.customerId);
    const db = getDb();

    const payments = db
      .prepare(
        `SELECT p.*, b.name AS plan_name
         FROM ppp_payments p
         LEFT JOIN billing_plans b ON b.id = p.plan_id
         WHERE p.router_id = ? AND p.customer_id = ?
         ORDER BY p.created_at DESC LIMIT 100`
      )
      .all(routerId, customerId);
    res.json(payments);
  } catch (error) {
    console.error('Get customer payments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/router/:routerId/billing/payments', (req: Request, res: Response) => {
  try {
    const routerId = parseInt(req.params.routerId);
    const db = getDb();
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string, 10) || 100));

    const payments = db
      .prepare(
        `SELECT p.*, b.name AS plan_name, c.username AS customer_username, c.name AS customer_name
         FROM ppp_payments p
         LEFT JOIN billing_plans b ON b.id = p.plan_id
         LEFT JOIN ppp_customers c ON c.id = p.customer_id
         WHERE p.router_id = ?
         ORDER BY p.created_at DESC LIMIT ${limit}`
      )
      .all(routerId);
    res.json(payments);
  } catch (error) {
    console.error('Get billing payments error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;



