const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const lockfile = require('proper-lockfile');
const { pathIdentity: normalizedPath } = require('./pathIdentity');

const LOCK_OPTIONS = {
  realpath: false,
  stale: 10000,
  update: 2000,
  retries: { retries: 80, minTimeout: 25, maxTimeout: 125 }
};
const ORPHAN_START_GRACE_MS = 120000;

function sharedUserStoragePath(fallbackPath) {
  if (process.env.LOCALAPPDATA) return path.join(process.env.LOCALAPPDATA, 'Orchestrator-AI');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Orchestrator-AI');
  if (process.platform === 'win32') return path.join(os.tmpdir(), 'Orchestrator-AI');
  if (os.homedir()) return path.join(os.homedir(), '.local', 'share', 'orchestrator-ai');
  return fallbackPath;
}

function sessionIdOf(session) {
  return String(session?.id || session?.sessionId || '').trim();
}

function sessionProjectOf(session) {
  const project = session?.projectPath || session?.root || '';
  return project ? normalizedPath(project) : '';
}

function externalSessionActivity(projectRoot, leases, sessions) {
  const root = normalizedPath(projectRoot);
  const activeLeaseIds = new Set(leases
    .filter(lease => ['starting', 'running'].includes(lease.status))
    .map(sessionIdOf)
    .filter(Boolean));
  let active = 0;
  let uncertain = 0;
  for (const session of sessions) {
    const project = sessionProjectOf(session);
    // Lich's sessions contract includes projectPath. If it is missing, count
    // the session conservatively because it cannot be proven unrelated.
    if (project && project !== root) continue;
    const sessionId = sessionIdOf(session);
    if (sessionId && activeLeaseIds.has(sessionId)) continue;
    const state = String(session?.state || '').trim().toLowerCase();
    if (state === 'done') continue;
    active++;
    if (!['busy', 'waiting'].includes(state)) uncertain++;
  }
  return { active, uncertain };
}

class SharedTaskSlots {
  constructor(storagePath, ownerId, legacyStoragePath) {
    this.storagePath = storagePath;
    this.ownerId = ownerId;
    this.legacyStoragePath = legacyStoragePath && normalizedPath(legacyStoragePath) !== normalizedPath(storagePath)
      ? legacyStoragePath : '';
  }

  ledgerPath(projectRoot) {
    const projectKey = crypto.createHash('sha256').update(normalizedPath(projectRoot)).digest('hex');
    return path.join(this.storagePath, 'task-slots', `${projectKey}.json`);
  }

  profileLedgerPath(profileId) {
    const profileKey = crypto.createHash('sha256').update(String(profileId)).digest('hex');
    return path.join(this.storagePath, 'profile-slots', `${profileKey}.json`);
  }

