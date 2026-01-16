/**
 * A2A Client for React
 * Communicates with A2A agents using the official @a2a-js/sdk
 */

import { A2AClient as A2ASDKClient } from '@a2a-js/sdk/dist/client';

export class A2AClient {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.client = null;
  }

  /**
   * Get or create A2A client
   */
  async getClient() {
    if (!this.client) {
      this.client = new A2ASDKClient({ url: this.serverUrl });
    }
    return this.client;
  }

  /**
   * Send a message to an A2A agent
   * @param {string} message - The message to send
   * @returns {Promise<string>} - The response from the agent
   */
  async sendMessage(message) {
    try {
      const client = await this.getClient();

      // Send message and collect response
      let response = '';

      const stream = client.sendMessage({
        message: {
          role: 'user',
          parts: [{ text: message }],
          messageId: crypto.randomUUID(),
        },
      });

      for await (const event of stream) {
        // Check for artifact updates containing the response
        if (event.artifact?.parts?.[0]?.text) {
          response = event.artifact.parts[0].text;
        }
        // Also check result field
        if (event.result?.artifacts?.[0]?.parts?.[0]?.text) {
          response = event.result.artifacts[0].parts[0].text;
        }
      }

      return response || 'No response received';
    } catch (error) {
      throw new Error(`A2A communication error: ${error.message}`);
    }
  }
}

export default A2AClient;
