/**
 * A2A Client for React
 * Communicates with A2A agents using the A2A protocol
 */

export class A2AClient {
  constructor(serverUrl) {
    // Use the Vite proxy instead of direct URL
    this.serverUrl = '/api';
  }

  /**
   * Send a message to an A2A agent and get a response
   * @param {string} message - The message to send
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - The response from the agent
   */
  async sendMessage(message, options = {}) {
    const {
      timeout = 120000, // 2 minutes default timeout
    } = options;

    try {
      // Create a task on the agent
      const taskResponse = await this.fetchWithTimeout(
        `${this.serverUrl}/tasks`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            input: message,
          }),
        },
        timeout
      );

      if (!taskResponse.ok) {
        throw new Error(`Failed to create task: ${taskResponse.status}`);
      }

      const taskData = await taskResponse.json();
      const taskId = taskData.task_id;

      // Poll for the task result
      let result = null;
      const startTime = Date.now();

      while (Date.now() - startTime < timeout) {
        const statusResponse = await this.fetchWithTimeout(
          `${this.serverUrl}/tasks/${taskId}`,
          {
            method: 'GET',
          },
          timeout
        );

        if (!statusResponse.ok) {
          throw new Error(
            `Failed to get task status: ${statusResponse.status}`
          );
        }

        const statusData = await statusResponse.json();

        if (statusData.status === 'completed' || statusData.status === 'failed') {
          result = statusData;
          break;
        }

        // Wait a bit before polling again
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      if (!result) {
        throw new Error('Task timeout');
      }

      if (result.status === 'failed') {
        throw new Error(`Task failed: ${result.error || 'Unknown error'}`);
      }

      return result;
    } catch (error) {
      throw new Error(`A2A communication error: ${error.message}`);
    }
  }

  /**
   * Fetch with timeout
   */
  fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
    return Promise.race([
      fetch(url, options),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Request timeout')), timeoutMs)
      ),
    ]);
  }

  /**
   * Get agent info
   */
  async getAgentInfo() {
    try {
      const response = await this.fetchWithTimeout(`${this.serverUrl}/`, {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`Failed to get agent info: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      throw new Error(`Failed to get agent info: ${error.message}`);
    }
  }
}

export default A2AClient;
