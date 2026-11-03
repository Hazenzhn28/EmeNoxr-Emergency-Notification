// src/services/incidents.js (Backend Data Store)

function createIncidentLog() {
  // This array stores the incidents in the server's memory
  const incidents = [];

  return {
    // Add a new incident
    add(incident) {
      const newIncident = {
        id: Date.now().toString(),
        detectionTime: new Date().toISOString(),
        ...incident
      };
      incidents.push(newIncident);
      return newIncident;
    },
    
    // Get all incidents (newest first)
    list() {
      return [...incidents].reverse();
    },
    
    // Update an existing incident (e.g., when parent presses a button)
    update(alertId, updates) {
      const index = incidents.findIndex(inc => inc.alertId === alertId || inc.id === alertId);
      if (index !== -1) {
        incidents[index] = { ...incidents[index], ...updates };
        return incidents[index];
      }
      return null;
    }
  };
}

module.exports = { createIncidentLog };