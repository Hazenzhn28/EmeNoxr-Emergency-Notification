function createIncidentLog() {
  const incidents = [];

  function recordDetection(alertId, detectionTime) {
    const incident = {
      alertId,
      detectionTime,
      alertTime: null,
      parentResponse: "Pending",
      outcome: "Alert delivery in progress."
    };
    incidents.push(incident);
    return incident;
  }

  function list() {
    return incidents.slice().reverse();
  }

  return { incidents, recordDetection, list };
}

module.exports = { createIncidentLog };
