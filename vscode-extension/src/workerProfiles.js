'use strict';

function workerProfileRoutingOptions(profiles = [], authStatuses = {}, coordinatorAuth = {}) {
  return profiles
    .filter(profile => profile?.authorized === true && ['codex', 'claude'].includes(profile.providerId))
    .map(profile => {
      const authentication = authStatuses[`profile:${profile.id}`] || coordinatorAuth[profile.id];
      const authStatus = typeof authentication?.status === 'string' ? authentication.status : 'unknown';
      const requestedLimit = Math.floor(Number(profile.maxParallel) || 1);
      return {
        profileId: String(profile.id || ''),
        name: String(profile.name || profile.providerId),
        providerId: profile.providerId,
        authenticationStatus: authStatus,
        authenticationVerified: authStatus === 'verified',
        maxParallel: Math.max(1, Math.min(8, requestedLimit))
      };
    })
    .filter(profile => profile.profileId);
}

module.exports = { workerProfileRoutingOptions };
