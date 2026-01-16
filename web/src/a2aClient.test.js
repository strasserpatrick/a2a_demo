/**
 * Integration tests for A2A Client
 * Tests communication with actual A2A backend agents
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { A2AClient } from './a2aClient';

// Direct HTTP tests to verify backend is working
describe('A2A Backend Integration', () => {
  const AGENT_A_URL = 'http://localhost:8002';
  const AGENT_B_URL = 'http://localhost:8000';
  const AGENT_C_URL = 'http://localhost:8001';

  describe('Agent Card Endpoints', () => {
    it('should fetch Agent A card', async () => {
      const response = await fetch(`${AGENT_A_URL}/.well-known/agent.json`);
      expect(response.ok).toBe(true);
      const card = await response.json();
      expect(card.name).toContain('Manager');
      expect(card.url).toBe(AGENT_A_URL);
    });

    it('should fetch Agent B (HR) card', async () => {
      const response = await fetch(`${AGENT_B_URL}/.well-known/agent.json`);
      expect(response.ok).toBe(true);
      const card = await response.json();
      expect(card.name).toContain('HR');
    });

    it('should fetch Agent C (Tech) card', async () => {
      const response = await fetch(`${AGENT_C_URL}/.well-known/agent.json`);
      expect(response.ok).toBe(true);
      const card = await response.json();
      expect(card.name).toContain('Tech');
    });
  });

  describe('JSON-RPC Message Sending', () => {
    it('should send a message to Agent A and get a response', async () => {
      const payload = {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ text: '{"current_question": "What is TypeScript?", "conversation_history": []}' }],
            messageId: `test-${Date.now()}`,
          },
        },
        id: 1,
      };

      const response = await fetch(AGENT_A_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      console.log('Response:', JSON.stringify(data, null, 2));

      // Check we got a valid JSON-RPC response
      expect(data.jsonrpc).toBe('2.0');
      expect(data.id).toBe(1);

      // Should have a result (not an error)
      if (data.error) {
        console.error('Error:', data.error);
      }
      expect(data.error).toBeUndefined();
      expect(data.result).toBeDefined();
    }, 120000); // 2 minute timeout for LLM response

    it('should send an HR question and get routed correctly', async () => {
      const payload = {
        jsonrpc: '2.0',
        method: 'message/send',
        params: {
          message: {
            role: 'user',
            parts: [{ text: '{"current_question": "How do I give feedback to my team?", "conversation_history": []}' }],
            messageId: `test-hr-${Date.now()}`,
          },
        },
        id: 2,
      };

      const response = await fetch(AGENT_A_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(response.ok).toBe(true);
      const data = await response.json();

      console.log('HR Response:', JSON.stringify(data, null, 2));

      expect(data.error).toBeUndefined();
      expect(data.result).toBeDefined();

      // Check that response mentions HR routing
      if (data.result?.artifacts?.[0]?.parts?.[0]?.text) {
        const text = data.result.artifacts[0].parts[0].text;
        expect(text.toLowerCase()).toContain('hr');
      }
    }, 120000);
  });

  describe('A2AClient Class', () => {
    it('should send a message using A2AClient and get a response', async () => {
      const client = new A2AClient(AGENT_A_URL);
      const response = await client.sendMessage('{"current_question": "What is React?", "conversation_history": []}');

      console.log('A2AClient response:', response);

      expect(response).toBeDefined();
      expect(response).not.toBe('No response received');
      expect(response.length).toBeGreaterThan(50); // Should have substantial response
    }, 120000);

    it('should route HR questions correctly via A2AClient', async () => {
      const client = new A2AClient(AGENT_A_URL);
      const response = await client.sendMessage('{"current_question": "How do I resolve conflict in my team?", "conversation_history": []}');

      console.log('A2AClient HR response:', response);

      expect(response).toBeDefined();
      expect(response.toLowerCase()).toContain('hr');
    }, 120000);
  });
});
