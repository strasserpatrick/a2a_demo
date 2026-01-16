/**
 * A2A Client for React
 * Communicates with A2A agents using the official @a2a-js/sdk
 */

import { Agent } from '@a2a-js/sdk';

export class A2AClient {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.agent = null;
  }

  /**
   * Connect to the A2A agent via proxy
   */
  async connect() {
    if (!this.agent) {
      // Use /api proxy instead of direct connection
      this.agent = await Agent.connect('/api');
    }
    return this.agent;
  }

  /**
   * Send a message to an A2A agent
   * @param {string} message - The message to send
   * @returns {Promise<string>} - The response from the agent
   */
  async sendMessage(message) {
    try {
      const agent = await this.connect();

      // Send message and collect response
      let response = '';
      for await (const event of agent.sendMessage({
        text: message,
      })) {
        if (event.type === 'artifact-update') {
          // Extract text from artifact
          if (event.artifact?.parts?.[0]?.text) {
            response = event.artifact.parts[0].text;
          }
        }
      }

      return response || 'No response received';
    } catch (error) {
      throw new Error(`A2A communication error: ${error.message}`);
    }
  }

  /**
   * Close the connection
   */
  async close() {
    if (this.agent) {
      await this.agent.close?.();
    }
  }
}

export default A2AClient;
