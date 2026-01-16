/**
 * A2A Client for React
 * Communicates with A2A agents using the official @a2a-js/sdk
 */

import { A2AClient as A2ASDKClient } from '@a2a-js/sdk/client';

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
      // Fetch agent card manually through proxy
      const agentCardUrl = `${this.serverUrl}/.well-known/agent.json`;
      const response = await fetch(agentCardUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch Agent Card: ${response.status} ${response.statusText}`);
      }
      const agentCard = await response.json();

      // Override the URL in the agent card to use our proxy
      agentCard.url = this.serverUrl;

      // Create client with the agent card directly
      this.client = new A2ASDKClient(agentCard);
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

      // Send message and get response
      const response = await client.sendMessage({
        message: {
          role: 'user',
          parts: [{ text: message }],
          messageId: crypto.randomUUID(),
        },
      });

      // Extract text from the response
      let responseText = 'No response received';

      // Response can be a Message or Task
      if (response.result) {
        const result = response.result;

        // Check if it's a Task with artifacts
        if (result.artifacts && result.artifacts.length > 0) {
          const artifact = result.artifacts[0];
          if (artifact.parts && artifact.parts.length > 0) {
            const part = artifact.parts[0];
            if (part.text) {
              responseText = part.text;
            }
          }
        }

        // Check if it's a Message with parts
        if (result.parts && result.parts.length > 0) {
          const part = result.parts[0];
          if (part.text) {
            responseText = part.text;
          }
        }
      }

      return responseText;
    } catch (error) {
      throw new Error(`A2A communication error: ${error.message}`);
    }
  }
}

export default A2AClient;