  async withProfileLedger(profileId, operation) {
    const file = this.profileLedgerPath(profileId);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try { await fs.writeFile(file, '{"version":1,"profileId":"","leases":[]}', { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const release = await lockfile.lock(file, LOCK_OPTIONS);
    try {
      let ledger;
      try { ledger = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { throw new Error(`O limite compartilhado do perfil está inválido (${error.message || error}); o agendamento foi interrompido.`); }
      if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.leases)) throw new Error('O limite compartilhado do perfil tem um formato desconhecido; o agendamento foi interrompido.');
      ledger.profileId = String(profileId);
      ledger.leases = ledger.leases.filter(lease => {
        if (!['starting', 'running'].includes(lease.status)) return false;
        if (!Number.isInteger(lease.workerPid) || lease.workerPid < 1) return true;
        try { process.kill(lease.workerPid, 0); return true; }
        catch (error) { return error.code === 'EPERM'; }
      });
      const result = await operation(ledger);
      await fs.writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
      return result;
    } finally { await release(); }
  }

  profileLeaseKey(projectRoot, runId, taskId) {
    return `${normalizedPath(projectRoot)}:${runId}:${taskId}`;
  }

  async reserveProfileLease(profileId, projectRoot, runId, taskId, profileLimit, details = {}) {
    return this.withProfileLedger(profileId, async ledger => {
      const key = this.profileLeaseKey(projectRoot, runId, taskId);
      const active = ledger.leases.filter(lease => ['starting', 'running'].includes(lease.status));
      const existing = ledger.leases.find(lease => lease.key === key);
      if (existing) {
        Object.assign(existing, {
          status: 'starting', ownerId: this.ownerId, ownerPid: process.pid,
          workerPid: Number.isInteger(details.workerPid) ? details.workerPid : existing.workerPid,
          sessionId: details.sessionId || existing.sessionId || '', updatedAt: Date.now()
        });
        return { reserved: true, activeForProfile: active.length };
      }
      const max = Math.max(1, Math.min(8, Math.floor(Number(profileLimit) || 1)));
      if (active.length >= max) return { reserved: false, reason: 'profile-limit', profileId, profileLimit: max, activeForProfile: active.length };
      ledger.leases.push({
        key, projectRoot: normalizedPath(projectRoot), runId, taskId, profileId,
        ownerId: this.ownerId, ownerPid: process.pid, workerPid: Number.isInteger(details.workerPid) ? details.workerPid : 0,
        sessionId: String(details.sessionId || ''), status: 'starting', createdAt: Date.now(), updatedAt: Date.now()
      });
      return { reserved: true, activeForProfile: active.length + 1 };
    });
  }

  async updateProfileLease(profileId, projectRoot, runId, taskId, values = {}) {
    return this.withProfileLedger(profileId, async ledger => {
      const lease = ledger.leases.find(item => item.key === this.profileLeaseKey(projectRoot, runId, taskId));
      if (!lease) return false;
      Object.assign(lease, values, { updatedAt: Date.now() });
      return true;
    });
  }

  async registerProfileLease(profileId, projectRoot, runId, taskId, values = {}) {
    return this.withProfileLedger(profileId, async ledger => {
      const key = this.profileLeaseKey(projectRoot, runId, taskId);
      let lease = ledger.leases.find(item => item.key === key);
      if (!lease) {
        lease = { key, projectRoot: normalizedPath(projectRoot), runId, taskId, profileId, createdAt: Date.now() };
        ledger.leases.push(lease);
      }
      Object.assign(lease, values, { ownerId: this.ownerId, ownerPid: process.pid, updatedAt: Date.now() });
      return true;
    });
  }

  async releaseProfileLease(profileId, projectRoot, runId, taskId) {
    return this.withProfileLedger(profileId, async ledger => {
      const key = this.profileLeaseKey(projectRoot, runId, taskId);
      const length = ledger.leases.length;
      ledger.leases = ledger.leases.filter(lease => lease.key !== key);
      return ledger.leases.length !== length;
    });
  }

  async withLedger(projectRoot, operation) {
    const file = this.ledgerPath(projectRoot);
    await fs.mkdir(path.dirname(file), { recursive: true });
    try { await fs.writeFile(file, '{"version":1,"leases":[],"budgetReservations":[],"importedSources":[]}', { flag: 'wx' }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const release = await lockfile.lock(file, LOCK_OPTIONS);
    try {
      let ledger;
      try { ledger = JSON.parse(await fs.readFile(file, 'utf8')); }
      catch (error) { throw new Error(`O registro compartilhado de tarefas está inválido (${error.message || error}); o agendamento foi interrompido para evitar ultrapassar o limite.`); }
      if (!ledger || ledger.version !== 1 || !Array.isArray(ledger.leases)) throw new Error('O registro compartilhado de tarefas tem um formato desconhecido; o agendamento foi interrompido para evitar ultrapassar o limite.');
      if (!Array.isArray(ledger.budgetReservations)) ledger.budgetReservations = [];
      await this.importLegacyLedger(projectRoot, ledger);
      const result = await operation(ledger);
      await fs.writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`, 'utf8');
      return result;
    } finally {
      await release();
    }
  }

  async importLegacyLedger(projectRoot, ledger) {
    if (!this.legacyStoragePath) return;
    if (!Array.isArray(ledger.importedSources)) ledger.importedSources = [];
    const sourceKey = crypto.createHash('sha256').update(normalizedPath(this.legacyStoragePath)).digest('hex');
    if (ledger.importedSources.includes(sourceKey)) return;
    const projectKey = crypto.createHash('sha256').update(normalizedPath(projectRoot)).digest('hex');
    const sourcePath = path.join(this.legacyStoragePath, 'task-slots', `${projectKey}.json`);
    let legacy;
    try { legacy = JSON.parse(await fs.readFile(sourcePath, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`O registro anterior de tarefas não pôde ser migrado (${error.message || error}); o agendamento foi interrompido para preservar os limites.`);
    }
    if (legacy) {
      if (legacy.version !== 1 || !Array.isArray(legacy.leases) || (legacy.budgetReservations !== undefined && !Array.isArray(legacy.budgetReservations))) {
        throw new Error('O registro anterior de tarefas tem formato inválido; o agendamento foi interrompido para preservar os limites.');
      }
      const leaseKeys = new Set(ledger.leases.map(item => item.key));
      for (const lease of legacy.leases) if (!leaseKeys.has(lease.key)) ledger.leases.push(lease);
      const attempts = new Set(ledger.budgetReservations.map(item => item.attemptKey));
      for (const reservation of legacy.budgetReservations || []) {
        if (!attempts.has(reservation.attemptKey)) ledger.budgetReservations.push(reservation);
      }
    }
    ledger.importedSources.push(sourceKey);
  }

  async prune(projectRoot, leases, readSessions) {
    let sessions;
    try {
      sessions = await readSessions(projectRoot);
      if (!Array.isArray(sessions)) return { leases, verified: false, sessions: undefined };
    } catch {
      return { leases, verified: false, sessions: undefined };
    }
    const liveIds = new Set(sessions.map(sessionIdOf).filter(Boolean));
    const now = Date.now();
    const root = normalizedPath(projectRoot);
    const kept = [];
    for (const lease of leases) {
      if (lease.sessionId) {
        if (liveIds.has(lease.sessionId)) kept.push(lease);
        continue;
      }
      if (lease.ownerId === this.ownerId) { kept.push(lease); continue; }
      const ownerAlive = Number.isInteger(lease.ownerPid) && (() => {
        try { process.kill(lease.ownerPid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
      })();
      if (ownerAlive || now - Number(lease.createdAt || now) < ORPHAN_START_GRACE_MS) {
        kept.push(lease);
        continue;
      }
      const known = new Set(lease.knownSessionIds || []);
      const possibleOrphans = sessions.some(session =>
        !known.has(sessionIdOf(session)) && sessionIdOf(session) &&
        (!sessionProjectOf(session) || sessionProjectOf(session) === root)
      );
      if (possibleOrphans) kept.push({ ...lease, uncertain: true });
    }
    return { leases: kept, verified: true, sessions };
  }

  async snapshot(projectRoot, readSessions) {
    return this.withLedger(projectRoot, async ledger => {
      const reconciled = await this.prune(projectRoot, ledger.leases, readSessions);
      ledger.leases = reconciled.leases;
      const external = reconciled.verified
        ? externalSessionActivity(projectRoot, ledger.leases, reconciled.sessions)
        : { active: 0, uncertain: 0 };
      return {
        active: ledger.leases.filter(lease => ['starting', 'running'].includes(lease.status)).length + external.active,
        externalActive: external.active,
        uncertainExternal: external.uncertain,
        leases: ledger.leases.map(lease => ({ ...lease })),
        verified: reconciled.verified,
        budgetReservedUsdByRun: ledger.budgetReservations.reduce((totals, item) => {
          totals[item.runId] = Math.round(((totals[item.runId] || 0) + Number(item.estimatedCostUsd || 0)) * 100) / 100;
          return totals;
        }, {})
      };
    });
  }

  async reserve(projectRoot, runId, taskId, maxParallel, readSessions, details = {}) {
    let reservedProfileId = '';
    try {
      return await this.withLedger(projectRoot, async ledger => {
      const reconciled = await this.prune(projectRoot, ledger.leases, readSessions);
      ledger.leases = reconciled.leases;
      // Session inventory is part of the safety boundary: without it, we cannot
      // know whether another window or an untracked Lich session already uses a
      // slot. Do not start a task based on an unverifiable count.
      if (!reconciled.verified) return { reserved: false, reason: 'sessions-unverified' };
      const key = `${runId}:${taskId}`;
      if (ledger.leases.some(lease => lease.key === key)) return { reserved: false, reason: 'duplicate' };
      const budgetLimitUsd = Math.max(0, Number(details.budgetLimitUsd) || 0);
      const estimateMissing = details.estimatedCostUsd === null || details.estimatedCostUsd === undefined || details.estimatedCostUsd === '';
      const estimatedCostUsd = estimateMissing ? NaN : Number(details.estimatedCostUsd);
      const attempt = Math.max(1, Math.floor(Number(details.attempt) || 1));
      const attemptKey = `${runId}:${taskId}:${attempt}`;
      const runBudgetReservations = ledger.budgetReservations.filter(item => item.runId === runId);
      const budgetReservedUsd = Math.round(runBudgetReservations.reduce((sum, item) => sum + Number(item.estimatedCostUsd || 0), 0) * 100) / 100;
      if (budgetLimitUsd > 0) {
        if (!Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0) return { reserved: false, reason: 'budget-estimate-missing', budgetReservedUsd, budgetLimitUsd };
        if (runBudgetReservations.some(item => item.attemptKey === attemptKey)) return { reserved: false, reason: 'budget-attempt-duplicate', budgetReservedUsd, budgetLimitUsd };
        if (Math.round((budgetReservedUsd + estimatedCostUsd) * 100) / 100 > budgetLimitUsd) return { reserved: false, reason: 'budget-limit', budgetReservedUsd, budgetLimitUsd };
      }
      const external = externalSessionActivity(projectRoot, ledger.leases, reconciled.sessions);
      const active = ledger.leases.filter(lease => ['starting', 'running'].includes(lease.status)).length + external.active;
      if (active >= maxParallel) return { reserved: false, reason: 'limit' };
      const profileId = String(details.profileId || '');
      const profileLimit = Math.max(1, Math.min(8, Math.floor(Number(details.profileLimit) || 1)));
      let activeForProfile = 0;
      if (profileId) {
        const profileReservation = await this.reserveProfileLease(profileId, projectRoot, runId, taskId, profileLimit, details);
        if (!profileReservation.reserved) return profileReservation;
        reservedProfileId = profileId;
        activeForProfile = profileReservation.activeForProfile;
      }
      const knownSessionIds = reconciled.sessions.map(sessionIdOf).filter(Boolean);
      ledger.leases.push({
        key, runId, taskId, ownerId: this.ownerId, ownerPid: process.pid,
        status: 'starting', sessionId: '', createdAt: Date.now(), updatedAt: Date.now(),
        projectRoot: normalizedPath(projectRoot), knownSessionIds,
        provider: details.provider || '', profileId, title: details.title || '', uncertain: false
      });
      if (budgetLimitUsd > 0) ledger.budgetReservations.push({
        attemptKey, runId, taskId, attempt, estimatedCostUsd: Math.round(estimatedCostUsd * 100) / 100,
        budgetLimitUsd, reservedAt: Date.now()
      });
      return {
        reserved: true, active: active + 1, externalActive: external.active, uncertainExternal: external.uncertain,
        profileId, activeForProfile,
        budgetReservedUsd: budgetLimitUsd > 0 ? Math.round((budgetReservedUsd + estimatedCostUsd) * 100) / 100 : budgetReservedUsd,
        budgetLimitUsd
      };
      });
    } catch (error) {
      if (reservedProfileId) await this.releaseProfileLease(reservedProfileId, projectRoot, runId, taskId).catch(() => {});
      throw error;
    }
  }

  async update(projectRoot, runId, taskId, values = {}) {
    let profileId = '';
    const updated = await this.withLedger(projectRoot, async ledger => {
      const lease = ledger.leases.find(item => item.key === `${runId}:${taskId}`);
      if (!lease) return false;
      profileId = String(lease.profileId || values.profileId || '');
      Object.assign(lease, values, { updatedAt: Date.now() });
      return true;
    });
    if (updated && profileId) await this.updateProfileLease(profileId, projectRoot, runId, taskId, values);
    return updated;
  }

  async register(projectRoot, runId, taskId, values = {}) {
    let profileId = '';
    const registered = await this.withLedger(projectRoot, async ledger => {
      const key = `${runId}:${taskId}`;
      let lease = ledger.leases.find(item => item.key === key);
      if (!lease) {
        lease = {
          key, runId, taskId, ownerId: this.ownerId, ownerPid: process.pid,
          status: 'running', sessionId: '', createdAt: Date.now(), projectRoot: normalizedPath(projectRoot),
          knownSessionIds: [], profileId: values.profileId || '', uncertain: false
        };
        ledger.leases.push(lease);
      }
      Object.assign(lease, values, { updatedAt: Date.now() });
      profileId = String(lease.profileId || values.profileId || '');
      return true;
    });
    if (registered && profileId) await this.registerProfileLease(profileId, projectRoot, runId, taskId, values);
    return registered;
  }

  async release(projectRoot, runId, taskId) {
    let profileId = '';
    const released = await this.withLedger(projectRoot, async ledger => {
      const key = `${runId}:${taskId}`;
      const length = ledger.leases.length;
      profileId = String(ledger.leases.find(lease => lease.key === key)?.profileId || '');
      ledger.leases = ledger.leases.filter(lease => lease.key !== key);
      return ledger.leases.length !== length;
    });
    if (profileId) await this.releaseProfileLease(profileId, projectRoot, runId, taskId);
    return released;
  }
}

module.exports = { SharedTaskSlots, externalSessionActivity, normalizedPath, sharedUserStoragePath };
