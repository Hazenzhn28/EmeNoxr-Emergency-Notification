const POLL_MS = 5_000;
const LEASE_SECONDS = 30;          // how long a claim holds before another tick may retake it
const CLAIM_BATCH = 5;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_SECONDS = 10;
const STALE_AFTER_SECONDS = 10 * 60; // events this overdue (e.g. server was off) are expired, not fired

// How this fits together:
//   schedule()  inserts a row with due_at = now() + delay        (called when an alert is created)
//   tick()      every 5s: claim due rows atomically -> run handler -> mark done_at
//   cancel()    marks pending rows done when the parent responds
// Handlers are registered by action name, so this file knows nothing about Telegram or email.

function createEscalationService({ pool }) {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL pool is required to create the escalation service.");
  }

  const handlers = new Map(); // action -> { fn, runIf }
  let timer;
  let inFlight = Promise.resolve();
  let ticking = false;

  // runIf: the incident's parent_response must be one of these when the event comes due,
  // otherwise the event is skipped. This is the guard against "parent pressed False Alarm
  // a moment before the timer fired".
  function register(action, fn, { runIf = ["Pending"] } = {}) {
    if (typeof action !== "string" || action.length === 0) {
      throw new TypeError("An action name is required.");
    }
    if (typeof fn !== "function") {
      throw new TypeError("A handler function is required.");
    }
    handlers.set(action, { fn, runIf });
  }

  // Returns true if scheduled, false if this alert already has that action scheduled.
  async function schedule(alertId, { level, action, delayMs, detail = null }) {
    if (!Number.isInteger(level) || level < 1 || level > 3) {
      throw new TypeError("level must be 1, 2 or 3.");
    }
    if (typeof action !== "string" || action.length === 0 || action.length > 50) {
      throw new TypeError("action must be a string of 1 to 50 characters.");
    }
    if (!Number.isFinite(delayMs) || delayMs < 0) {
      throw new TypeError("delayMs must be a non-negative number.");
    }

    // The due time uses the database clock, so every server instance agrees on it.
    const result = await pool.query(
      `INSERT INTO public.escalation_events (alert_id, level, action, due_at, detail)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4::float8), $5)
       ON CONFLICT (alert_id, action) WHERE due_at IS NOT NULL DO NOTHING
       RETURNING id`,
      [alertId, level, action, delayMs / 1000, detail]
    );
    return result.rowCount > 0;
  }

  // Marks still-pending events done so they never fire. Optionally limited to certain actions.
  async function cancel(alertId, reason, { actions = null } = {}) {
    const result = await pool.query(
      `UPDATE public.escalation_events
       SET done_at = now(), detail = $2
       WHERE alert_id = $1
         AND done_at IS NULL
         AND due_at IS NOT NULL
         AND ($3::text[] IS NULL OR action = ANY($3::text[]))`,
      [alertId, reason, actions]
    );
    return result.rowCount;
  }

  // Audit-only row (no timer): records that something already happened.
  async function logEvent(alertId, { level, action, detail = null }) {
    await pool.query(
      `INSERT INTO public.escalation_events (alert_id, level, action, done_at, detail)
       VALUES ($1, $2, $3, now(), $4)`,
      [alertId, level, action, detail]
    );
  }

  // ---- The atomic claim -------------------------------------------------------------
  // One statement does select + lock + mark:
  //   * FOR UPDATE SKIP LOCKED: if another tick (or another server instance) is claiming
  //     at the same moment, it skips rows we've locked instead of waiting or double-taking them.
  //   * The UPDATE sets claimed_at before the lock is released, so the next tick no longer
  //     sees the row as available until the lease runs out.
  // done_at is NOT set here. It is set only after the handler succeeds (see finish()).
  async function claimDue() {
    const result = await pool.query(
      `UPDATE public.escalation_events AS e
       SET claimed_at = now(), attempts = e.attempts + 1
       WHERE e.id IN (
         SELECT id
         FROM public.escalation_events
         WHERE done_at IS NULL
           AND due_at IS NOT NULL
           AND due_at <= now()
           AND (claimed_at IS NULL OR claimed_at < now() - make_interval(secs => $1::float8))
         ORDER BY due_at
         LIMIT $2
         FOR UPDATE SKIP LOCKED
       )
       RETURNING e.id,
                 e.alert_id AS "alertId",
                 e.level,
                 e.action,
                 e.detail,
                 e.attempts`,
      [LEASE_SECONDS, CLAIM_BATCH]
    );
    return result.rows;
  }

  async function expireStale() {
    const result = await pool.query(
      `UPDATE public.escalation_events
       SET done_at = now(), detail = 'expired: overdue by more than ' || $1::int || ' seconds'
       WHERE done_at IS NULL
         AND due_at IS NOT NULL
         AND due_at < now() - make_interval(secs => $1::float8)`,
      [STALE_AFTER_SECONDS]
    );
    if (result.rowCount > 0) {
      console.warn(`Expired ${result.rowCount} overdue escalation event(s) without firing them.`);
    }
  }

  async function finish(eventId, detail) {
    await pool.query(
      `UPDATE public.escalation_events
       SET done_at = now(), detail = $2
       WHERE id = $1 AND done_at IS NULL`,
      [eventId, detail]
    );
  }

  // After a handler error: retry a couple of times, then give up and record the failure.
  async function failOrRetry(event) {
    if (event.attempts >= MAX_ATTEMPTS) {
      await finish(event.id, `failed after ${event.attempts} attempts`);
      return;
    }
    await pool.query(
      `UPDATE public.escalation_events
       SET claimed_at = NULL,
           due_at = now() + make_interval(secs => $2::float8),
           detail = 'retrying after an error'
       WHERE id = $1 AND done_at IS NULL`,
      [event.id, RETRY_DELAY_SECONDS]
    );
  }

  async function loadIncident(alertId) {
    const result = await pool.query(
      `SELECT alert_id AS "alertId",
              user_id AS "userId",
              parent_response AS "parentResponse",
              location_lat AS "locationLat",
              location_lng AS "locationLng"
       FROM public.incidents
       WHERE alert_id = $1`,
      [alertId]
    );
    return result.rows[0] || null;
  }

  async function dispatch(event) {
    const handler = handlers.get(event.action);
    if (!handler) {
      console.error("No escalation handler registered for:", event.action);
      await finish(event.id, "skipped: no handler registered");
      return;
    }

    const incident = await loadIncident(event.alertId);
    if (!incident) {
      await finish(event.id, "skipped: incident not found");
      return;
    }
    if (!handler.runIf.includes(incident.parentResponse)) {
      await finish(event.id, `skipped: parent response is ${incident.parentResponse}`);
      return;
    }

    let outcome;
    try {
      outcome = await handler.fn({ event, incident, finalAttempt: event.attempts >= MAX_ATTEMPTS });
    } catch (error) {
      // Name only: error messages from SMTP or Telegram can contain addresses or tokens.
      console.error(`Escalation handler "${event.action}" failed:`, error.name || "UnknownError");
      await failOrRetry(event);
      return;
    }
    await finish(event.id, typeof outcome === "string" ? outcome.slice(0, 500) : "completed");
  }

  async function tick() {
    if (ticking) return; // never let two ticks overlap inside this process
    ticking = true;
    try {
      await expireStale();
      const events = await claimDue();
      for (const event of events) {
        await dispatch(event);
      }
    } catch (error) {
      console.error("Escalation poll failed:", error.name || "UnknownError", error.code || "");
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (timer) return;
    inFlight = tick(); // run once immediately to pick up anything due while the server was down
    timer = setInterval(() => {
      inFlight = tick();
    }, POLL_MS);
    timer.unref?.();
  }

  // Resolves after any running tick finishes, so shutdown can safely close the pool next.
  async function stop() {
    clearInterval(timer);
    timer = undefined;
    await inFlight;
  }

  return { register, schedule, cancel, logEvent, start, stop, tick };
}

module.exports = { createEscalationService };