/**
 * A2A Client for React
 * Communicates with A2A agents using JSON-RPC protocol
 */

export class A2AClient {
  constructor(serverUrl) {
    this.serverUrl = serverUrl;
    this.requestId = 1;
  }

  /**
   * Send a message to an A2A agent
   * @param {string} message - The message to send
   * @returns {Promise<string>} - The response from the agent
   */
  async sendMessage(message) {
    const payload = {
      jsonrpc: '2.0',
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [{ text: message }],
          messageId: crypto.randomUUID(),
        },
      },
      id: this.requestId++,
    };

    const response = await fetch(this.serverUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    if (data.error) {
      throw new Error(`A2A error: ${data.error.message}`);
    }

    // Extract text from the response
    let responseText = 'No response received';

    if (data.result) {
      const result = data.result;

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
  }
}

export default A2AClient;
