/**
 * API client for Khoj backend
 */

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080';

export const apiClient = {
  async request(endpoint, options = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: `HTTP ${response.status}: ${response.statusText}`,
      }));
      throw new Error(error.message || error.error || 'Request failed');
    }

    return response.json();
  },

  // Health & Config
  async getHealth() {
    return this.request('/api/health');
  },

  async getAuthConfig() {
    return this.request('/api/auth/config');
  },

  // Runs
  async createRun(data) {
    return this.request('/api/runs', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getRun(runId) {
    return this.request(`/api/runs/${runId}`);
  },

  async getRuns(params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/runs${query ? `?${query}` : ''}`);
  },

  async pauseRun(runId) {
    return this.request(`/api/runs/${runId}/pause`, {
      method: 'POST',
    });
  },

  async resumeRun(runId) {
    return this.request(`/api/runs/${runId}/resume`, {
      method: 'POST',
    });
  },

  async exportRunCSV(runId) {
    const response = await fetch(`${API_BASE_URL}/api/runs/${runId}/export.csv`);
    if (!response.ok) throw new Error('Export failed');
    return response.blob();
  },

  async getRunEvents(runId, params = {}) {
    const query = new URLSearchParams(params).toString();
    return this.request(`/api/runs/${runId}/events${query ? `?${query}` : ''}`);
  },

  // Calls
  async getCall(callId) {
    return this.request(`/api/calls/${callId}`);
  },

  async reextractCall(callId) {
    return this.request(`/api/calls/${callId}/reextract`, {
      method: 'POST',
    });
  },

  // Listings
  async parseListings(text) {
    return this.request('/api/listings/parse', {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  },

  // Sources
  async fetchSources(urls) {
    return this.request('/api/sources/fetch', {
      method: 'POST',
      body: JSON.stringify({ urls }),
    });
  },

  // Area
  async askAreaAgent(question) {
    return this.request('/api/area/ask', {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
  },
};

export const API_URL = API_BASE_URL;
