/**
 * A2A Client for React
 * Communicates with A2A agents using JSON-RPC protocol
 */

export class A2AClient {
  constructor(serverUrl) {
    // Use the Vite proxy instead of direct URL
    this.serverUrl = '/api';
    this.requestId = 1;
  }

  /**
   * Send a message to an A2A agent using JSON-RPC
   * @param {string} message - The message to send
   * @returns {Promise<Object>} - The response from the agent
   */
  async sendMessage(message) {
    try {
      const payload = {
        jsonrpc: '2.0',
        method: 'execute',
        params: {
          input: message,
        },
        id: this.requestId++,
      };

      const response = await this.fetchWithTimeout(`${this.serverUrl}/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`A2A error: ${data.error.message}`);
      }

      if (!data.result) {
        throw new Error('No result in response');
      }

      return data.result;
    } catch (error) {
      throw new Error(`A2A communication error: ${error.message}`);
    }
  }

  /**
   * Fetch with timeout
   */
  fetchWithTimeout(url, options = {}, timeoutMs = 180000) {
    return Promise.race([
      fetch(url, options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
      ),
    ]);
  }
}

export default A2AClient;
